import React, { useState } from "react";

export function TaskActions({ job, request, refresh }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const downloadable = ["download", "favorite-download"].includes(job.kind);
  const removable =
    downloadable &&
    ["queued", "running", "waiting-worker", "failed", "cancelling"].includes(
      job.status,
    );
  const retryable = ["failed", "waiting-worker"].includes(job.status);
  if (!removable && !retryable) return null;
  async function act(action) {
    if (
      action === "delete" &&
      removable &&
      !window.confirm(
        "取消此下载任务并删除它产生的临时文件？已入库歌曲和其他任务引用的文件会保留。",
      )
    )
      return;
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
      {retryable && (
        <button disabled={busy} onClick={() => act("retry")}>
          重试
        </button>
      )}
      {(job.status === "failed" || removable) && (
        <button
          disabled={busy}
          onClick={() => act("delete")}
          title={
            removable
              ? "停止下载并清理该任务的临时文件"
              : "仅删除失败任务记录，保留歌曲和媒体文件"
          }
        >
          {removable ? (busy ? "正在取消并清理…" : "取消并删除") : "删除"}
        </button>
      )}
      {error && <span role="alert">{error}</span>}
    </>
  );
}
