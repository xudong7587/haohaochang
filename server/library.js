import { createReadStream } from "node:fs";
import { withKeyLock } from "./song-writes.js";
import { resourceRoot } from "./assets.js";
import { identifyTitle } from "../shared/catalog.js";
import { normalizeTags } from "../shared/tags.js";
import path from "node:path";
import {
  readdir,
  readFile,
  stat,
  mkdir,
  copyFile,
  writeFile,
  link,
  rm,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { safeMedia, inside, searchText } from "./media-utils.js";

export const mediaExtension =
  /\.(mp4|mkv|avi|mov|webm|m4v|mpg|mpeg|ts|mp3|flac|wav|m4a|ogg|aac)$/i;
const field = (xml, tag) => {
  const value =
    xml.match(
      new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"),
    )?.[1] || "";
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim()
    .slice(0, 120);
};
export async function metadata(file, roots) {
  file = await safeMedia(file, roots);
  const stem = path.parse(file).name,
    dir = path.dirname(file);
  const parts = stem.split(/\s*[-–—]\s*/);
  let { artist, title, needs_review } = identifyTitle(stem);
  let source = "文件名",
    poster = "",
    tags = [];
  for (const name of [stem + ".nfo", "musicvideo.nfo", "movie.nfo"]) {
    try {
      const p = await safeMedia(path.join(dir, name), roots);
      if ((await stat(p)).size > 262144) continue;
      const xml = await readFile(p, "utf8");
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) continue;
      const t = field(xml, "title"),
        a = field(xml, "artist");
      tags = normalizeTags(
        [...xml.matchAll(/<(genre|tag|country)>([^<]*)<\/\1>/gi)].map((m) =>
          m[2].trim(),
        ),
      );
      if (t || a) {
        title = t || title;
        artist = a || artist;
        if (t && !a && identifyTitle(t).needs_review === 0) {
          ({ title, artist } = identifyTitle(t));
        } else if (t && !a) {
          const pair = t.match(/^(.{1,50}?)\s+[-–—]\s+(.+)$/);
          if (pair) {
            artist = pair[1];
            title = pair[2];
          }
        }
        source = "NFO";
        needs_review = !a ? identifyTitle(t).needs_review : 0;
        break;
      }
    } catch {}
  }
  for (const name of [
    stem + "-album.jpg",
    stem + "-poster.png",
    stem + "-thumb.png",
    stem + "-poster.jpg",
    stem + "-thumb.jpg",
    stem + ".jpg",
    stem + ".png",
    "poster.jpg",
    "folder.jpg",
    "cover.jpg",
    "poster.png",
  ]) {
    try {
      const p = await safeMedia(path.join(dir, name), roots);
      if ((await stat(p)).size <= 10 * 1024 * 1024) {
        poster = p;
        break;
      }
    } catch {}
  }
  return {
    title,
    artist,
    poster,
    tags,
    metadata_source: source,
    needs_review: artist === "未知歌手" ? 1 : needs_review,
  };
}
export async function filesUnder(root) {
  const result = [];
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink() || item.name.startsWith(".ktv-")) continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await walk(file);
      else if (item.isFile() && mediaExtension.test(item.name))
        result.push(file);
    }
  }
  await walk(root);
  return result;
}
const component = (value) =>
  value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 100) || "未命名";
const escapeXml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export const importKey = (file, info) =>
  "import:" +
  createHash("sha256")
    .update(JSON.stringify([file, info.size, info.mtimeMs]))
    .digest("hex");
export async function importMedia(
  store,
  file,
  downloads,
  root,
  overrides = {},
) {
  file = await safeMedia(file, [downloads]);
  const info = await stat(file),
    signature = JSON.stringify([file, info.size, info.mtimeMs]);
  const key = importKey(file, info);
  const existing = store.get(key);
  if (
    existing &&
    store.db.prepare("SELECT id FROM songs WHERE id=?").get(existing)
  )
    return existing;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const contentId = hash.digest("hex").slice(0, 24);
  return withKeyLock(store, "import:" + contentId, async () => {
    const duplicate = store.db
      .prepare("SELECT id FROM songs WHERE id=?")
      .get(contentId);
    if (duplicate) {
      store.set(key, duplicate.id);
      return duplicate.id;
    }
    const meta = { ...(await metadata(file, [downloads])), ...overrides };
    meta.needs_review = meta.artist === "未知歌手" ? 1 : 0;
    const dir = path.join(
      resourceRoot(root),
      "歌曲",
      component(meta.artist) +
        " - " +
        component(meta.title) +
        " [" +
        contentId.slice(0, 8) +
        "]",
    );
    await mkdir(dir, { recursive: true });
    await safeMedia(dir, [root]);
    const base = path.extname(file).toLowerCase() === ".mp4" ? "画面" : "来源";
    // Stable suffix preserves two different versions without replacing existing files.
    let target = path.join(dir, base + path.extname(file).toLowerCase());
    try {
      await stat(target);
      target = path.join(
        dir,
        base +
          " [" +
          createHash("sha256").update(signature).digest("hex").slice(0, 8) +
          "]" +
          path.extname(file).toLowerCase(),
      );
    } catch {}
    if (!inside(root, target)) throw new Error("整理路径超出曲库");
    const temporary = path.join(dir, ".ktv-import-" + randomUUID() + ".part");
    try {
      await copyFile(file, temporary, constants.COPYFILE_EXCL);
      const after = await stat(file);
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs)
        throw new Error("下载文件仍在变化，请重试");
      await link(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    const id = contentId;
    store.set("package:" + id, dir);
    store.db
      .prepare(
        "INSERT INTO songs (id,path,title,artist,search,created,mode,metadata_source,needs_review,status) VALUES (?,?,?,?,?,?,?,?,?,'preparing')",
      )
      .run(
        id,
        target,
        meta.title,
        meta.artist,
        searchText(meta.title, meta.artist),
        Date.now(),
        overrides.mode || "original",
        meta.metadata_source,
        meta.needs_review,
      );
    store.db
      .prepare("UPDATE songs SET tags=? WHERE id=?")
      .run(JSON.stringify(meta.tags), id);
    store.set(key, id);
    const outStem = path.join(dir, path.parse(target).name);
    await writeFile(
      outStem + ".nfo",
      `<musicvideo><title>${escapeXml(meta.title)}</title><artist>${escapeXml(meta.artist)}</artist>${meta.tags.map((t) => "<tag>" + escapeXml(t) + "</tag>").join("")}</musicvideo>`,
      { flag: "wx" },
    );
    if (meta.poster) {
      const poster = outStem + "-poster" + path.extname(meta.poster);
      await copyFile(meta.poster, poster, constants.COPYFILE_EXCL);
      store.db.prepare("UPDATE songs SET poster=? WHERE id=?").run(poster, id);
    }
    try {
      const lrc = await safeMedia(
        path.join(path.dirname(file), path.parse(file).name + ".lrc"),
        [downloads],
      );
      if ((await stat(lrc)).size < 100000) {
        await copyFile(lrc, outStem + ".lrc", constants.COPYFILE_EXCL);
        store.db
          .prepare("UPDATE songs SET lyrics=? WHERE id=?")
          .run(await readFile(lrc, "utf8"), id);
      }
    } catch {}
    return id;
  });
}
