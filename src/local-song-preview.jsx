import React, { useEffect, useRef, useState } from "react";
import { Modal } from "./components.jsx";
import { SongArtwork } from "./song-artwork.jsx";
import { normalizeManifest } from "./playback/manifest.js";
import { createPlaybackController } from "./playback/controller.js";
const time = (n) =>
  `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, "0")}`;
export function LocalSongPreview({ song, request, token, close, notify }) {
  const [detail, setDetail] = useState(null),
    [error, setError] = useState("");
  const [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [mediaStatus, setMediaStatus] = useState({});
  const video = useRef(null),
    controller = useRef(null);
  useEffect(() => {
    let alive = true;
    request(`/admin/library/${song.id}/preview`)
      .then((result) => {
        if (alive) setDetail(result);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [song.id]);
  useEffect(() => {
    if (!detail?.manifest.vocal || !video.current) return;
    const control = createPlaybackController({
      video: video.current,
      manifest: normalizeManifest(detail.manifest, { songId: song.id, token }),
      createContext: () => null,
      onStatus: (value) =>
        setMediaStatus((previous) => ({ ...previous, ...value })),
      onEnded: () => {
        control.setState({ paused: true });
        setPlaying(false);
      },
    });
    control.setState({ lease: true, paused: true, variant: "vocal" });
    controller.current = control;
    const timer = setInterval(() => setPosition(control.getTime()), 200);
    return () => {
      clearInterval(timer);
      control.destroy();
      controller.current = null;
    };
  }, [detail, song.id, token]);
  const duration =
    detail?.manifest.resources.vocal?.duration || detail?.duration || 0;
  async function play() {
    controller.current?.setState({ paused: false });
    setPlaying(true);
    if (!(await controller.current?.start({ retry: true }))) setPlaying(false);
  }
  function pause() {
    controller.current?.setState({ paused: true });
    setPlaying(false);
  }
  async function copyFolder() {
    try {
      await navigator.clipboard.writeText(detail.folder);
      notify("歌曲文件夹路径已复制");
    } catch {
      notify("无法自动复制，请选中下方路径复制");
    }
  }
  return (
    <Modal
      title={`${song.title} · 原唱预览`}
      close={close}
      className="local-preview-modal"
    >
      {error && <p role="alert">{error}</p>}
      {!detail && !error && <p className="list-empty">正在读取歌曲资源…</p>}
      {detail && (
        <div className="local-preview-layout">
          <div className="local-preview-player">
            <div
              className={`local-preview-picture ${detail.manifest.video ? "" : "audio-only"}`}
            >
              {!detail.manifest.video && (
                <SongArtwork song={detail} token={token} size={80} />
              )}
              <video
                ref={video}
                playsInline
                preload="metadata"
                aria-label="歌曲原唱视频预览"
                hidden={!detail.manifest.video}
              />
            </div>
            <div className="preview-transport">
              <button
                className="primary"
                disabled={!detail.manifest.vocal}
                onClick={playing ? pause : play}
              >
                {playing ? "暂停预览" : "播放原唱"}
              </button>
              <span>
                {time(position)} / {time(duration)}
              </span>
              <input
                aria-label="原唱预览进度"
                type="range"
                min="0"
                max={duration || 1}
                step="0.1"
                value={Math.min(position, duration || 1)}
                disabled={!detail.manifest.vocal}
                onChange={(e) => {
                  controller.current?.seek(Number(e.target.value));
                  setPosition(Number(e.target.value));
                }}
              />
            </div>
            <p className="muted">{detail.note}</p>
            {mediaStatus.error && (
              <p role="alert">原唱加载失败，请关闭后重新打开预览。</p>
            )}
            {mediaStatus.blocked && (
              <p role="alert">请点击“播放原唱”以启用声音。</p>
            )}
            {mediaStatus.pictureError && (
              <p role="alert">当前浏览器无法播放画面编码，原唱仍可试听。</p>
            )}
          </div>
          <aside className="local-preview-info">
            <span className="preview-album-art">
              <SongArtwork song={detail} token={token} size={44} />
            </span>
            <h3>{detail.title}</h3>
            <p>{detail.artist}</p>
            {detail.posterSource?.album && (
              <p>专辑 · {detail.posterSource.album}</p>
            )}
            {detail.posterSource?.sourceUrl && (
              <a
                className="poster-source-link"
                href={detail.posterSource.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {detail.posterSource.provider === "bilibili"
                  ? "在 B站查看原视频"
                  : "在 iTunes 查看专辑"}{" "}
                ↗
              </a>
            )}
            <details className="preview-files">
              <summary>歌曲文件夹 · {detail.files.length} 个资源</summary>
              <code>{detail.folder}</code>
              <button onClick={copyFolder}>复制文件夹路径</button>
              {detail.resourceFolder &&
                detail.resourceFolder !== detail.folder && (
                  <>
                    <small>当前播放资源</small>
                    <code>{detail.resourceFolder}</code>
                  </>
                )}
              <ul>
                {detail.files.map((file) => (
                  <li key={file.kind}>
                    <span>{file.name}</span>
                    <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
                  </li>
                ))}
              </ul>
            </details>
          </aside>
        </div>
      )}
    </Modal>
  );
}
