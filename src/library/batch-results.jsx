import React from "react";
export function BatchResults({ results }) {
  if (!results.length) return null;
  const labels = {
    success: "成功",
    review: "需核对",
    conflict: "冲突",
    failed: "失败",
  };
  return (
    <div className="settings-card" aria-live="polite">
      <h3>逐项处理结果</h3>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>歌曲</th>
              <th>结果</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => (
              <tr key={result.id || index}>
                <td>
                  {result.artist} · {result.title || result.id}
                </td>
                <td>{labels[result.status] || result.status}</td>
                <td>{result.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
