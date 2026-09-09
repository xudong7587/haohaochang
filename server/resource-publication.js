import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, copyFile, link, stat, rm } from "node:fs/promises";
import { resourceNames } from "./resource-manifest.js";
import {
  currentSong,
  conflict,
  publicationKey,
  jobScope,
} from "./song-writes.js";

// Only a synchronous SQLite transaction moves the current pointer. Files in a
// published directory are immutable; interrupted work can never become current.
export async function stageResources(
  store,
  song,
  cache,
  { copy = true, phase } = {},
) {
  const old = store.get("package:" + song.id);
  const base = store.get(
    "package-base:" + song.id,
    old || path.join(cache, "歌曲", song.id),
  );
  const directory = path.join(base, "资源版本", randomUUID());
  await mkdir(directory, { recursive: true });
  const health = {};
  // An imported source is not a published package. Do not copy its full video
  // into metadata-only revisions before preparing the separate playback tracks.
  if (copy && old)
    for (const [kind, name] of Object.entries(resourceNames)) {
      try {
        const source = path.join(old, name),
          target = path.join(directory, name);
        if (
          !store.get("package-ready:" + song.id) &&
          path.resolve(source) === path.resolve(song.path)
        )
          continue;
        const before = await stat(source);
        if (kind === "lyrics") await copyFile(source, target);
        else {
          // Media is immutable: encoders write a new file and rename it into
          // the staged directory. Unchanged tracks can share storage safely.
          try {
            await link(source, target);
          } catch (error) {
            if (
              ![
                "EXDEV",
                "EPERM",
                "EACCES",
                "ENOSYS",
                "ENOTSUP",
                "EOPNOTSUPP",
                "EMLINK",
              ].includes(error.code)
            )
              throw error;
            await copyFile(source, target);
          }
        }
        const prior = store.get("package-health:" + song.id, {})[kind];
        if (
          prior?.available &&
          prior.file === source &&
          prior.size === before.size &&
          prior.mtimeMs === before.mtimeMs
        ) {
          const after = await stat(target);
          health[kind] = {
            ...prior,
            file: target,
            size: after.size,
            mtimeMs: after.mtimeMs,
          };
        }
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
  const pending = new Map([
    ["package:" + song.id, directory],
    ["package-base:" + song.id, base],
    ["package-health:" + song.id, health],
  ]);
  const staged = {
    ...store,
    get: (key, fallback) =>
      pending.has(key) ? pending.get(key) : store.get(key, fallback),
    set: (key, value) =>
      key.startsWith("separation:")
        ? store.set(key, value)
        : pending.set(key, value),
  };
  return {
    store: staged,
    directory,
    old,
    async abandon() {
      await rm(directory, { recursive: true, force: true });
    },
    publish(patch = {}) {
      const latest = currentSong(store, song.id);
      if (
        latest.metadataRevision !== song.metadataRevision ||
        latest.resourceRevision !== song.resourceRevision
      )
        throw conflict("发布前歌曲已更新，旧资源保持可用", latest);
      store.db.exec("BEGIN IMMEDIATE");
      try {
        if (old)
          store.set(
            `package-version:${song.id}:${latest.resourceRevision}`,
            old,
          );
        for (const [key, value] of pending) store.set(key, value);
        const columns = Object.keys(patch);
        if (
          columns.some(
            (c) =>
              ![
                "title",
                "artist",
                "search",
                "lyrics",
                "mode",
                "backing",
                "vocal",
                "duration",
                "audio",
                "status",
                "error",
                "needs_video",
                "needs_review",
                "metadata_source",
                "tags",
                "tags_manual",
                "evidence",
                "path",
              ].includes(c),
          )
        )
          throw new Error("Invalid publication column");
        store.db
          .prepare(
            `UPDATE songs SET resourceRevision=resourceRevision+1${columns.map((c) => `,${c}=?`).join("")} WHERE id=?`,
          )
          .run(...Object.values(patch), song.id);
        const revision = latest.resourceRevision + 1;
        store.set(`package-version:${song.id}:${revision}`, directory);
        const key = publicationKey(song.id, phase);
        if (phase && key) store.set(key, { revision, directory });
        const jobId = jobScope(),
          job =
            jobId &&
            store.db.prepare("SELECT payload FROM jobs WHERE id=?").get(jobId);
        if (job)
          store.db.prepare("UPDATE jobs SET payload=? WHERE id=?").run(
            JSON.stringify({
              ...JSON.parse(job.payload),
              id: song.id,
              expectedRevision: currentSong(store, song.id).metadataRevision,
            }),
            jobId,
          );
        store.db.exec("COMMIT");
        return currentSong(store, song.id);
      } catch (e) {
        store.db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
export async function requireFiles(dir, kinds) {
  for (const kind of kinds) {
    const file = path.join(dir, resourceNames[kind]);
    const info = await stat(file);
    if (!info.isFile() || !info.size) throw new Error("资源为空：" + kind);
  }
}
