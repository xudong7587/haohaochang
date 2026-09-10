import React, { useState } from "react";
import { Pagination } from "../workbench-controls.jsx";
const labels = {
  success: "已提交",
  review: "需核对",
  conflict: "冲突",
  failed: "失败",
  skipped: "已跳过",
  pending: "等待提交",
};
export function BatchResults({ results }) {
  const [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1);
  if (!results.length) return null;
  const needsAttention = (r) =>
    ["review", "conflict", "failed"].includes(r.status);
  const rows = results.filter(
    (r) =>
      filter === "all" ||
      (filter === "attention"
        ? needsAttention(r)
        : ["success", "skipped"].includes(r.status)),
  );
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 10)));
  return (
    <details className="batch-results settings-card">
      <summary>
        <strong>批量处理结果 · {results.length} 首</strong>
        <span aria-live="polite">
          {" "}
          {results.filter((r) => r.status === "pending").length} 等待 ·{" "}
          {results.filter(needsAttention).length} 需处理 ·{" "}
          {
            results.filter((r) => ["success", "skipped"].includes(r.status))
              .length
          }{" "}
          已返回结果
        </span>
      </summary>
      <div className="detail-tabs">
        {[
          ["all", "全部结果"],
          ["attention", "需要处理"],
          ["success", "提交与跳过"],
        ].map(([id, name]) => (
          <button
            key={id}
            aria-pressed={filter === id}
            onClick={() => {
              setFilter(id);
              setPage(1);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="batch-result-table">
        <table>
          <thead>
            <tr>
              <th>歌曲</th>
              <th>结果</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice((current - 1) * 10, current * 10).map((r, i) => (
              <tr key={`${r.id}:${i}`}>
                <td>
                  {r.artist} · {r.title || r.id}
                </td>
                <td>{labels[r.status] || r.status}</td>
                <td>{r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="list-empty">这类结果为空。</p>}
      <Pagination
        total={rows.length}
        page={current}
        pageSize={10}
        onPage={setPage}
        label="批量结果"
      />
    </details>
  );
}
