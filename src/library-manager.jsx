import React, { useEffect, useRef, useState } from "react";
import {
  Search,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Plus,
  List,
  LayoutGrid,
} from "lucide-react";
import { TaskList, completedTask } from "./task-list.jsx";
import { TaskActions } from "./task-actions.jsx";
import { Pagination } from "./workbench-controls.jsx";
import { ResourceRow } from "./library/resource-row.jsx";
import { HiddenSong } from "./library/hidden-song.jsx";
import { compareLibraryEntries, librarySorts } from "./library/sorting.js";
import { matchesResourceFilters, resourceFilters } from "./library/filters.js";
import "./library/controls.css";
import { VideoReview } from "./library/video-review.jsx";
import { SourceImport } from "./library/source-import.jsx";
import { BatchResults } from "./library/batch-results.jsx";
import {
  refreshMetadataBatch,
  organizeBatch,
  standardizeBatch,
} from "./library/batch.js";
export { LyricsSettings } from "./library/lyrics-settings.jsx";
const tiers = [
  ["pending", "待整理曲库"],
  ["audio", "半标准曲库"],
  ["standard", "标准曲库"],
  ["hidden", "已隐藏"],
];
export function LibraryManager({ request, notify, onEdit }) {
  const [songs, setSongs] = useState([]),
    [tasks, setTasks] = useState([]),
    [hiddenSongs, setHiddenSongs] = useState([]),
    [reviews, setReviews] = useState([]);
  const [tab, setTab] = useState("pending"),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [results, setResults] = useState([]);
  const [page, setPage] = useState(1),
    [sort, setSort] = useState(() => {
      try {
        const value = localStorage.getItem("haohaochang.librarySort");
        return librarySorts.some(([id]) => id === value) ? value : "title";
      } catch {
        return "title";
      }
    }),
    [grouped, setGrouped] = useState(false);
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem("haohaochang.libraryView") === "posters"
        ? "posters"
        : "list";
    } catch {
      return "list";
    }
  });
  const [openGroups, setOpenGroups] = useState({}),
    [collapseKey, setCollapseKey] = useState(0),
    [selected, setSelected] = useState(new Set());
  const [taskOpen, setTaskOpen] = useState(false),
    [importOpen, setImportOpen] = useState(false);
  const visited = useRef(new Set());
  const [missing, setMissing] = useState([]);
  const [resolution, setResolution] = useState("");
  const allCheckbox = useRef(null);
  async function refresh() {
    const [library, pending, inbox, hidden, jobs] = await Promise.all([
      request("/admin/library"),
      request("/admin/reviews"),
      request("/admin/inbox"),
      request("/admin/library?hidden=true"),
      request("/admin/tasks").catch(() => []),
    ]);
    setSongs(library);
    setTasks(Array.isArray(jobs) ? jobs : []);
    setReviews([...pending, ...inbox]);
    setHiddenSongs(hidden);
  }
  useEffect(() => {
    refresh().catch((error) => notify(error.message));
    const timer = setInterval(
      () => refresh().catch((error) => notify(error.message)),
      10000,
    );
    return () => clearInterval(timer);
  }, []);
  async function action(fn) {
    setBusy(true);
    try {
      return await fn();
    } catch (error) {
      notify(error.message);
    } finally {
      try {
        await refresh();
      } catch (error) {
        notify(error.message);
      }
      setBusy(false);
    }
  }
  const entries = [
    ...reviews.map((row) => ({
      key: `review:${row.inbox ? "inbox" : "review"}:${row.id || row.file}`,
      row,
      review: true,
      tier: "pending",
    })),
    ...songs.map((row) => ({ key: `song:${row.id}`, row, tier: row.tier })),
    ...hiddenSongs.map((row) => ({
      key: `hidden:${row.id}`,
      row,
      tier: "hidden",
    })),
  ];
  const matches = ({ row }) =>
    `${row.title || ""} ${row.artist || ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const filtered = entries
    .filter(
      (e) =>
        e.tier === tab &&
        matches(e) &&
        matchesResourceFilters(e.row, missing, resolution),
    )
    .sort((a, b) => compareLibraryEntries(a, b, sort, grouped));
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / 20)),
  );
  const visible = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const visibleKeys = new Set(visible.map((e) => e.key));
  visible.forEach((e) => visited.current.add(e.key));
  const chosen = entries.filter(
    (e) => selected.has(e.key) && e.tier === tab && e.tier !== "hidden",
  );
  const allSelected =
    filtered.length > 0 && filtered.every((e) => selected.has(e.key));
  useEffect(() => {
    if (allCheckbox.current)
      allCheckbox.current.indeterminate =
        !allSelected && filtered.some((e) => selected.has(e.key));
  }, [allSelected, selected, tab, query, songs, reviews, missing, resolution]);
  const missingLyrics = songs.filter((song) => !song.lyrics?.trim()).length;
  const batchEntries = chosen.length ? chosen : filtered;
  const batchSongs = batchEntries.filter((e) => !e.review).map((e) => e.row);
  const batchReviews = batchEntries.filter((e) => e.review).map((e) => e.row);
  const artists = [...new Set(visible.map((e) => e.row.artist || "未知歌手"))];
  const groupOpen = (artist) => openGroups[`${tab}:${artist}`] ?? true;
  function changeTab(id) {
    setTab(id);
    setPage(1);
    setSelected(new Set());
    setCollapseKey((v) => v + 1);
  }
  function expandAll(open) {
    setOpenGroups((v) => ({
      ...v,
      ...Object.fromEntries(artists.map((a) => [`${tab}:${a}`, open])),
    }));
    if (!open) setCollapseKey((v) => v + 1);
  }
  function choose(key) {
    setSelected((v) => {
      const next = new Set(v);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function batch(fn) {
    return action(async () => {
      setResults([]);
      const result = await fn();
      notify(`本批 ${result.length} 首，提交结果可在下方查看`);
    });
  }
  const activeTasks = tasks.filter((j) => !completedTask(j));
  return (
    <section className="library-workspace">
      <div className="section-heading">
        <div>
          <h2>曲库管理</h2>
          <p>先找到歌曲，再处理需要补充的资源。</p>
        </div>
        <div className="actions">
          <button
            disabled={busy || !missingLyrics}
            title="补充整个未隐藏曲库的缺失歌词，已有歌词保留；播放中或整理中的歌曲会跳过"
            onClick={() =>
              batch(async () => {
                const response = await request(
                  "/admin/lyrics-batch",
                  { all: true },
                  "POST",
                );
                setResults(response.results);
                setTaskOpen(true);
                return response.results;
              })
            }
          >
            补充全部缺失歌词 · {missingLyrics}
          </button>
          <button
            onClick={() => setImportOpen((v) => !v)}
            aria-expanded={importOpen}
          >
            <Plus size={16} />
            添加链接
          </button>
          <button disabled={busy} onClick={() => action(async () => {})}>
            <RefreshCw size={16} />
            刷新列表
          </button>
        </div>
      </div>
      <div hidden={!importOpen}>
        <SourceImport {...{ request, action, busy, notify }} />
      </div>
      <section className="library-task-summary">
        <button
          className="group-heading"
          aria-expanded={taskOpen}
          onClick={() => setTaskOpen((v) => !v)}
        >
          {taskOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <strong>整理任务</strong>
          <span>
            {activeTasks.filter((j) => j.status === "running").length} 处理中 ·{" "}
            {
              activeTasks.filter((j) =>
                ["queued", "waiting-worker"].includes(j.status),
              ).length
            }{" "}
            等待 · {activeTasks.filter((j) => j.status === "failed").length}{" "}
            失败
          </span>
          <small>{taskOpen ? "收起任务" : "查看任务"}</small>
        </button>
        <div hidden={!taskOpen}>
          <TaskList
            jobs={tasks}
            label="曲库任务"
            actions={(job) => <TaskActions {...{ job, request, refresh }} />}
          />
        </div>
      </section>
      <div className="library-tabs" aria-label="曲库分类">
        {tiers.map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            aria-pressed={tab === id}
            onClick={() => changeTab(id)}
          >
            {label} · {entries.filter((e) => e.tier === id).length}
          </button>
        ))}
      </div>
      <div className="library-collection">
        <div className="list-toolbar">
          <label className="list-search">
            <Search size={16} />
            <input
              aria-label="筛选曲库"
              placeholder="筛选歌名或歌手"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
                setSelected(new Set());
              }}
            />
          </label>
          <div
            className="library-sort-buttons"
            role="group"
            aria-label="歌曲排序"
          >
            {[
              ["title", "歌名"],
              ["artist", "歌手"],
              ["created", "时间"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={sort.split("-")[0] === id}
                data-sort={id}
                onClick={() => {
                  const next = sort === id ? `${id}-desc` : id;
                  setSort(next);
                  setPage(1);
                  try {
                    localStorage.setItem("haohaochang.librarySort", next);
                  } catch {}
                }}
              >
                {label}
                {sort.split("-")[0] === id
                  ? sort.endsWith("-desc")
                    ? "↓"
                    : "↑"
                  : ""}
              </button>
            ))}
          </div>
          <div
            className="library-view-switch"
            role="group"
            aria-label="曲库展示方式"
          >
            {[
              ["list", "行列表", List],
              ["posters", "海报墙", LayoutGrid],
            ].map(([id, label, Icon]) => (
              <button
                key={id}
                aria-pressed={view === id}
                onClick={() => {
                  setView(id);
                  try {
                    localStorage.setItem("haohaochang.libraryView", id);
                  } catch {}
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={grouped}
              onChange={(e) => setGrouped(e.target.checked)}
            />
            按歌手分组
          </label>
        </div>
        <div
          className="library-resource-filters"
          role="group"
          aria-label="资源筛选"
        >
          {resourceFilters.map(([id, label]) => (
            <button
              key={id}
              aria-pressed={missing.includes(id)}
              onClick={() => {
                setMissing((values) =>
                  values.includes(id)
                    ? values.filter((v) => v !== id)
                    : [...values, id],
                );
                setPage(1);
                setSelected(new Set());
              }}
            >
              {label}
            </button>
          ))}
          <label>
            视频分辨率
            <select
              aria-label="视频分辨率筛选"
              value={resolution}
              onChange={(event) => {
                setResolution(event.target.value);
                setPage(1);
                setSelected(new Set());
              }}
            >
              <option value="">全部分辨率</option>
              {[2160, 1440, 1080, 720, 480, 360].map((h) => (
                <option key={h} value={h}>
                  {h}p{h === 2160 ? "及以上" : "档"}
                </option>
              ))}
              <option value="low">低于360p</option>
              <option value="unknown">分辨率待识别</option>
              <option value="none">无视频</option>
            </select>
          </label>
          {(missing.length > 0 || resolution) && (
            <button
              onClick={() => {
                setMissing([]);
                setResolution("");
                setPage(1);
                setSelected(new Set());
              }}
            >
              清除资源筛选
            </button>
          )}
          <small>多项筛选同时满足</small>
        </div>
        <div className="collection-description">
          <span>
            {tab === "pending"
              ? "原始媒体等待整理；歌词未找到也会继续。"
              : tab === "audio"
                ? "原唱、伴奏可用，等待补充视频画面。"
                : tab === "standard"
                  ? "画面、原唱、伴奏已准备，可随时点唱。"
                  : "媒体仍保留，可恢复歌曲，或彻底删除歌曲及对应媒体。"}
            {grouped && " 分组时先按歌手排列，组内使用所选排序。"}
          </span>
          <small>每 10 秒自动刷新</small>
        </div>
        <div className="collection-actions">
          <div className="actions collection-selection">
            {tab !== "hidden" && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  ref={allCheckbox}
                  aria-label="全选当前筛选歌曲（所有分页）"
                  disabled={busy || !filtered.length}
                  checked={allSelected}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set(filtered.map((item) => item.key))
                        : new Set(),
                    )
                  }
                />
                全选（所有分页）
              </label>
            )}
            {tab !== "hidden" && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  aria-label="选择本页歌曲"
                  checked={
                    visible.length > 0 &&
                    visible.every((e) => selected.has(e.key))
                  }
                  onChange={(e) =>
                    setSelected((v) => {
                      const next = new Set(v);
                      visible.forEach((item) =>
                        e.target.checked
                          ? next.add(item.key)
                          : next.delete(item.key),
                      );
                      return next;
                    })
                  }
                />
                本页
              </label>
            )}
            <span>
              {chosen.length
                ? `已选 ${chosen.length} 首（可跨页）`
                : `筛选结果 ${filtered.length} 首`}
            </span>
            {chosen.length > 0 && (
              <button onClick={() => setSelected(new Set())}>取消选择</button>
            )}
          </div>
          {grouped && (
            <div className="actions">
              <button
                disabled={!grouped || !visible.length}
                onClick={() => expandAll(true)}
              >
                展开本页
              </button>
              <button onClick={() => expandAll(false)}>全部收起</button>
            </div>
          )}
        </div>
        {tab !== "hidden" && (
          <div className="batch-toolbar">
            <span>
              操作范围：{chosen.length ? "已选" : "当前筛选"}{" "}
              {batchEntries.length} 首
            </span>
            {["pending", "audio"].includes(tab) && (
              <button
                className="primary"
                disabled={busy || !batchEntries.length}
                onClick={() =>
                  batch(() =>
                    organizeBatch(
                      batchSongs,
                      batchReviews,
                      request,
                      setResults,
                    ),
                  )
                }
              >
                {chosen.length
                  ? "整理所选"
                  : query
                    ? "整理筛选结果"
                    : "全部整理"}
              </button>
            )}
            <button
              disabled={busy || !batchSongs.length}
              onClick={() =>
                batch(() =>
                  refreshMetadataBatch(batchSongs, request, setResults),
                )
              }
            >
              重新识别歌名与歌手
            </button>
            <button
              disabled={busy || !batchSongs.length}
              onClick={() =>
                batch(async () => {
                  const result = [];
                  for (let start = 0; start < batchSongs.length; start += 20) {
                    const response = await request(
                      "/admin/lyrics-batch",
                      {
                        items: batchSongs
                          .slice(start, start + 20)
                          .map((row) => ({
                            id: row.id,
                            expectedRevision: row.metadataRevision,
                          })),
                      },
                      "POST",
                    );
                    result.push(...response.results);
                    setResults([...result]);
                  }
                  setTaskOpen(true);
                  return result;
                })
              }
            >
              补充{chosen.length ? "所选" : "筛选结果"}缺失歌词
            </button>
            <button
              disabled={busy || !batchSongs.length}
              onClick={() =>
                batch(async () => {
                  const result = [];
                  for (let start = 0; start < batchSongs.length; start += 20) {
                    const rows = batchSongs.slice(start, start + 20);
                    const response = await request(
                      "/admin/poster-batch",
                      {
                        items: rows.map((row) => ({
                          id: row.id,
                          expectedRevision: row.metadataRevision,
                        })),
                      },
                      "POST",
                    );
                    result.push(
                      ...response.results.map((item) => ({
                        ...item,
                        title:
                          rows.find((row) => row.id === item.id)?.title ||
                          "歌曲",
                      })),
                    );
                    setResults([...result]);
                  }
                  return result;
                })
              }
            >
              补充歌曲封面
            </button>
            {tab === "standard" && (
              <details className="library-tools">
                <summary>曲库维护</summary>
                <div>
                  <p>
                    每首只保留当前画面，保留音轨和歌词；播放中或已点入队列的歌曲会跳过。
                  </p>
                  <button
                    disabled={busy || !batchSongs.length}
                    onClick={() =>
                      batch(() =>
                        standardizeBatch(batchSongs, request, setResults),
                      )
                    }
                  >
                    老版本多视频合一
                  </button>
                </div>
              </details>
            )}
          </div>
        )}
        <div
          className={`library-rows ${view === "posters" ? "library-posters" : "library-list"}`}
        >
          {entries
            .filter((e) => visited.current.has(e.key))
            .sort((a, b) => {
              const ai = visible.findIndex((v) => v.key === a.key),
                bi = visible.findIndex((v) => v.key === b.key);
              return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
            })
            .map((entry) => {
              const { key, row, review } = entry;
              const artist = row.artist || "未知歌手";
              const onPage = visibleKeys.has(key);
              const first =
                onPage &&
                visible.find((e) => (e.row.artist || "未知歌手") === artist)
                  ?.key === key;
              const hidden = !onPage || (grouped && !groupOpen(artist));
              return (
                <React.Fragment key={key}>
                  {first && grouped && (
                    <button
                      className="group-heading artist-library"
                      aria-expanded={groupOpen(artist)}
                      onClick={() =>
                        setOpenGroups((v) => ({
                          ...v,
                          [`${tab}:${artist}`]: !groupOpen(artist),
                        }))
                      }
                    >
                      {groupOpen(artist) ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                      <strong>{artist}</strong>
                      <span>
                        本页{" "}
                        {
                          visible.filter(
                            (e) => (e.row.artist || "未知歌手") === artist,
                          ).length
                        }{" "}
                        首
                      </span>
                      <small>{groupOpen(artist) ? "收起" : "展开"}</small>
                    </button>
                  )}
                  {entry.tier === "hidden" ? (
                    <HiddenSong
                      {...{ row, hidden, request, action, busy, notify }}
                    />
                  ) : review && row.kind === "find-video" ? (
                    <VideoReview
                      {...{
                        row,
                        request,
                        action,
                        busy,
                        notify,
                        hidden,
                        collapseKey,
                      }}
                      selected={selected.has(key)}
                      onSelect={() => choose(key)}
                    />
                  ) : (
                    <ResourceRow
                      {...{
                        row,
                        request,
                        action,
                        busy,
                        notify,
                        hidden,
                        collapseKey,
                      }}
                      review={review}
                      selected={selected.has(key)}
                      onSelect={() => choose(key)}
                      onEdit={!review && onEdit ? () => onEdit(row) : undefined}
                    />
                  )}
                </React.Fragment>
              );
            })}
        </div>
        {!filtered.length && (
          <p className="list-empty">这个分类暂时没有匹配歌曲。</p>
        )}
        <Pagination
          total={filtered.length}
          page={currentPage}
          onPage={(value) => {
            setPage(value);
            setCollapseKey((v) => v + 1);
          }}
        />
      </div>
      <BatchResults results={results} />
    </section>
  );
}
