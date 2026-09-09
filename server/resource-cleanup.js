import path from "node:path";
import { lstat, realpath, readdir, unlink, rmdir } from "node:fs/promises";
import { inside } from "./media-utils.js";
import { withSongWrite, songIdFor } from "./song-writes.js";
import { resourceManifest } from "./resource-manifest.js";

export const resourceGraceMs = 10 * 60 * 1000;
const versionName = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const resourceFile =
  /^(?:画面\.mp4|原唱\.m4a|伴奏\.m4a|歌词\.lrc|歌曲信息\.json|来源\.[a-z0-9]+)$/i;

// Only retire our own version directories. Sources and current resources are
// references, never candidates. In-flight jobs and queued playback pin a song.
export async function cleanSongVersions(
  store,
  id,
  cache,
  {
    now = Date.now(),
    graceMs = resourceGraceMs,
    dryRun = false,
    ignoreJobId,
    isPlaying = () => false,
    legacyCache,
  } = {},
) {
  return withSongWrite(store, id, async (song) => {
    const result = { id, removed: 0, bytes: 0, directories: [] };
    const manifest = resourceManifest(store, song, cache);
    if (
      !manifest.playable ||
      (!song.needs_video && !manifest.video) ||
      (["separated", "tracks", "channels"].includes(song.mode) &&
        (!manifest.vocal || !manifest.backing))
    )
      return result;
    const busy = () =>
      isPlaying(id) ||
      store.db.prepare("SELECT song_id FROM queue WHERE song_id=?").get(id) ||
      store.db
        .prepare(
          "SELECT id,payload FROM jobs WHERE status IN ('queued','running','waiting-worker','review')",
        )
        .all()
        .some(
          (j) =>
            j.id !== ignoreJobId && songIdFor(JSON.parse(j.payload)) === id,
        );
    if (busy()) return result;
    const base = store.get("package-base:" + id);
    if (!base) return result;
    let root;
    try {
      root = await realpath(cache);
    } catch {
      return result;
    }
    const versions = path.resolve(base, "资源版本");
    if (
      !inside(root, versions) ||
      versions === root ||
      path.basename(path.dirname(base)) !== "歌曲"
    )
      return result;
    try {
      if (
        (await lstat(versions)).isSymbolicLink() ||
        (await realpath(versions)) !== versions
      )
        return result;
    } catch (error) {
      if (error.code === "ENOENT") return result;
      throw error;
    }
    const references = store.db
      .prepare("SELECT path FROM songs")
      .all()
      .map((s) => s.path);
    for (const row of store.db
      .prepare(
        "SELECT key,value FROM settings WHERE key LIKE 'package:%' OR key LIKE 'video-source:%'",
      )
      .all()) {
      const value = JSON.parse(row.value);
      if (row.key.startsWith("package:") && typeof value === "string")
        references.push(value);
      if (row.key.startsWith("video-source:") && value?.path)
        references.push(value.path);
    }
    for (const entry of await readdir(versions, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !versionName.test(entry.name)
      )
        continue;
      const directory = path.join(versions, entry.name);
      if (references.some((file) => inside(directory, path.resolve(file))))
        continue;
      const children = await readdir(directory, { withFileTypes: true });
      if (
        children.some(
          (file) =>
            !file.isFile() ||
            file.isSymbolicLink() ||
            !resourceFile.test(file.name),
        )
      )
        continue;
      const files = [];
      let modified = (await lstat(directory)).mtimeMs;
      for (const child of children) {
        const file = path.join(directory, child.name),
          info = await lstat(file);
        modified = Math.max(modified, info.mtimeMs);
        files.push({ file, info });
      }
      // Recent revision URLs have a grace period for already-loaded clients.
      if (modified > now - graceMs || busy()) continue;
      if (!dryRun) {
        for (const { file, info } of files) {
          // No recursive deletion, and no following links outside this folder.
          const fresh = await lstat(file);
          if (
            !fresh.isFile() ||
            fresh.isSymbolicLink() ||
            fresh.size !== info.size ||
            fresh.mtimeMs !== info.mtimeMs
          )
            throw new Error("旧资源在清理期间发生变化，请重试");
        }
        for (const { file } of files) await unlink(file);
        await rmdir(directory);
        for (const row of store.db
          .prepare(
            "SELECT key,value FROM settings WHERE key LIKE 'package-version:%' OR key LIKE 'publication:%'",
          )
          .all()) {
          const value = JSON.parse(row.value);
          if (value === directory || value?.directory === directory)
            store.db.prepare("DELETE FROM settings WHERE key=?").run(row.key);
        }
      }
      result.directories.push(directory);
      result.removed++;
      // Hard-linked media is only released when its last directory entry goes.
      result.bytes += files.reduce(
        (total, { info }) => total + (info.nlink === 1 ? info.size : 0),
        0,
      );
    }
    // v1 generated complete videos for each audio choice. Once v2 has a
    // verified picture and matched tracks, those exact managed caches expire too.
    const current = store.get("package:" + id);
    if (current && (await lstat(current)).mtimeMs <= now - graceMs && !busy()) {
      for (const folder of new Set([cache, legacyCache].filter(Boolean))) {
        for (const variant of ["vocal", "backing"]) {
          const file = path.resolve(folder, `${id}-${variant}.mp4`);
          if (
            path.dirname(file) !== path.resolve(folder) ||
            references.some((reference) =>
              inside(path.resolve(reference), file),
            )
          )
            continue;
          let info;
          try {
            info = await lstat(file);
          } catch (error) {
            if (error.code === "ENOENT") continue;
            throw error;
          }
          if (
            !info.isFile() ||
            info.isSymbolicLink() ||
            info.mtimeMs > now - graceMs ||
            (await realpath(file)) !== file
          )
            continue;
          if (!dryRun) await unlink(file);
          result.legacyFiles = (result.legacyFiles || 0) + 1;
          if (info.nlink === 1) result.bytes += info.size;
        }
      }
    }
    return result;
  });
}

export async function cleanResourceVersions(store, cache, options = {}) {
  const report = {
    started: Date.now(),
    songs: 0,
    removed: 0,
    bytes: 0,
    errors: [],
  };
  for (const { id } of store.db.prepare("SELECT id FROM songs").all()) {
    try {
      const result = await cleanSongVersions(store, id, cache, options);
      report.songs++;
      report.removed += result.removed;
      report.bytes += result.bytes;
    } catch (error) {
      if (error.code !== "SONG_BUSY")
        report.errors.push({ id, message: error.message });
    }
  }
  report.finished = Date.now();
  if (!options.dryRun) store.set("resource-cleanup", report);
  return report;
}
