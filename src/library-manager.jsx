import React, { useEffect, useState } from "react";
import { ResourceRow } from "./library/resource-row.jsx";
import { VideoReview } from "./library/video-review.jsx";
import { SourceImport } from "./library/source-import.jsx";
import { BatchResults } from "./library/batch-results.jsx";
import {
  refreshMetadataBatch,
  organizeBatch,
  standardizeBatch,
} from "./library/batch.js";
export { LyricsSettings } from "./library/lyrics-settings.jsx";

export function LibraryManager({ request, notify, onEdit }) {
  const [songs, setSongs] = useState([]),
    [hiddenSongs, setHiddenSongs] = useState([]),
    [reviews, setReviews] = useState([]);
  const [tab, setTab] = useState("pending"),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [results, setResults] = useState([]);
  async function refresh() {
    const [library, pending, inbox, hidden] = await Promise.all([
      request("/admin/library"),
      request("/admin/reviews"),
      request("/admin/inbox"),
      request("/admin/library?hidden=true"),
    ]);
    setSongs(library);
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
  const matches = (row) =>
    (String(row.title || "") + " " + String(row.artist || ""))
      .toLowerCase()
      .includes(query.toLowerCase());
  const visibleCount =
    tab === "hidden"
      ? hiddenSongs.filter(matches).length
      : songs.filter((song) => song.tier === tab && matches(song)).length +
        (tab === "pending" ? reviews.filter(matches).length : 0);
  return (
    <section>
      <div className="section-heading">
        <div>
          <h2>曲库管理</h2>
          <p>按歌曲整理信息、MV、原唱、伴奏和歌词。</p>
        </div>
        <div className="actions">
          <button
            disabled={busy || !songs.length}
            onClick={() =>
              action(async () => {
                setResults([]);
                const completed = await refreshMetadataBatch(
                  songs,
                  request,
                  setResults,
                );
                notify(`本批已处理 ${completed.length} 首，请查看逐项结果`);
              })
            }
          >
            重新识别歌名与歌手
          </button>
          <button disabled={busy} onClick={() => action(async () => {})}>
            刷新列表
          </button>
        </div>
      </div>
      <p className="note">
        “重新识别歌名与歌手”会批量更新歌曲名称；“刷新列表”只读取最新任务和曲库状态。列表也会每
        10 秒自动刷新。
      </p>
      <BatchResults results={results} />
      <SourceImport {...{ request, action, busy, notify }} />
      <div className="library-tabs">
        {[
          ["pending", "待整理曲库"],
          ["audio", "半标准曲库"],
          ["standard", "标准曲库"],
          ["hidden", "已隐藏"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label} ·{" "}
            {id === "hidden"
              ? hiddenSongs.length
              : songs.filter((song) => song.tier === id).length +
                (id === "pending" ? reviews.length : 0)}
          </button>
        ))}
      </div>
      {["pending", "audio"].includes(tab) && (
        <div className="actions tier-actions">
          {" "}
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              action(async () => {
                setResults([]);
                const completed = await organizeBatch(
                  songs.filter((song) => song.tier === tab),
                  tab === "pending" ? reviews : [],
                  request,
                  setResults,
                );
                notify(
                  `已提交 ${completed.filter((r) => r.status === "success").length} 首，逐项结果见下方`,
                );
              })
            }
          >
            全部整理
          </button>
        </div>
      )}
      {tab === "standard" && (
        <div className="actions tier-actions">
          <button
            className="primary"
            disabled={busy || !songs.some((song) => song.tier === "standard")}
            onClick={() =>
              action(async () => {
                setResults([]);
                const completed = await standardizeBatch(
                  songs,
                  request,
                  setResults,
                );
                notify(
                  `已提交 ${completed.filter((result) => result.status === "success").length} 首，逐项结果见下方`,
                );
              })
            }
          >
            整理已有标准曲库
          </button>
          <small>
            检查旧格式、保留已有双音轨并回收过期版本；播放中的歌曲会跳过。
          </small>
        </div>
      )}
      <input
        aria-label="筛选曲库"
        placeholder="筛选歌名或歌手"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p>
        {tab === "pending"
          ? "原始媒体等待整理。确认歌名和歌手后即可开始，自动查找歌词，找不到也会继续。"
          : tab === "audio"
            ? "原唱、伴奏已准备，可直接唱；等待补充匹配视频，歌词可选。"
            : tab === "hidden"
              ? "已隐藏歌曲保留媒体文件，恢复后重新按资源能力分类。"
              : "画面、原唱、伴奏已准备，歌词可随时补充。"}
      </p>
      {reviews.map((row) =>
        row.kind === "find-video" ? (
          <VideoReview
            key={"review" + row.id}
            {...{ row, request, action, busy, notify }}
            hidden={tab !== "pending" || !matches(row)}
          />
        ) : (
          <ResourceRow
            key={"review" + row.id}
            {...{ row, request, action, busy, notify }}
            review
            hidden={tab !== "pending" || !matches(row)}
          />
        ),
      )}
      {songs
        .filter((row) => row.tier !== "standard")
        .map((row) => (
          <ResourceRow
            key={row.id}
            {...{ row, request, action, busy, notify }}
            hidden={row.tier !== tab || !matches(row)}
            onEdit={onEdit ? () => onEdit(row) : undefined}
          />
        ))}
      {[
        ...new Set(
          songs
            .filter((row) => row.tier === "standard")
            .map((row) => row.artist || "未知歌手"),
        ),
      ]
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((artist) => (
          <details
            className="artist-library settings-card"
            key={artist}
            hidden={
              tab !== "standard" ||
              !songs.some(
                (row) =>
                  row.tier === "standard" &&
                  (row.artist || "未知歌手") === artist &&
                  matches(row),
              )
            }
          >
            <summary>
              {artist} ·{" "}
              {
                songs.filter(
                  (row) =>
                    row.tier === "standard" &&
                    (row.artist || "未知歌手") === artist &&
                    matches(row),
                ).length
              }{" "}
              首
            </summary>
            <div className="artist-song-list">
              {songs
                .filter(
                  (row) =>
                    row.tier === "standard" &&
                    (row.artist || "未知歌手") === artist,
                )
                .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"))
                .map((row) => (
                  <ResourceRow
                    key={row.id}
                    {...{ row, request, action, busy, notify }}
                    hidden={!matches(row)}
                    onEdit={onEdit ? () => onEdit(row) : undefined}
                  />
                ))}
            </div>
          </details>
        ))}
      {tab === "hidden" &&
        hiddenSongs.filter(matches).map((song) => (
          <article className="workbench-row" key={song.id}>
            <strong>
              {song.title} — {song.artist}
            </strong>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await request(
                      "/admin/library/" + song.id + "/restore",
                      {},
                      "POST",
                    );
                    notify("歌曲已恢复");
                  })
                }
              >
                恢复歌曲
              </button>
            </div>
          </article>
        ))}
      {!visibleCount && <p>这个分类暂时没有匹配歌曲。</p>}
    </section>
  );
}
