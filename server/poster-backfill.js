import { needsPoster } from "./song-poster.js";
import { songIdFor } from "./song-writes.js";

export function queueMissingPosters({ store, addJob, limit = 4 }) {
  const active = store.db
    .prepare(
      "SELECT kind,payload FROM jobs WHERE status IN ('queued','running','waiting-worker')",
    )
    .all();
  let remaining = Math.max(
    0,
    limit - active.filter((job) => job.kind === "poster").length,
  );
  const busy = new Set(active.map((job) => songIdFor(JSON.parse(job.payload))));
  let queued = 0;
  for (const song of store.db
    .prepare("SELECT * FROM songs WHERE status='ready' ORDER BY created,id")
    .all()) {
    if (!remaining) break;
    if (
      busy.has(song.id) ||
      store.get("hidden:" + song.id) ||
      !needsPoster(store, song)
    )
      continue;
    addJob("poster", { id: song.id });
    remaining--;
    queued++;
  }
  return queued;
}
