import path from "node:path";
import { randomUUID } from "node:crypto";
import { lstat, realpath, readdir, rename, unlink } from "node:fs/promises";
import { inside, probe } from "./media-utils.js";
import { run } from "./process.js";
import { inspectPackage } from "./resource-health.js";
import { savePackageInfo } from "./song-package.js";

const ownedVideo =
  /^(?:画面|来源画面|来源)(?: \[[0-9a-f]{8}\])?\.(?:mp4|mkv|webm|mov|avi|m4v|ts|mpg|mpeg)$/i;
function collect(value, result) {
  if (typeof value === "string" && path.isAbsolute(value))
    result.add(path.resolve(value));
  else if (Array.isArray(value)) value.forEach((v) => collect(v, result));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => collect(v, result));
}

// Called under the song write lock, only for an idle, verified standard song.
// Preserve every original audio track losslessly before retiring a managed
// source video. External user media is never a cleanup candidate.
export async function compactSongVideos(
  store,
  song,
  cache,
  { dryRun = false, busy = () => false } = {},
) {
  const result = { files: 0, bytes: 0 };
  const base = store.get("package-base:" + song.id),
    current = store.get("package:" + song.id);
  if (!base || !current || dryRun || busy()) return result;
  const root = await realpath(cache),
    resolvedBase = path.resolve(base),
    picture = path.join(current, "画面.mp4");
  if (
    !inside(root, resolvedBase) ||
    path.basename(path.dirname(resolvedBase)) !== "歌曲" ||
    (await realpath(base)) !== resolvedBase ||
    !inside(resolvedBase, path.resolve(current))
  )
    return result;
  const health = await inspectPackage(store, song, current);
  if (
    !health.video?.available ||
    !health.vocal?.available ||
    !health.backing?.available
  )
    return result;
  const blocked = () => {
    const refs = new Set(
      store.db
        .prepare("SELECT path FROM songs WHERE id<>?")
        .all(song.id)
        .map((s) => path.resolve(s.path)),
    );
    for (const row of store.db
      .prepare(
        "SELECT key,value FROM settings WHERE key LIKE 'video-source:%' OR key LIKE 'split-video:%'",
      )
      .all())
      if (!row.key.endsWith(":" + song.id))
        collect(JSON.parse(row.value), refs);
    for (const row of store.db
      .prepare(
        "SELECT payload FROM jobs WHERE status IN ('queued','running','waiting-worker','review','failed')",
      )
      .all())
      collect(JSON.parse(row.payload), refs);
    return refs;
  };
  const original = path.resolve(song.path);
  let sourceSignature;
  if (
    inside(resolvedBase, original) &&
    ownedVideo.test(path.basename(original)) &&
    !blocked().has(original)
  ) {
    const originalStat = await lstat(original);
    if (
      !originalStat.isFile() ||
      originalStat.isSymbolicLink() ||
      (await realpath(original)) !== original
    )
      return result;
    const info = await probe(original);
    if (info.hasVideo && info.audio.length) {
      const audio = path.join(
          resolvedBase,
          "来源音频-" + randomUUID() + ".mka",
        ),
        temporary = audio + ".part";
      try {
        await run(process.env.FFMPEG || "ffmpeg", [
          "-y",
          "-v",
          "error",
          "-i",
          original,
          "-map",
          "0:a",
          "-vn",
          "-c:a",
          "copy",
          "-f",
          "matroska",
          temporary,
        ]);
        const extracted = await probe(temporary);
        if (
          extracted.hasVideo ||
          extracted.audio.length !== info.audio.length ||
          !(extracted.duration > 0)
        )
          throw new Error("原始音轨保存校验失败，来源视频已保留");
        const audioHash = (file) =>
          run(process.env.FFMPEG || "ffmpeg", [
            "-v",
            "error",
            "-i",
            file,
            "-map",
            "0:a",
            "-c",
            "copy",
            "-f",
            "hash",
            "-hash",
            "sha256",
            "-",
          ]);
        if ((await audioHash(original)) !== (await audioHash(temporary)))
          throw new Error("原始音轨码流不一致，来源视频已保留");
        await run(process.env.FFMPEG || "ffmpeg", [
          "-v",
          "error",
          "-xerror",
          "-i",
          temporary,
          "-map",
          "0:a",
          "-f",
          "null",
          "-",
        ]);
        const stillOriginal = await lstat(original);
        if (
          busy() ||
          blocked().has(original) ||
          stillOriginal.isSymbolicLink() ||
          stillOriginal.size !== originalStat.size ||
          stillOriginal.mtimeMs !== originalStat.mtimeMs
        )
          return result;
        await rename(temporary, audio);
        const audioStat = await lstat(audio);
        store.db.exec("BEGIN IMMEDIATE");
        try {
          store.db
            .prepare("UPDATE songs SET path=? WHERE id=?")
            .run(audio, song.id);
          store.set(
            "package-fingerprint:" + song.id,
            JSON.stringify([
              audioStat.mtimeMs,
              audioStat.size,
              song.mode,
              song.backing,
              song.vocal,
            ]),
          );
          store.set("split-video:" + song.id, picture);
          store.db.exec("COMMIT");
        } catch (error) {
          store.db.exec("ROLLBACK");
          throw error;
        }
        song = { ...song, path: audio };
        sourceSignature = originalStat;
      } finally {
        await unlink(temporary).catch(() => {});
      }
    }
  }
  // All repair paths now reuse the sole current picture. Preserve matching
  // metadata/offsets when a replacement video was explicitly selected.
  const replacement = store.get("video-source:" + song.id);
  if (replacement?.path && inside(resolvedBase, path.resolve(replacement.path)))
    store.set("video-source:" + song.id, { ...replacement, path: picture });
  const split = store.get("split-video:" + song.id);
  if (split && inside(resolvedBase, path.resolve(split)))
    store.set("split-video:" + song.id, picture);
  await savePackageInfo(
    store,
    store.db.prepare("SELECT * FROM songs WHERE id=?").get(song.id),
    cache,
  );
  for (const directory of new Set([resolvedBase, path.resolve(current)])) {
    if ((await realpath(directory)) !== directory) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (
        !ownedVideo.test(entry.name) ||
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        file === picture ||
        file === path.resolve(song.path) ||
        blocked().has(file) ||
        busy()
      )
        continue;
      const before = await lstat(file);
      if (
        file === original &&
        sourceSignature &&
        (before.size !== sourceSignature.size ||
          before.mtimeMs !== sourceSignature.mtimeMs)
      )
        continue;
      if ((await realpath(file)) !== file) continue;
      const after = await lstat(file);
      if (
        after.isSymbolicLink() ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        blocked().has(file) ||
        busy()
      )
        continue;
      await unlink(file);
      result.files++;
      if (before.nlink === 1) result.bytes += before.size;
    }
  }
  return result;
}
