import { taskProgress } from "./task-progress.js";
// Shared admin/PC task view: active work is never hidden by recent history.
export function taskStatus(store) {
  const rows = store.db
    .prepare(
      "SELECT * FROM jobs WHERE status IN ('queued','running','waiting-worker','review','cancelling') OR id IN (SELECT id FROM jobs ORDER BY created DESC LIMIT 100) ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'waiting-worker' THEN 1 WHEN 'queued' THEN 2 WHEN 'review' THEN 3 ELSE 4 END, CASE WHEN status='queued' THEN created ELSE -created END",
    )
    .all();
  const checkpoints = store.db
    .prepare("SELECT key,value FROM settings WHERE key LIKE 'separation:%'")
    .all()
    .map((r) => ({ key: r.key, value: JSON.parse(r.value) }));
  return rows.map(({ payload, ...row }) => {
    const p = JSON.parse(payload);
    const id = p.id || p.existingId || p.songId;
    const song = id
      ? store.db.prepare("SELECT title,artist FROM songs WHERE id=?").get(id)
      : null;
    const checkpoint = checkpoints.find(
      (c) =>
        c.key.startsWith(`separation:${id || row.id}:`) &&
        c.value?.result &&
        !["done", "failed"].includes(c.value.result.status),
    )?.value?.result;
    return {
      ...row,
      media_progress:
        row.status === "running"
          ? taskProgress(store, row.id) || checkpoint?.media_progress || null
          : null,
      title:
        song?.title ||
        p.metadata?.title ||
        p.title ||
        (p.file ? String(p.file).split(/[\\/]/).pop() : ""),
      artist: song?.artist || p.metadata?.artist || p.artist || "",
      stage: (row.status === "running" && checkpoint?.stage) || row.stage,
      model_progress:
        row.status === "running" && Number.isFinite(checkpoint?.model_progress)
          ? checkpoint.model_progress
          : null,
      priority:
        p.priority ||
        (["acquire", "download"].includes(row.kind) ? "online" : "background"),
    };
  });
}
