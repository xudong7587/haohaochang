import { findAlbumPoster, downloadPoster } from "./poster-source.js";
import { savePosterImage } from "./poster-image.js";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import {
  stat,
  lstat,
  readFile,
  mkdir,
  link,
  copyFile,
  unlink,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { safeMedia, inside } from "./media-utils.js";
import { metadata, importKey } from "./library.js";
import { withKeyLock } from "./song-writes.js";
import { identifyTitle, catalogSeed } from "../shared/catalog.js";
import { lyricsJson, decodeLyricEntities } from "./providers/lyrics-http.js";

export const intakeRoot = (downloads) => path.join(downloads, "半标准曲库");
export const intakeKey = (file) => "local-intake:" + path.resolve(file);
const signature = (info) => info.size + ":" + info.mtimeMs;
const component = (text) =>
  String(text)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 70) || "未命名";
const normalize = (text) =>
  String(text).normalize("NFKC").toLowerCase().replace(/\s+/g, "");

export function nfoIdentity(xml, filename) {
  if (Buffer.byteLength(xml) > 262144 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("NFO 过大或包含不支持的实体定义");
  const field = (tag) =>
    decodeLyricEntities(
      (
        xml.match(
          new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"),
        )?.[1] || ""
      )
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/<[^>]+>/g, ""),
    )
      .trim()
      .slice(0, 120);
  const raw =
    field("title") || filename.replace(/\s*[-–—]?\s*S\d+E\d+\s*$/i, "");
  const cleaned = raw
    .replace(
      /^(?:【(?:[^】]*(?:4K|1080P|高清|超清|修复|官方|MV|字幕|音质)[^】]*)】\s*)+/i,
      "",
    )
    .trim();
  const parsed = identifyTitle(cleaned);
  // Prefer an explicit performer over uploader, director or the original singer of a cover.
  const explicit = field("artist") || field("performer");
  const pair =
    cleaned.match(/^(.{1,50}?)\s+[-–—]\s+(.+)$/) ||
    cleaned.match(/^([\p{Script=Han}·、]{2,30})\s*[-–—]\s*(.+)$/u);
  const artist =
    explicit ||
    (pair ? pair[1] : parsed.needs_review ? "未知歌手" : parsed.artist);
  const title =
    pair && (!explicit || normalize(explicit) === normalize(pair[1]))
      ? pair[2]
      : parsed.needs_review
        ? cleaned
        : parsed.title;
  return {
    title,
    artist,
    metadata_source: field("title") ? "同名 NFO" : "文件名",
    albumHint: field("album") || field("showtitle"),
    needs_review: 1,
  };
}

export async function lookupArtists(title, fetcher = fetch) {
  const result = await lyricsJson(
    fetcher,
    "https://music.163.com/api/search/get/web",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
        Referer: "https://music.163.com/",
      },
      body: new URLSearchParams({
        s: title,
        type: "1",
        limit: "30",
        offset: "0",
      }),
    },
  );
  if (result.code !== 200) throw new Error("歌手搜索暂不可用");
  return (result.result?.songs || []).map((row) => ({
    title: row.name,
    artist: (row.artists || row.ar || []).map((a) => a.name).join("、"),
  }));
}

