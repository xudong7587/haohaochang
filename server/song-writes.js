import { AsyncLocalStorage } from "node:async_hooks";

const owners = new WeakMap();
const scope = new AsyncLocalStorage();
const keyLocks = new WeakMap();
export async function withKeyLock(store, key, operation) {
  let locks = keyLocks.get(store);
  if (!locks) keyLocks.set(store, (locks = new Map()));
  while (locks.has(key)) await locks.get(key);
  let release;
  locks.set(
    key,
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  try {
    return await operation();
  } finally {
    locks.delete(key);
    release();
  }
}
export function publicationKey(songId, phase) {
  const jobId = scope.getStore()?.jobId;
  return jobId ? `publication:${jobId}:${songId}:${phase}` : null;
}
export function jobScope() {
  return scope.getStore()?.jobId;
}
export const songIdFor = (payload) =>
  payload.id || payload.existingId || payload.songId;
export const metadataFields = [
  "title",
  "artist",
  "lyrics",
  "mode",
  "backing",
  "vocal",
  "tags",
  "needs_review",
  "path",
  "metadata_source",
  "evidence",
];
export function metadataRevisionFor(song, patch) {
  return (
    song.metadataRevision +
    Number(
      metadataFields.some((key) => key in patch && song[key] !== patch[key]),
    )
  );
}
export const conflict = (message, song, code = "REVISION_CONFLICT") =>
  Object.assign(new Error(message), {
    status: 409,
    code,
    currentRevision: song?.metadataRevision,
  });
export function currentSong(store, id) {
  const song = store.db.prepare("SELECT * FROM songs WHERE id=?").get(id);
  if (!song) throw Object.assign(new Error("歌曲不存在"), { status: 404 });
  return song;
}
export function checkRevision(song, expected, required = true) {
  if (expected === undefined && !required) return;
  if (!Number.isInteger(expected) || expected !== song.metadataRevision)
    throw conflict("资料已更新，请刷新后核对草稿再保存", song);
}
export function assertSongIdle(store, id) {
  const active = owners.get(store)?.get(id);
  if (active && scope.getStore()?.owner !== active)
    throw conflict(
      "歌曲正在写入，请稍后重试",
      currentSong(store, id),
      "SONG_BUSY",
    );
  const jobId = scope.getStore()?.jobId;
  if (
    store.db
      .prepare(
        "SELECT id,payload FROM jobs WHERE status IN ('queued','running')",
      )
      .all()
      .some((j) => j.id !== jobId && songIdFor(JSON.parse(j.payload)) === id)
  )
    throw conflict(
      "歌曲正在整理，请等待当前任务结束",
      currentSong(store, id),
      "SONG_BUSY",
    );
}
export async function withSongWrite(
  store,
  id,
  operation,
  {
    expectedRevision,
    required = false,
    jobId,
    wait = false,
    idle = false,
  } = {},
) {
  let locks = owners.get(store);
  if (!locks) owners.set(store, (locks = new Map()));
  const inherited = scope.getStore();
  if (inherited?.store === store && inherited.ids.has(id))
    return operation(currentSong(store, id));
  while (locks.has(id)) {
    if (!wait)
      throw conflict(
        "歌曲正在写入，请稍后重试",
        currentSong(store, id),
        "SONG_BUSY",
      );
    await locks.get(id).done;
  }
  if (idle) assertSongIdle(store, id);
  let release;
  const owner = {
    done: new Promise((resolve) => {
      release = resolve;
    }),
  };
  locks.set(id, owner);
  let began = false;
  try {
    const song = currentSong(store, id);
    checkRevision(song, expectedRevision, required);
    began = true;
    return await scope.run(
      {
        store,
        owner,
        jobId: jobId || inherited?.jobId,
        ids: new Set([...(inherited?.ids || []), id]),
      },
      () => operation(song),
    );
  } finally {
    // Only our own completed/failed operation advances its retry checkpoint.
    // A revision rejected at entry must never silently accept newer user edits.
    try {
      if (began && jobId) {
        const row = store.db
          .prepare("SELECT payload FROM jobs WHERE id=?")
          .get(jobId);
        if (row) {
          const payload = JSON.parse(row.payload);
          store.db
            .prepare("UPDATE jobs SET payload=? WHERE id=?")
            .run(
              JSON.stringify({
                ...payload,
                id,
                expectedRevision: currentSong(store, id).metadataRevision,
              }),
              jobId,
            );
        }
      }
    } finally {
      locks.delete(id);
      release();
    }
  }
}
