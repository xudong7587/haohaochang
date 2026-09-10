import { withSongWrite, currentSong } from "./song-writes.js";
import { saveSongMetadata } from "./song-metadata.js";
import { searchText, inside, safeMedia, probe } from "./media-utils.js";
export { searchText, inside, safeMedia, probe } from "./media-utils.js";
import { preparePackage } from "./song-package.js";
import { run } from "./process.js";
export { run } from "./process.js";
import {
  resourceRoot,
  resourceFolder,
  preserveSource,
  archiveVersion,
} from "./assets.js";
import { audioVisualArgs } from "./visualization.js";
import { metadata } from "./library.js";
import {
  readdir,
  realpath,
  stat,
  mkdir,
  rename,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pinyin } from "pinyin-pro";

export async function scanLibrary(store, roots) {
  let count = 0;
  const progress = {
    running: true,
    checked: 0,
    added: 0,
    errors: [],
    started: Date.now(),
  };
  const recordError = (file, error) => {
    progress.errors.push({ file, message: error.message });
    store.set("scan-progress", { ...progress });
  };
  store.set("scan-progress", { ...progress });
  async function walk(dir, root) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      recordError(dir, error);
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === resourceFolder) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file, root);
      else if (
        /\.(mp4|mkv|avi|mov|webm|m4v|mpg|mpeg|ts|mp3|flac|wav|m4a|ogg|aac)$/i.test(
          entry.name,
        )
      ) {
        try {
          const id =
            store.db.prepare("SELECT id FROM songs WHERE path=?").get(file)
              ?.id ||
            createHash("sha256").update(file).digest("hex").slice(0, 24);
          const { artist, title, poster, tags, metadata_source, needs_review } =
            await metadata(file, [root]);
          count += Number(
            store.db
              .prepare(
                "INSERT OR IGNORE INTO songs (id,path,title,artist,search,created) VALUES (?,?,?,?,?,?)",
              )
              .run(
                id,
                file,
                title,
                artist,
                searchText(title, artist),
                Date.now(),
              ).changes,
          );
          await withSongWrite(
            store,
            id,
            async (song) => {
              if (
                store.db.prepare("SELECT id FROM queue WHERE song_id=?").get(id)
              )
                return;
              const patch = {};
              if (!["手动", "AI"].includes(song.metadata_source))
                Object.assign(patch, {
                  title,
                  artist,
                  metadata_source,
                  needs_review,
                });
              if (!song.tags_manual && song.metadata_source !== "AI")
                patch.tags = JSON.stringify(tags);
              if (!song.lyrics) {
                try {
                  const lrc = await safeMedia(
                    path.join(dir, path.parse(entry.name).name + ".lrc"),
                    [root],
                  );
                  if ((await stat(lrc)).size < 100000)
                    patch.lyrics = await readFile(lrc, "utf8");
                } catch {}
              }
              if (
                Object.entries(patch).some(
                  ([key, value]) => song[key] !== value,
                )
              )
                await saveSongMetadata(store, id, patch, resourceRoot(root), {
                  required: false,
                  idle: false,
                });
              if (poster && !song.poster)
                store.db.prepare("UPDATE songs SET poster=? WHERE id=?").run(poster, id);
              if (
                /\.(mp3|flac|wav|m4a|ogg|aac)$/i.test(entry.name) &&
                !store.get("video-source:" + id)?.keepAudio
              )
                store.db
                  .prepare("UPDATE songs SET needs_video=1 WHERE id=?")
                  .run(id);
            },
            { wait: true },
          );
        } catch (error) {
          recordError(file, error);
        }
        progress.checked++;
        progress.added = count;
        store.set("scan-progress", { ...progress });
      }
    }
  }
  for (const root of roots) await walk(root, root);
  store.set("scan-progress", {
    ...progress,
    running: false,
    finished: Date.now(),
  });
  return count;
}
export async function prepareSong(store, id, roots, cache) {
  return withSongWrite(
    store,
    id,
    async () => {
      const song = store.db.prepare("SELECT * FROM songs WHERE id=?").get(id);
      if (!song) throw new Error("歌曲不存在");
      let file;
      try {
        file = await safeMedia(song.path, roots);
      } catch (error) {
        // Old installations retained the source separately. Recover only this song's recorded backup.
        try {
          const folder = path.join(cache, "sources", song.id);
          const record = JSON.parse(
            await readFile(path.join(folder, "song.json"), "utf8"),
          );
          if (path.basename(record.retained) !== record.retained) throw error;
          file = await safeMedia(path.join(folder, record.retained), [cache]);
          store.db.prepare("UPDATE songs SET path=? WHERE id=?").run(file, id);
        } catch {
          throw error;
        }
      }
      const info = await probe(file);
      const splitVideo = store.get("split-video:" + id);
      if (splitVideo) {
        const video = await probe(await safeMedia(splitVideo, roots));
        if (
          !video.hasVideo ||
          (splitVideo !==
            path.join(store.get("package:" + id) || "", "画面.mp4") &&
            Math.abs(video.duration - info.duration) > 1)
        )
          throw new Error("独立画面与音频时长不匹配");
        info.hasVideo = true;
      }
      if (store.get("video-source:" + id)?.keepAudio) {
        try {
          await stat(path.join(store.get("package:" + id), "画面.mp4"));
          info.hasVideo = true;
        } catch {}
      }
      if (!info.audio.length) throw new Error("文件没有音频轨道");

      if (
        song.mode === "tracks" &&
        (!info.audio[song.backing] ||
          !info.audio[song.vocal] ||
          song.backing === song.vocal)
      )
        throw new Error("请选择两个不同且有效的原唱/伴奏音轨");
      if (song.mode === "channels" && info.audio[0].channels < 2)
        throw new Error("声道切换需要立体声音轨");
      await preparePackage(store, { ...song, path: file }, info, cache);
      return currentSong(store, id);
    },
    { wait: true },
  );
}
export { canonicalVideo, onlineSearch, downloadVideo } from "./sources.js";