export async function completeLocalMetadata(
  file,
  downloads,
  store,
  search = lookupArtists,
  artistOverride = "",
) {
  const base = await metadata(file, [downloads]);
  let xml = "";
  try {
    const nfo = await safeMedia(
      path.join(path.dirname(file), path.parse(file).name + ".nfo"),
      [downloads],
    );
    if ((await stat(nfo)).size > 262144) throw new Error("NFO 文件过大");
    xml = await readFile(nfo, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const parsed = nfoIdentity(xml, path.parse(file).name);
  if (artistOverride) {
    parsed.artist = artistOverride;
    parsed.metadata_source += " · 手动指定歌手";
  }
  if (
    !parsed.albumHint &&
    /^season\s*\d+$/i.test(path.basename(path.dirname(file)))
  ) {
    try {
      const tvshow = await safeMedia(
        path.join(path.dirname(file), "..", "tvshow.nfo"),
        [downloads],
      );
      if ((await stat(tvshow)).size <= 262144)
        parsed.albumHint = nfoIdentity(
          await readFile(tvshow, "utf8"),
          "",
        ).title;
    } catch {}
  }
  const candidates = [
    ...catalogSeed,
    ...store.get("catalog", []),
    ...store.db.prepare("SELECT title,artist FROM songs").all(),
  ];
  let note = "请核对歌名和实际演唱者后确认入库";
  if (parsed.artist === "未知歌手") {
    try {
      candidates.push(...(await search(parsed.title)));
    } catch {
      note = "在线歌手搜索暂不可用，已保留文件名／NFO 资料，请手动核对";
    }
  }
  const artists = [
    ...new Set(
      candidates
        .filter(
          (row) =>
            normalize(row.title) === normalize(parsed.title) &&
            row.artist &&
            row.artist !== "未知歌手",
        )
        .map((row) => row.artist),
    ),
  ];
  if (parsed.artist === "未知歌手" && artists.length === 1)
    parsed.artist = artists[0];
  if (parsed.artist === "未知歌手" && artists.length > 1)
    note =
      "存在同名歌曲或不同演唱者，请从候选核对实际版本：" + artists.join("、");
  return { ...base, ...parsed, candidates: artists.slice(0, 12), note };
}

export async function fileHash(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

// Publish without overwriting, verify before unlinking, and resume after interruption.
export async function moveLocalFile(source, target, roots, expected) {
  if (!(await lstat(source)).isFile()) throw new Error("只能移动普通文件");
  await safeMedia(source, roots);
  await safeMedia(path.dirname(target), roots);
  if (path.resolve(source) === path.resolve(target)) return;
  const before = await stat(source);
  if (expected && signature(before) !== expected)
    throw new Error("文件仍在变化，请稍后重试");
  const hash = await fileHash(source);
  try {
    await link(source, target);
  } catch (error) {
    if (
      error.code === "EXDEV" ||
      error.code === "EPERM" ||
      error.code === "ENOTSUP"
    )
      await copyFile(source, target, constants.COPYFILE_EXCL);
    else if (error.code !== "EEXIST") throw error;
  }
  await safeMedia(target, roots);
  if (
    (await fileHash(target)) !== hash ||
    signature(await stat(source)) !== signature(before)
  )
    throw new Error("移动校验失败，原文件已保留");
  await unlink(source);
}

export function assertLocalFileIdle(store, file, jobId) {
  const jobs = store.db
    .prepare(
      "SELECT id,payload FROM jobs WHERE status IN ('queued','running','waiting-worker','review')",
    )
    .all();
  if (
    jobs.some(
      (job) => job.id !== jobId && JSON.parse(job.payload).file === file,
    )
  )
    throw new Error("文件正在处理或等待核对，请先完成当前任务");
}

export async function stageLocalFile(job, payload, context) {
  const { store, downloads, emit } = context;
  return withKeyLock(store, intakeKey(payload.file), async () => {
    const saved = store.get(intakeKey(payload.file));
    if (saved?.status === "staged") {
      try {
        await stat(payload.file);
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
    }
    assertLocalFileIdle(store, payload.file, job.id);
    let plan = saved?.status === "moving" ? saved : null;
    if (!plan) {
      const file = await safeMedia(payload.file, [downloads]);
      if (inside(intakeRoot(downloads), file) && saved?.status !== "staged")
        throw new Error("该半标准文件没有可恢复的整理记录");
      const info = await stat(file);
      if (payload.signature !== signature(info))
        throw new Error("文件已变化，请刷新后重试");
      const meta = await completeLocalMetadata(
        file,
        downloads,
        store,
        context.localMetadataSearch,
        payload.artistOverride,
      );
      if (saved?.status === "staged") {
        // A user-confirmed staged title takes precedence over the original NFO pair.
        meta.title = saved.metadata.title;
        if (!payload.artistOverride) meta.artist = saved.metadata.artist;
        meta.albumHint ||= saved.metadata.albumHint;
        meta.poster = saved.metadata.poster || meta.poster;
      }
      const id = (await fileHash(file)).slice(0, 24);
      await mkdir(intakeRoot(downloads), { recursive: true });
      await safeMedia(intakeRoot(downloads), [downloads]);
      const dir = path.join(
        intakeRoot(downloads),
        component(meta.artist) +
          " - " +
          component(meta.title) +
          " [" +
          id.slice(0, 8) +
          "]",
      );
      await mkdir(dir, { recursive: true });
      await safeMedia(dir, [downloads]);
      const target = path.join(
        dir,
        component(meta.artist) +
          " - " +
          component(meta.title) +
          path.extname(file).toLowerCase(),
      );
      const sameTarget = path.resolve(target) === path.resolve(file);
      const stem = path.join(path.dirname(file), path.parse(file).name);
      const out = path.join(dir, path.parse(target).name);
      const moves = [];
      for (const suffix of [
        ...new Set([
          ...[...(saved?.moves || []), ...(saved?.generated || [])]
            .filter(
              (entry) => entry.target !== file && entry.target.startsWith(stem),
            )
            .map((entry) => entry.target.slice(stem.length)),
          ".nfo",
          "-album.jpg",
          ".lrc",
          ".jpg",
          ".png",
          "-poster.jpg",
          "-poster.png",
          "-thumb.jpg",
          "-thumb.png",
        ]),
      ]) {
        try {
          const source = await safeMedia(stem + suffix, [downloads]);
          const sideInfo = await stat(source);
          if (sameTarget) continue;
          moves.push({
            source,
            target: out + suffix,
            signature: signature(sideInfo),
            hash: await fileHash(source),
          });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      if (!sameTarget)
        moves.push({
          source: file,
          target,
          signature: payload.signature,
          hash: await fileHash(file),
        });
      plan = {
        status: "moving",
        id,
        file: target,
        metadata: meta,
        moves,
        ...(sameTarget
          ? {
              generated: [
                ...(saved?.moves || []).filter(
                  (entry) => entry.target !== file,
                ),
                ...(saved?.generated || []),
              ],
            }
          : {}),
        sourceKey: sameTarget ? saved.sourceKey : importKey(file, info),
      };
      store.set(intakeKey(file), plan);
    }
    for (const move of plan.moves) {
      try {
        await stat(move.source);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await safeMedia(move.target, [downloads]);
        if ((await fileHash(move.target)) !== move.hash)
          throw new Error("移动后的文件已变化，请检查半标准曲库");
        continue;
      }
      if ((await fileHash(move.source)) !== move.hash)
        throw new Error("原文件已变化，请重新检查整理任务");
      await moveLocalFile(
        move.source,
        move.target,
        [downloads],
        move.signature,
      );
    }
    if (
      !plan.albumPosterAttempted &&
      plan.metadata.albumHint &&
      plan.metadata.artist !== "未知歌手"
    ) {
      const outputBase = path.join(
        path.dirname(plan.file),
        path.parse(plan.file).name + "-album",
      );
      const temporaryBase = outputBase + ".tmp-" + randomUUID();
      const temporary = temporaryBase + ".image",
        converted = temporaryBase + ".jpg";
      try {
        const source = await (context.albumPosterFind || findAlbumPoster)(
          plan.metadata.artist,
          plan.metadata.albumHint,
        );
        if (source) {
          const data = await (context.albumPosterDownload || downloadPoster)(
            source.imageUrl,
          );
          await writeFile(temporary, data, { flag: "wx" });
          await savePosterImage(temporary, converted);
          const output =
            outputBase +
            "-" +
            (await fileHash(converted)).slice(0, 16) +
            ".jpg";
          await rename(converted, output);
          plan.metadata.poster = output;
          plan.metadata.albumPoster = source;
          plan.generated = [
            ...(plan.generated || []).filter(
              (entry) => entry.target !== output,
            ),
            { target: output, hash: await fileHash(output) },
          ];
        }
      } catch {
        plan.metadata.note += "；专辑封面未匹配或暂不可用，原有图片保留";
      } finally {
        await rm(temporary, { force: true });
        await rm(converted, { force: true });
      }
      plan.albumPosterAttempted = true;
    }
    const movedPoster = plan.moves.find(
      (move) => move.source === plan.metadata.poster,
    );
    if (movedPoster) plan.metadata.poster = movedPoster.target;
    plan.status = "staged";
    store.set(intakeKey(plan.file), plan);
    store.set(intakeKey(payload.file), plan);
    store.set(plan.sourceKey, "local-staged:" + plan.id);
    emit?.("library", {});
  });
}

export async function intakeCleanupSources(store, file, downloads) {
  const intake = store.get(intakeKey(file));
  if (intake?.status !== "staged" || !inside(intakeRoot(downloads), file))
    return [];
  const result = [];
  for (const move of new Map(
    [...intake.moves, ...(intake.generated || [])].map((entry) => [
      entry.target,
      entry,
    ]),
  ).values()) {
    if (move.target === file) continue;
    const target = await safeMedia(move.target, [downloads]);
    const info = await stat(target);
    if ((await fileHash(target)) !== move.hash)
      throw new Error("附属文件已变化，请重新核对");
    result.push({ file: target, signature: signature(info) });
  }
  return result;
}
