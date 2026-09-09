import React, { useEffect, useRef, useState } from "react";
import { api, roomToken } from "./api.js";
import { Modal } from "./components.jsx";
import { rankVideos } from "../shared/video-ranking.js";

const time = (n) =>
  `${Math.floor((n || 0) / 60)}:${((n || 0) % 60).toFixed(1).padStart(4, "0")}`;
const mediaUrl = (url) =>
  url ? `${url}?token=${encodeURIComponent(roomToken)}` : undefined;

function VideoPreview({ selection, close, notify }) {
  const video = useRef(null),
    audio = useRef(null);
  const [reload, setReload] = useState(0),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [start, setStart] = useState(null),
    [end, setEnd] = useState(null),
    [position, setPosition] = useState(0),
    [busy, setBusy] = useState(false),
    [added, setAdded] = useState(false);
  const { row, title, artist } = selection;
  useEffect(() => {
    let live = true;
    setError("");
    setPreview(null);
    api("/online/preview", { url: row.url, refresh: reload > 0 }, "POST")
      .then((v) => {
        if (live) setPreview(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [row.url, reload]);
  function sync(force = false) {
    const v = video.current,
      a = audio.current;
    if (!v || !a) return;
    if (force || Math.abs(a.currentTime - v.currentTime) > 0.15)
      a.currentTime = v.currentTime;
    a.volume = v.volume;
    a.muted = v.muted;
    a.playbackRate = v.playbackRate;
  }
  function play() {
    setError("");
    sync(true);
    const pending = [video.current?.play(), audio.current?.play()].filter(
      Boolean,
    );
    Promise.all(pending).catch((error) => {
      if (error.name === "AbortError") return;
      video.current?.pause();
      audio.current?.pause();
      setError("视频暂时无法播放，请重开预览；也可以直接加入曲库。");
    });
  }
  function pause() {
    video.current?.pause();
    audio.current?.pause();
  }
  async function add() {
    setBusy(true);
    setError("");
    try {
      await api(
        "/online",
        {
          url: row.url,
          title,
          artist,
          onlineSelection: true,
          previewId: preview?.id,
          clip: start !== null || end !== null ? { start, end } : null,
        },
        "POST",
      );
      setAdded(true);
      notify(
        "已加入整理任务：下载 → PC 裁剪与分离 → 入库。可在后台任务查看进度。",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const invalid = (end ?? preview?.duration ?? Infinity) <= (start ?? 0);
  return (
    <Modal
      title={`${title} · ${artist}`}
      close={close}
      className="video-preview-modal"
    >
      <div className="song-preview">
        <p className="preview-source-title">{row.title}</p>
        {preview ? (
          <>
            <video
              ref={video}
              src={mediaUrl(preview.video)}
              controls
              playsInline
              preload="metadata"
              aria-label="B站视频预览"
              onTimeUpdate={() => {
                setPosition(video.current.currentTime);
                sync();
              }}
              onSeeking={() => sync(true)}
              onSeeked={() => {
                sync(true);
                if (!video.current.paused)
                  audio.current
                    ?.play()
                    .catch(() => setError("请点击播放以启用声音"));
              }}
              onPlay={() => {
                sync();
                audio.current?.play().catch((error) => {
                  if (error.name !== "AbortError")
                    setError("请点击下方播放按钮以启用声音");
                });
              }}
              onPause={() => audio.current?.pause()}
              onWaiting={() => audio.current?.pause()}
              onPlaying={() => {
                if (audio.current?.paused) audio.current.play().catch(() => {});
              }}
              onEnded={pause}
              onVolumeChange={() => sync()}
              onRateChange={() => sync()}
              onError={() => setError("预览流不可用，请重新打开视频。")}
            />
            {preview.audio && (
              <audio
                ref={audio}
                src={mediaUrl(preview.audio)}
                preload="auto"
                onError={() => setError("预览声音加载失败，请重新打开视频。")}
              />
            )}
          </>
        ) : (
          <div className="preview-loading">
            {error ? "预览暂不可用" : "正在读取 B站视频流…"}
          </div>
        )}
        <div className="preview-actions">
          <button onClick={play} disabled={!preview}>
            播放
          </button>
          <button onClick={pause} disabled={!preview}>
            暂停
          </button>
          <button
            className="primary"
            onClick={add}
            disabled={busy || invalid || added}
          >
            {added ? "已加入整理任务" : busy ? "提交中…" : "加入曲库"}
          </button>
        </div>
        <div className="clip-panel">
          <strong>选取有效区间</strong>
          <p>
            当前 {time(position)} ·{" "}
            {preview ? `全长 ${time(preview.duration)}` : "正在获取时长"}
            。不标记则使用全部视频。
          </p>
          <div className="preview-actions">
            <button
              disabled={!preview || added}
              onClick={() => setStart(video.current.currentTime)}
            >
              标记开头
            </button>
            <button
              disabled={!preview || added}
              onClick={() => setEnd(video.current.currentTime)}
            >
              标记结束
            </button>
            <button
              disabled={added}
              onClick={() => {
                setStart(null);
                setEnd(null);
              }}
            >
              恢复全部
            </button>
          </div>
          <output>
            开头 {start === null ? "视频起点" : time(start)} → 结束{" "}
            {end === null ? "视频结尾" : time(end)}
          </output>
          {invalid && <p role="alert">结束时间需要晚于开头。</p>}
        </div>
        {error && (
          <p role="alert">
            {error}{" "}
            <button onClick={() => setReload((v) => v + 1)}>重试预览</button>
          </p>
        )}
        <a href={row.url} target="_blank" rel="noreferrer">
          在 B站查看原视频
        </a>
      </div>
    </Modal>
  );
}

export function OnlineSongs({ initialTitle = "", notify }) {
  const [title, setTitle] = useState(initialTitle),
    [artist, setArtist] = useState(""),
    [data, setData] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selection, setSelection] = useState(null);
  const searchId = useRef(0);
  useEffect(
    () => () => {
      searchId.current++;
    },
    [],
  );
  async function search(page = 1) {
    const id = ++searchId.current,
      identity =
        page === 1
          ? { title: title.trim(), artist: artist.trim() }
          : data.identity;
    setBusy(true);
    setError("");
    try {
      const value = await api(
        `/online/songs?${new URLSearchParams({ ...identity, page })}`,
      );
      if (id !== searchId.current) return;
      const results =
        page === 1
          ? value.results
          : [
              ...new Map(
                [...data.results, ...value.results].map((row) => [
                  row.url,
                  row,
                ]),
              ).values(),
            ];
      setData({
        ...value,
        identity,
        results: rankVideos(results, value.duration),
      });
    } catch (e) {
      if (id === searchId.current) setError(e.message);
    } finally {
      if (id === searchId.current) setBusy(false);
    }
  }
  return (
    <section className="online-songs">
      <div className="section-heading">
        <div>
          <h1>找到想唱的那一版。</h1>
          <p>搜索 B站视频，试听并选取片段，再交给 PC 整理入库。</p>
        </div>
      </div>
      <form
        className="song-search-fields"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <label>
          歌名
          <input
            aria-label="在线歌名"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入歌名"
            required
            maxLength={120}
          />
        </label>
        <label>
          歌手
          <input
            aria-label="在线歌手"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="输入歌手"
            required
            maxLength={120}
          />
        </label>
        <button
          className="primary"
          disabled={busy || !title.trim() || !artist.trim()}
        >
          {busy ? "搜索中…" : "搜索视频"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {data && (
        <p className="note">
          {data.duration
            ? `歌词来源标注歌曲长 ${time(data.duration)}，已优先排列时长接近的视频。`
            : "未取得唯一匹配的歌曲时长，按 B站相关度展示。"}
        </p>
      )}
      <div className="video-waterfall">
        {data?.results.map((row) => (
          <button
            className="video-card"
            key={row.url}
            onClick={() => setSelection({ row, ...data.identity })}
          >
            <div className="video-card-image">
              {row.cover ? (
                <img
                  src={row.cover}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span>视频预览</span>
              )}
              <span className="video-duration">{time(row.duration)}</span>
            </div>
            <strong>{row.title}</strong>
            <small>{row.uploader || row.artist}</small>
            {row.durationDifference !== null && (
              <small
                className={row.durationDifference <= 5 ? "duration-match" : ""}
              >
                {row.durationDifference <= 5
                  ? "时长接近"
                  : `相差 ${Math.round(row.durationDifference)} 秒`}
              </small>
            )}
          </button>
        ))}
      </div>
      {data?.hasMore && (
        <button disabled={busy} onClick={() => search(data.page + 1)}>
          加载更多
        </button>
      )}
      {!busy && data && !data.results.length && (
        <p>没有找到视频，试试调整歌名或歌手。</p>
      )}
      {selection && (
        <VideoPreview
          key={selection.row.url}
          selection={selection}
          close={() => setSelection(null)}
          notify={notify}
        />
      )}
    </section>
  );
}
