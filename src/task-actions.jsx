import React, { useState } from "react";

export function TaskActions({ job, request, refresh }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!["failed", "waiting-worker"].includes(job.status)) return null;
  async function act(action) {
    setBusy(true);
    setError("");
    try {
      await request(
        `/admin/jobs/${encodeURIComponent(job.id)}${action === "retry" ? "/retry" : ""}`,
        {},
        action === "retry" ? "POST" : "DELETE",
      );
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button disabled={busy} onClick={() => act("retry")}>
        重试
      </button>
      {job.status === "failed" && (
        <button
          disabled={busy}
          onClick={() => act("delete")}
          title="仅删除失败任务记录，保留歌曲和媒体文件"
        >
          删除
        </button>
      )}
      {error && <span role="alert">{error}</span>}
    </>
  );
}
