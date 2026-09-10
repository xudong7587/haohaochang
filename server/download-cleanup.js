import path from "node:path";
import { lstat, realpath, unlink } from "node:fs/promises";
import { inside } from "./media-utils.js";
import { inspectPackage } from "./resource-health.js";
import { withSongWrite } from "./song-writes.js";
function paths(value, found = new Set()) {
  if (typeof value === "string" && path.isAbsolute(value))
    found.add(path.resolve(value));
  else if (Array.isArray(value)) value.forEach((v) => paths(v, found));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => paths(v, found));
  return found;
}
export async function cleanImportedDownloads(store, downloads, { id } = {}) {
  const result = { removed: 0, bytes: 0, skipped: 0 };
  let root;
  try {
    root = await realpath(downloads);
  } catch {
    return result;
  }
  const imports = store.db
    .prepare("SELECT payload FROM jobs WHERE kind='import' AND status='done'")
    .all()
    .map((j) => JSON.parse(j.payload))
    .filter((p) => p.id && (!id || p.id === id));
  for (const songId of new Set(imports.map((p) => p.id))) {
    if (!store.db.prepare("SELECT id FROM songs WHERE id=?").get(songId))
      continue;
    try {
      await withSongWrite(store, songId, async (song) => {
        const directory = store.get("package:" + songId);
        if (
          song.status !== "ready" ||
          !directory ||
          inside(root, path.resolve(directory)) ||
          inside(root, path.resolve(song.path))
        )
          return;
        const health = await inspectPackage(store, song, directory);
        if (
          !health.vocal?.available ||
          !health.backing?.available ||
          (!song.needs_video && !health.video?.available)
        )
          return;
        const references = new Set(
          store.db
            .prepare("SELECT path FROM songs")
            .all()
            .map((s) => path.resolve(s.path)),
        );
        for (const row of store.db
          .prepare(
            "SELECT value FROM settings WHERE key LIKE 'package:%' OR key LIKE 'video-source:%' OR key LIKE 'split-video:%'",
          )
          .all())
          paths(JSON.parse(row.value), references);
        const activePaths = () => {
          const active = new Set();
          for (const row of store.db
            .prepare(
              "SELECT payload FROM jobs WHERE status IN ('queued','running','waiting-worker','review','failed')",
            )
            .all())
            paths(JSON.parse(row.payload), active);
          return active;
        };
        const candidates = new Map();
        for (const p of imports.filter((p) => p.id === songId)) {
          if (p.file && p.signature) candidates.set(p.file, p.signature);
          for (const source of p.cleanupSources || [])
            if (source.file && source.signature)
              candidates.set(source.file, source.signature);
        }
        for (const [file, signature] of candidates) {
          const absolute = path.resolve(file);
          if (
            absolute === root ||
            !inside(root, absolute) ||
            references.has(absolute) ||
            activePaths().has(absolute)
          ) {
            result.skipped++;
            continue;
          }
          try {
            const info = await lstat(absolute),
              actual = await realpath(absolute);
            if (
              !info.isFile() ||
              info.isSymbolicLink() ||
              path.relative(actual, absolute) !== "" ||
              !inside(root, actual) ||
              signature !== info.size + ":" + info.mtimeMs
            ) {
              result.skipped++;
              continue;
            }
            const current = await lstat(absolute);
            if (
              current.size !== info.size ||
              current.mtimeMs !== info.mtimeMs ||
              activePaths().has(absolute)
            ) {
              result.skipped++;
              continue;
            }
            await unlink(absolute);
            result.removed++;
            result.bytes += info.size;
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
        }
      });
    } catch (e) {
      result.skipped++;
      result.error = e.message.slice(0, 300);
    }
  }
  store.set("download-cleanup", { ...result, checkedAt: Date.now() });
  return result;
}
