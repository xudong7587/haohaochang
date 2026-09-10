import React from "react";
export function Pagination({
  total,
  page,
  pageSize = 20,
  onPage,
  label = "歌曲",
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="list-pagination" aria-label={`${label}分页`}>
      <span>
        {total
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`
          : "0"}{" "}
        / {total} 项
      </span>
      <div className="actions">
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label={`${label}上一页`}
        >
          上一页
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label={`${label}下一页`}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
