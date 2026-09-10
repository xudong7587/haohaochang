import React, { useEffect, useState } from "react";
import { WorkbenchDialog } from "../workbench-dialog.jsx";
import { VideoConfirmation, validOffset } from "./video-confirmation.jsx";
export function VideoReview({
  row,
  request,
  action,
  busy,
  notify,
  hidden,
  collapseKey,
  selected,
  onSelect,
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [hidden, collapseKey]);
  const [confirmed, setConfirmed] = useState(false),
    [offset, setOffset] = useState("");
  const url = row.candidate?.canonicalUrl || row.sourceUrl;
  useEffect(() => {
    setConfirmed(false);
    setOffset("");
  }, [row.candidatePath, url]);
  async function resolve(kind) {
    await action(async () => {
      await request(
        "/admin/reviews/" + row.id,
        {
          title: row.title,
          artist: row.artist,
          candidate: row.candidate,
          candidatePath: row.candidatePath,
          sourceUrl: url,
          expectedRevision: row.expectedRevision ?? row.metadataRevision,
          action: kind,
          confirmed: kind === "confirm",
          ...(kind === "confirm" ? { offset: Number(offset) } : {}),
        },
        "POST",
      );
      notify(
        kind === "confirm"
          ? "已确认候选并提交画面关联"
          : kind === "reject"
            ? "已拒绝此候选，原音轨保持可用"
            : "已提交重新搜索",
      );
    });
  }
  return (
    <article className="workbench-row" hidden={hidden}>
      <header>
        {onSelect && (
          <input
            className="row-select"
            type="checkbox"
            aria-label={`选择 ${row.title}`}
            checked={selected}
            onChange={onSelect}
          />
        )}
        <div className="resource-identity">
          <strong>{row.title || "待补充视频"}</strong>
          <p>{row.artist} · 视频候选待核对</p>
        </div>
        <button aria-expanded={open} onClick={() => setOpen(true)}>
          核对视频
        </button>
      </header>
      <WorkbenchDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${row.title || "待补充视频"} · 核对视频`}
      >
        <p>{row.note}</p>
        {url && (
          <a href={url} target="_blank" rel="noreferrer">
            打开候选视频试听
          </a>
        )}
        {row.candidate && (
          <p>
            来源：{row.candidate.provider} · {row.candidate.externalTitle}
            {row.candidate.duration
              ? ` · ${Math.round(row.candidate.duration)} 秒`
              : ""}
          </p>
        )}
        {row.candidatePath && (
          <details>
            <summary>候选文件位置</summary>
            <code>{row.candidatePath}</code>
          </details>
        )}
        <VideoConfirmation
          {...{ confirmed, setConfirmed, offset, setOffset, busy }}
        />
        <div className="actions">
          <button
            className="primary"
            disabled={
              busy ||
              !confirmed ||
              !validOffset(offset) ||
              (!row.candidatePath && !url)
            }
            onClick={() => resolve("confirm")}
          >
            确认候选并关联画面
          </button>
          <button disabled={busy} onClick={() => resolve("reject")}>
            拒绝此候选
          </button>
          <button disabled={busy} onClick={() => resolve("research")}>
            重新搜索视频
          </button>
        </div>
      </WorkbenchDialog>
    </article>
  );
}
