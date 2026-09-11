import React, { useEffect, useState } from "react";
import { WorkbenchDialog } from "../workbench-dialog.jsx";
import { videoQuality } from "./video-quality.js";

export function HiddenSong({ row, hidden, request, action, busy, notify }) {
  const [deletion, setDeletion] = useState(null);
  const [error, setError] = useState("");
  const disabled = busy || row.processing;
  useEffect(() => {
    if (hidden) setDeletion(null);
  }, [hidden]);
  async function remove() {
    await action(async () => {
      setError("");
      try {
        await request(
          `/admin/library/${row.id}/delete-files`,
          { token: deletion.token },
          "POST",
        );
        setDeletion(null);
        notify("歌曲及对应媒体已彻底删除");
      } catch (failure) {
        setError(failure.message);
        throw failure;
      }
    });
  }
  return (
    <article className="workbench-row" hidden={hidden} data-song-id={row.id}>
      <header>
        <div className="resource-identity">
          <strong>{row.title}</strong>
          <p>
            {row.artist} · {videoQuality(row)}
          </p>
        </div>
        <div className="actions">
          <button
            disabled={disabled}
            onClick={() =>
              action(async () => {
                await request(`/admin/library/${row.id}/restore`, {}, "POST");
                notify("歌曲已恢复");
              })
            }
          >
            恢复歌曲
          </button>
          <button
            disabled={disabled}
            onClick={() =>
              action(async () => {
                setError("");
                setDeletion(
                  await request(
                    `/admin/library/${row.id}/delete-preview`,
                    undefined,
                    "GET",
                  ),
                );
              })
            }
          >
            彻底删除
          </button>
        </div>
      </header>
      <WorkbenchDialog
        open={!!deletion}
        title={`彻底删除《${row.title}》`}
        onClose={() => {
          if (!busy) setDeletion(null);
        }}
      >
        <p>将永久删除歌曲记录及以下媒体，无法恢复。请核对删除范围。</p>
        <ul>
          {deletion?.targets.map((target) => (
            <li key={target.path}>
              <code>{target.path}</code>
              {target.directory ? "（整个目录）" : ""}
            </li>
          ))}
        </ul>
        {!deletion?.targets.length && <p>没有剩余媒体文件，将删除歌曲记录。</p>}
        {error && (
          <p role="alert">{error}。请关闭窗口，重新查看删除清单后再试。</p>
        )}
        <div className="actions">
          <button disabled={busy} onClick={() => setDeletion(null)}>
            取消
          </button>
          <button disabled={disabled || !!error} onClick={remove}>
            确认永久删除
          </button>
        </div>
      </WorkbenchDialog>
    </article>
  );
}
