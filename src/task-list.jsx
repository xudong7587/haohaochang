import React, { useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Pagination } from "./workbench-controls.jsx";
export const completedTask = (job) =>
  ["done", "cancelled"].includes(job.status);
export const taskKindNames = {
  poster: "刮削歌曲封面",
  "attach-video": "补充视频",
  "upgrade-hd": "升级高清画面",
  "compatible-video": "转换兼容画面",
  acquire: "自动找歌",
  "find-video": "补充 MTV",
  "favorite-sync": "检查收藏夹",
  "favorite-download": "收藏夹下载",
  enrich: "识别资料",
  import: "下载入库",
  organize: "整理歌曲",
  scan: "扫描媒体目录",
  prepare: "准备播放资源",
  standardize: "多视频合一",
  "resource-cleanup": "回收旧资源",
  download: "下载资源",
};
const stages = {
  "poster-search": "查找歌曲封面",
  "poster-save": "保存封面",
  downloading: "下载视频",
  clipping: "裁剪片段",
  decoding: "提取音频",
  separating: "分离伴奏",
  validating: "校验资源",
  preparing: "准备播放资源",
  "preparing-video": "NAS 准备画面与校验",
  "preparing-video-pc": "PC 转换画面",
  "validating-video-pc": "PC 校验画面",
  "preparing-audio": "NAS 准备音轨与校验",
  "resource-cleanup": "回收旧资源",
};
const statusLabels = {
  running: "处理中",
  queued: "排队中",
  uploading: "上传中",
  "waiting-worker": "等待 PC 上线",
  failed: "处理失败",
  review: "等待核对",
  done: "已完成",
  cancelled: "已取消",
};
export function taskGroup(job) {
  if (completedTask(job)) return "history";
  if (["failed", "waiting-worker", "review"].includes(job.status))
    return "attention";
  if (["running", "uploading"].includes(job.status)) return "running";
  return "queued";
}
const groups = [
  ["running", "正在处理"],
  ["attention", "需要关注"],
  ["queued", "排队等待"],
  ["history", "已完成记录"],
];
export function TaskList({
  jobs = [],
  actions,
  label = "任务",
  activeOnly = false,
  historyOnly = false,
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState({ running: true, attention: true });
  const [pages, setPages] = useState({});
  const [details, setDetails] = useState({});
  const eligible = jobs.filter(
    (j) =>
      (!activeOnly || !completedTask(j)) && (!historyOnly || completedTask(j)),
  );
  const matched = eligible.filter((j) =>
    `${j.title || ""} ${j.artist || ""} ${taskKindNames[j.kind] || ""} ${j.error || ""} ${j.id}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const count = (id) => eligible.filter((j) => taskGroup(j) === id).length;
  return (
    <div className="task-board" aria-label={label}>
      <div className="task-overview">
        <button
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          <span>全部任务</span>
          <strong>{eligible.length}</strong>
        </button>
        {groups
          .filter(
            ([id]) =>
              (!activeOnly || id !== "history") &&
              (!historyOnly || id === "history"),
          )
          .map(([id, title]) => (
            <button
              key={id}
              data-tone={id}
              aria-pressed={filter === id}
              onClick={() => {
                setFilter(id);
                setExpanded((v) => ({ ...v, [id]: true }));
              }}
            >
              <span>{title}</span>
              <strong>{count(id)}</strong>
            </button>
          ))}
      </div>
      <div className="list-toolbar">
        <label className="list-search">
          <Search size={16} />
          <input
            aria-label={`搜索${label}`}
            placeholder="搜索歌曲、歌手或任务"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPages({});
              setExpanded(Object.fromEntries(groups.map(([id]) => [id, true])));
            }}
          />
        </label>
        <div className="actions">
          <button
            onClick={() =>
              setExpanded(Object.fromEntries(groups.map(([id]) => [id, true])))
            }
          >
            展开分组
          </button>
          <button
            onClick={() => {
              setExpanded({});
              setDetails({});
            }}
          >
            全部收起
          </button>
        </div>
      </div>
      {groups
        .filter(([id]) => filter === "all" || filter === id)
        .map(([id, title]) => {
          const rows = matched.filter((j) => taskGroup(j) === id);
          if (!rows.length) return null;
          const page = Math.min(pages[id] || 1, Math.ceil(rows.length / 10));
          const open = !!expanded[id];
          return (
            <section
              className={`task-group ${id === "history" ? "task-history" : ""}`}
              key={id}
            >
              <button
                className="group-heading"
                aria-expanded={open}
                onClick={() => setExpanded((v) => ({ ...v, [id]: !open }))}
              >
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <strong>{title}</strong>
                <span className={`status-dot ${id}`} />
                <span>{rows.length} 项</span>
                <small>{open ? "收起" : "展开"}</small>
              </button>
              {open && (
                <>
                  <div className="task-rows">
                    {rows.slice((page - 1) * 10, page * 10).map((j) => {
                      const pct = j.media_progress?.percent ?? j.model_progress;
                      const stage =
                        j.media_progress?.label ||
                        stages[j.stage] ||
                        statusLabels[j.status] ||
                        j.status;
                      const isOpen = !!details[j.id];
                      return (
                        <article
                          className="task-item"
                          key={j.id}
                          data-task-id={j.id}
                        >
                          <div className="task-line">
                            <button
                              className="task-title"
                              aria-expanded={isOpen}
                              onClick={() =>
                                setDetails((v) => ({ ...v, [j.id]: !isOpen }))
                              }
                            >
                              {isOpen ? (
                                <ChevronDown size={15} />
                              ) : (
                                <ChevronRight size={15} />
                              )}
                              <span>
                                <strong className="task-song">
                                  {j.title || "后台任务"}
                                </strong>
                                <small>
                                  {[
                                    j.artist,
                                    taskKindNames[j.kind] || j.model,
                                    j.origin,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || "歌曲整理"}
                                </small>
                              </span>
                            </button>
                            <div className="task-stage">
                              <span className={`task-status ${taskGroup(j)}`}>
                                {stage}
                              </span>
                              {Number.isFinite(pct) && !completedTask(j) && (
                                <div className="task-meter">
                                  <progress
                                    aria-label={stage}
                                    max="100"
                                    value={pct}
                                  />
                                  <small>{pct}%</small>
                                </div>
                              )}
                            </div>
                            {actions && (
                              <div className="task-actions">{actions(j)}</div>
                            )}
                          </div>
                          {j.error && !isOpen && (
                            <p className="task-error-preview" title={j.error}>
                              {j.error}
                            </p>
                          )}
                          {isOpen && (
                            <div className="task-detail">
                              <p>
                                {statusLabels[j.status] || j.status}
                                {j.priority === "online" ? " · 优先处理" : ""}
                                {j.created
                                  ? ` · ${new Date(j.created < 1e12 ? j.created * 1000 : j.created).toLocaleString()}`
                                  : ""}
                              </p>
                              <p>
                                {j.elapsed_seconds !== undefined
                                  ? `PC 任务经过 ${j.elapsed_seconds} 秒（含排队）`
                                  : j.started
                                    ? `处理耗时 ${Math.max(0, Math.round(((j.finished || Date.now()) - j.started) / 1000))} 秒`
                                    : "尚未开始处理"}
                              </p>
                              {j.error && <p className="error">{j.error}</p>}
                              {j.log && <pre>{j.log}</pre>}
                              <small>任务编号：{j.id}</small>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                  <Pagination
                    total={rows.length}
                    page={page}
                    pageSize={10}
                    onPage={(value) => setPages((v) => ({ ...v, [id]: value }))}
                    label={title}
                  />
                </>
              )}
            </section>
          );
        })}
      {!matched.some((j) => filter === "all" || taskGroup(j) === filter) && (
        <p className="list-empty">
          {query ? "没有匹配任务，试试其他歌名或歌手。" : "当前没有这类任务。"}
        </p>
      )}
    </div>
  );
}
