import React, { useEffect, useRef, useState } from "react";
import { api, roomToken } from "./api.js";
import { Modal } from "./components.jsx";
import { rankVideos } from "../shared/video-ranking.js";
import { BiliLogin } from "./bili-login.jsx";
import { MobileRequests } from "./mobile-requests.jsx";
import { videoRefreshMode } from "../shared/video-refresh.js";
import "./online-preview.css";

const time = (n) =>
  `${Math.floor((n || 0) / 60)}:${((n || 0) % 60).toFixed(1).padStart(4, "0")}`;
const mediaUrl = (url) =>
  url ? `${url}?token=${encodeURIComponent(roomToken)}` : undefined;

export function VideoPreview({
  selection,
  close,
  notify,
  canLogin = false,
  mobile = false,
  name = "家人",
  onSubmitted = () => {},
  onReplace,
  refreshSource,
}) {
  const video = useRef(null),
    audio = useRef(null);
  const resumeAt = useRef(0);
  const [quality, setQuality] = useState("highest"),
    [qualities, setQualities] = useState([
      { value: "highest", label: "最高画质（至少 720p）" },
    ]);
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
        if (live) {
          setPreview(v);
          if (v.qualities) setQualities(v.qualities);
        }
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
    if (force) a.currentTime = v.currentTime;
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
      const input = {
        url: row.url,
        title,
        artist,
        onlineSelection: true,
        client: mobile ? "mobile" : "admin",
        name,
        previewId: preview?.id,
        quality,
        clip: start !== null || end !== null ? { start, end } : null,
      };
      if (onReplace) await onReplace(input);
      else await api("/online", input, "POST");
      setAdded(true);
      onSubmitted();
      notify(
        onReplace
          ? "已提交视频更新，旧资源在新版本验证完成前继续保留。"
          : mobile
            ? "已优先安排整理，完成后自动加入已点歌曲；画面下载失败会尝试音频与歌词。"
            : "已加入整理任务：下载 → PC 裁剪与分离 → 入库。可在后台任务查看进度。",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const invalid = (end ?? preview?.duration ?? Infinity) <= (start ?? 0);
  const updatePlan = onReplace
    ? videoRefreshMode(
        refreshSource,
        row.url,
        start !== null || end !== null ? { start, end } : null,
      )
    : null;
  return (
    <Modal
      title={`${title} · ${artist}`}
      close={close}
      className="video-preview-modal"
    >
      <div className="song-preview">
        <p className="preview-source-title">{row.title}</p>
        {updatePlan && (
          <p className="video-refresh-plan" role="status">
            {updatePlan.reason}
          </p>
        )}
        <label className="preview-quality">
          下载清晰度
          <select
            aria-label="视频清晰度"
            value={quality}
            disabled={busy || added}
            onChange={(event) => {
              setQuality(event.target.value);
            }}
          >
            {qualities.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <p className="note">
          {preview?.previewHeight
            ? `当前预览 ${preview.previewHeight}p；预览优先使用 360p，下载按所选画质执行。`
            : "预览优先使用 360p，下载按所选画质执行。"}
          会员高清需要在“在线资源”保存该会员账号最新的 B站
          Cookie；仅在网页登录不会同步到 NAS。
        </p>
        {preview ? (
          <>
            <video
              ref={video}
              src={mediaUrl(preview.video)}
              controls
              playsInline
              preload="auto"
              aria-label="B站视频预览"
              onLoadedMetadata={() => {
                video.current.currentTime = Math.min(
                  resumeAt.current,
                  video.current.duration || 0,
                );
                sync(true);
              }}
              onTimeUpdate={() => {
                setPosition(video.current.currentTime);
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
                sync(true);
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
              onError={() => {
                pause();
                setError("预览线路不可用，请点击重试预览刷新线路。");
              }}
            />
            {preview.audio && (
              <audio
                ref={audio}
                src={mediaUrl(preview.audio)}
                preload="auto"
                onError={() => {
                  pause();
                  setError("预览声音加载失败，请点击重试预览刷新线路。");
                }}
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
            disabled={busy || invalid || added || (!preview && !error)}
          >
            {added
              ? "已加入整理任务"
              : busy
                ? "提交中…"
                : onReplace
                  ? updatePlan.mode === "video-only"
                    ? "仅更新视频"
                    : "更新视频并重新分离"
                  : mobile
                    ? "整理并点歌"
                    : "加入曲库"}
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
            <button
              onClick={() => {
                resumeAt.current = video.current?.currentTime || position;
                pause();
                setReload((v) => v + 1);
              }}
            >
              重试预览
            </button>
          </p>
        )}
        <a href={row.url} target="_blank" rel="noreferrer">
          在 B站查看原视频
        </a>
      </div>
    </Modal>
  );
}

export function OnlineSongs({
  initialTitle = "",
  initialArtist = "",
  initialUrl = "",
  onReplace,
  refreshSource,
  notify,
  canLogin = false,
  mobile = false,
  name = "家人",
}) {
  const [title, setTitle] = useState(initialTitle),
    [artist, setArtist] = useState(initialArtist),
    [data, setData] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selection, setSelection] = useState(
      initialUrl
        ? {
            row: { url: initialUrl, title: initialTitle },
            title: initialTitle,
            artist: initialArtist,
          }
        : null,
    );
  const [directUrl, setDirectUrl] = useState("");
  const [audioBusy, setAudioBusy] = useState(false),
    [requestRevision, setRequestRevision] = useState(0);
  async function requestAudio() {
    setAudioBusy(true);
    setError("");
    try {
      await api(
        "/requests",
        { title: title.trim(), artist: artist.trim(), name },
        "POST",
      );
      setRequestRevision((v) => v + 1);
      notify("已优先寻找音频与歌词，准备好后自动点歌。");
    } catch (e) {
      setError(e.message);
    } finally {
      setAudioBusy(false);
    }
  }
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
      <BiliLogin
        compact
        canLogin={canLogin}
        request={(url, body, method) => api(url, body, method, canLogin)}
        notify={notify}
      />
      <div className="section-heading">
        <div>
          <h1>找到想唱的那一版。</h1>
          <p>
            {mobile
              ? "优先找 B站视频，试听后点歌；没有合适画面，也可以先用音频和歌词开唱。"
              : "搜索 B站视频，试听并选取片段，再交给 PC 整理入库。"}
          </p>
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
      {onReplace && (
        <form
          className="video-refresh-link"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const plan = videoRefreshMode(refreshSource, directUrl, null);
              setSelection({ row: { url: plan.url, title }, title, artist });
            } catch (error) {
              setError(error.message);
            }
          }}
        >
          <label>
            或粘贴 B站链接
            <input
              aria-label="更新视频链接"
              value={directUrl}
              onChange={(event) => setDirectUrl(event.target.value)}
              placeholder="https://www.bilibili.com/video/BV…"
            />
          </label>
          <button disabled={!directUrl.trim()}>预览链接</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {mobile && (
        <div className="mobile-audio-fallback">
          <p>没找到合适视频？先找音频和歌词，画面可以稍后补齐。</p>
          <button
            disabled={busy || audioBusy || !title.trim() || !artist.trim()}
            onClick={requestAudio}
          >
            {audioBusy ? "提交中…" : "先找音频 + 歌词"}
          </button>
        </div>
      )}
      {mobile && <MobileRequests revision={requestRevision} />}
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
          canLogin={canLogin}
          mobile={mobile}
          name={name}
          onReplace={onReplace}
          refreshSource={refreshSource}
          onSubmitted={() => setRequestRevision((v) => v + 1)}
        />
      )}
    </section>
  );
}
