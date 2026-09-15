import { LEGACY_ROOM } from "./room-registry.js";

export function roomTargets(payload = {}) {
  if (Array.isArray(payload.enqueueRooms)) return payload.enqueueRooms;
  return payload.enqueue
    ? [{ roomId: payload.roomId || LEGACY_ROOM, name: payload.name || "家人" }]
    : [];
}
export function mergeRoomTargets(...payloads) {
  const targets = new Map();
  for (const payload of payloads)
    for (const target of roomTargets(payload))
      targets.set(target.roomId, target);
  return [...targets.values()];
}
export function jobRoomTargets(store, payload) {
  const payloads = [payload],
    seen = new Set();
  let current = payload;
  while (
    current.sourceJobId &&
    !seen.has(current.sourceJobId) &&
    seen.size < 20
  ) {
    seen.add(current.sourceJobId);
    const parent = store.db
      .prepare("SELECT payload FROM jobs WHERE id=?")
      .get(current.sourceJobId);
    if (!parent) break;
    current = JSON.parse(parent.payload);
    payloads.push(current);
  }
  return mergeRoomTargets(...payloads);
}

export function deliverJobSong(store, enqueue, job, id) {
  const fresh = store.db
    .prepare("SELECT payload FROM jobs WHERE id=?")
    .get(job.id);
  if (!fresh) return;
  for (const target of jobRoomTargets(store, JSON.parse(fresh.payload))) {
    if (
      store.db
        .prepare(
          "SELECT 1 FROM task_room_deliveries WHERE job_id=? AND room_id=? AND song_id=?",
        )
        .get(job.id, target.roomId, id)
    )
      continue;
    enqueue(id, target.name, target.roomId);
    store.db
      .prepare("INSERT OR IGNORE INTO task_room_deliveries VALUES (?,?,?)")
      .run(job.id, target.roomId, id);
  }
}
