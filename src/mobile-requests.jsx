import React, { useEffect, useState } from "react";
import { api } from "./api.js";
const stages = {
  acquire: "寻找音频与歌词",
  download: "准备下载",
  downloading: "下载歌曲",
  clipping: "裁剪歌曲",
  import: "准备入库",
  separate: "分离伴奏",
  separating: "分离伴奏",
  prepare: "准备播放资源",
  "find-video": "补充画面",
  "audio-fallback": "画面暂不可用，已改找音频",
  "waiting-worker": "等待 PC",
  done: "这一步已完成",
};
export function MobileRequests({ revision = 0 }) {
  const [rows, setRows] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true,
      timer;
    async function read() {
      try {
        const data = await api("/requests/status");
        if (live) {
          setRows(data);
          setError("");
        }
      } catch {
        if (live) setError("找歌进度暂时无法读取，正在重连…");
      } finally {
        if (live) timer = setTimeout(read, 4000);
      }
    }
    read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [revision]);
  if (!rows.length && !error) return null;
  const active = rows.filter(
    (row) => !["done", "cancelled"].includes(row.status),
  );
  const visible = active.length ? active.slice(0, 12) : rows.slice(0, 3);
  return (
    <section className="mobile-request-status settings-card">
      <h3>手机找歌进度</h3>
      <p>
        准备好后自动加入已点歌曲。手机任务优先排队，正在处理的任务会继续完成。
      </p>
      {error && <p role="status">{error}</p>}
      <ul>
        {visible.map((row) => (
          <li key={row.id}>
            <strong>
              {row.title} <small>{row.artist}</small>
            </strong>
            <span>
              {row.message ||
                stages[row.stage] ||
                {
                  queued: "等待处理",
                  running: "正在整理",
                  review: "等待管理员核对",
                }[row.status] ||
                row.status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
