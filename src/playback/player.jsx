import React, { useEffect, useRef, useState } from "react";
import { Mic2, Monitor, Play } from "lucide-react";
import { useMediaPlayback } from "../media-playback.js";
import { PlayerVisuals } from "./player-visuals.jsx";
import { usePlayerLease } from "./use-player-lease.js";
import { useIdleControls } from "./use-idle-controls.js";
import { PlaybackDiagnostics } from "./playback-diagnostics.jsx";

export function Player({
  current,
  playback,
  notify,
  reactions = [],
  join,
  queue = [],
  request,
  token,
  background,
  keyboardLyrics = false,
  playerType = "web",
  activePlayer,
  actionsRef,
}) {
  const video = useRef(),
    container = useRef(),
    stage = useRef(),
    fullscreenMode = useRef("none"),
    fullscreenRequest = useRef(0),
    fullscreenExit = useRef(Promise.resolve()),
    latest = useRef(current),
    position = useRef(0),
    previousEntry = useRef(null);
  latest.current = current;
  const { playerId, lease, leaseError } = usePlayerLease({
    request,
    token,
    type: playerType,
    activePlayer,
  });
  const playState = useRef({});
  playState.current = { lease, paused: playback.paused, entryId: current?.id };
  const [lyricsVisible, setLyricsVisible] = useState(() => {
    try {
      return localStorage.getItem("haohaochang.lyricsVisible") !== "false";
    } catch {
      return true;
    }
  });
  function toggleLyrics() {
    const visible = !lyricsVisible;
    setLyricsVisible(visible);
    try {
      localStorage.setItem("haohaochang.lyricsVisible", String(visible));
    } catch {}
  }
  useEffect(() => {
    const sync = (event) => {
      if (event.key === "haohaochang.lyricsVisible")
        setLyricsVisible(event.newValue !== "false");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const [showQueue, setShowQueue] = useState(false),
    [actualVariant, setActualVariant] = useState(null);
  const [blocked, setBlocked] = useState(false),
    [full, setFull] = useState(false),
    [error, setError] = useState(""),
    [warning, setWarning] = useState(""),
    [pictureError, setPictureError] = useState(false),
    [reload, setReload] = useState(0);
  const [diagnostics, setDiagnostics] = useState(false);
  const [lyricsSaved, setLyricsSaved] = useState("");
  const autoHideControls =
    !!current && !playback.paused && !blocked && !error && !leaseError && full;
  const controlsVisible = useIdleControls({
    container,
    enabled: autoHideControls,
    immersive: full,
    resetKey: current?.id,
  });
  function adjustLyrics(deltaMs, reset = false) {
    if (!current) return;
    setLyricsSaved("正在保存…");
    request(
      "/control",
      { action: "lyrics-offset", entryId: current.id, deltaMs, reset },
      "POST",
    )
      .then(() => setLyricsSaved("已保存，下次播放自动应用"))
      .catch((e) => {
        setLyricsSaved("保存失败，请重试");
        notify(e.message);
      });
  }
  useEffect(() => {
    if (!current || !lyricsVisible || !full) return;
    let last = 0;
    const key = (e) => {
      if (
        !["ArrowLeft", "ArrowRight"].includes(e.key) ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        document.querySelector("dialog[open]") ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) ||
        e.target?.isContentEditable
      )
        return;
      // Remote arrows navigate controls everywhere else. Lyrics only consume
      // arrows when the user explicitly focuses the singing picture.
      if (![stage.current, video.current].includes(document.activeElement))
        return;
      if (!container.current?.getClientRects().length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat && Date.now() - last < 250) return;
      last = Date.now();
      adjustLyrics(e.key === "ArrowLeft" ? 100 : -100);
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [current?.id, full, keyboardLyrics, request, lyricsVisible]);
  const variant =
    current?.mode === "original" || playback.vocal ? "vocal" : "backing";
  function ended(entryId) {
    if (!lease || playback.paused || !entryId || latest.current?.id !== entryId)
      return;
    request("/player/ended", { entryId, playerId }, "POST").catch((e) =>
      notify(e.message),
    );
  }
  function mediaStatus(status) {
    if ("variant" in status) setActualVariant(status.variant);
    if ("blocked" in status) setBlocked(status.blocked);
    if ("error" in status) setError(status.error);
    if ("warning" in status) setWarning(status.warning);
    if ("pictureError" in status) setPictureError(!!status.pictureError);
  }
  const manifest = useMediaPlayback({
    video,
    current,
    variant,
    lease,
    paused: playback.paused,
    token,
    reload,
    onError: setError,
    onStatus: mediaStatus,
    onEnded: ended,
  });
  useEffect(() => {
    setError("");
    setWarning("");
    setBlocked(false);
    setPictureError(false);
    setActualVariant(null);
    setLyricsSaved("");
  }, [current?.id]);
  // Legacy muxed media is isolated from the v2 controller.
  useEffect(() => {
    const v = video.current;
    if (!v || !current || manifest?.version !== 1 || manifest.native) return;
    let alive = true;
    const entryId = current.id;
    if (previousEntry.current !== entryId) {
      position.current = 0;
      previousEntry.current = entryId;
    } else position.current = v.currentTime || position.current;
    v.muted = false;
    v._legacyEntry = entryId;
    v.src = `/api/media/${current.song_id}/${variant}?token=${encodeURIComponent(token)}`;
    v.load();
    const ready = () => {
      if (!alive) return;
      v.currentTime = Math.min(position.current, v.duration || 0);
      if (playState.current.lease && !playState.current.paused)
        v.play()
          .then(() => {
            if (!alive) return;
            if (!playState.current.lease || playState.current.paused) {
              v.pause();
              return;
            }
            setBlocked(false);
          })
          .catch(() => {
            if (alive && playState.current.lease && !playState.current.paused)
              setBlocked(true);
          });
    };
    v.addEventListener("loadedmetadata", ready);
    return () => {
      alive = false;
      v.removeEventListener("loadedmetadata", ready);
      v.pause();
      v._legacyEntry = null;
    };
  }, [current?.id, variant, manifest, token]);
  useEffect(() => {
    const v = video.current;
    if (!v || manifest?.version !== 1 || manifest.native) return;
    let alive = true;
    if (playback.paused || !lease) v.pause();
    else if (current)
      v.play()
        .then(() => {
          if (alive) setBlocked(false);
        })
        .catch(() => {
          if (alive) setBlocked(true);
        });
    return () => {
      alive = false;
    };
  }, [playback.paused, current?.id, lease, manifest]);
  useEffect(() => {
    const handler = () => {
      if (document.fullscreenElement === container.current) {
        if (fullscreenMode.current === "none") {
          document.exitFullscreen().catch(() => {});
          return;
        }
        // requestFullscreen's promise owns native entry. Old native events must
        // not turn a newly requested CSS fallback into a native session.
        if (fullscreenMode.current === "native") setFull(true);
      } else if (fullscreenMode.current === "native") {
        fullscreenMode.current = "none";
        setFull(false);
      }
      // A delayed native exit must not close a newly opened CSS fallback.
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  useEffect(() => {
    if (!full || !queue.length) {
      setShowQueue(false);
      return;
    }
    let hide;
    const show = () => {
      setShowQueue(true);
      hide = setTimeout(() => setShowQueue(false), 6000);
    };
    show();
    const interval = setInterval(show, 30000);
    return () => {
      clearTimeout(hide);
      clearInterval(interval);
    };
  }, [full, queue.length > 0]);
  function exitNativeFullscreen() {
    if (document.fullscreenElement)
      fullscreenExit.current = document.exitFullscreen().catch(() => {});
    return fullscreenExit.current;
  }
  async function fullscreen() {
    const request = ++fullscreenRequest.current;
    if (full) {
      fullscreenMode.current = "none";
      setFull(false);
      await exitNativeFullscreen();
      if (request !== fullscreenRequest.current) return;
      document
        .querySelector("[data-open-fullscreen]")
        ?.focus({ preventScroll: true });
    } else {
      // CSS also fills the TV WebView on devices which reject the native API.
      fullscreenMode.current = "fallback";
      setFull(true);
      stage.current?.focus({ preventScroll: true });
      // The APK is already immersive. Keep video and controls in the same
      // WebView instead of handing the picture to Android's custom video view.
      if (/HaohaochangTV\//.test(navigator.userAgent)) return;
      try {
        // Escape updates React before the browser finishes its native exit.
        await fullscreenExit.current;
        if (request !== fullscreenRequest.current) return;
        if (document.fullscreenElement) await exitNativeFullscreen();
        if (request !== fullscreenRequest.current) return;
        await container.current.requestFullscreen?.();
        if (request !== fullscreenRequest.current) {
          await exitNativeFullscreen();
          return;
        }
        if (document.fullscreenElement === container.current)
          fullscreenMode.current = "native";
      } catch {}
    }
  }
  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = { fullscreen };
    return () => {
      actionsRef.current = null;
    };
  });
  useEffect(() => {
    if (!full) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [full]);
  function retry() {
    if (!lease || playback.paused) return;
    setError("");
    setWarning("");
    if (!manifest) {
      setReload((n) => n + 1);
      return;
    }
    if (video.current?._playback) {
      void video.current._playback.start({ retry: true });
      return;
    }
    position.current = video.current?.currentTime || 0;
    video.current?.load();
    video.current
      ?.play()
      .then(() => setBlocked(false))
      .catch(() => setBlocked(true));
  }
  const audioStage =
    manifest?.version === 2 && (!manifest.resources.video || pictureError);
  return (
    <section
      ref={container}
      data-system-lyrics={lyricsVisible ? "visible" : "hidden"}
      className={`tv-player ${full ? "is-full" : ""} ${autoHideControls ? "auto-hide-controls" : ""} ${controlsVisible ? "" : "controls-hidden"}`}
      data-controls={controlsVisible ? "visible" : "hidden"}
    >
      <div
        className="video-stage"
        ref={stage}
        tabIndex={full || keyboardLyrics ? 0 : -1}
        role="group"
        aria-label={
          full ? "演唱画面，按下键或确认键打开播放控制" : "演唱画面，确认键全屏"
        }
        onKeyDown={(event) => {
          if (
            !full &&
            event.target === event.currentTarget &&
            ["Enter", " "].includes(event.key)
          ) {
            event.preventDefault();
            fullscreen();
          }
        }}
      >
        <video
          ref={video}
          tabIndex={-1}
          playsInline
          onEnded={() => {
            if (
              manifest?.version === 1 &&
              video.current?._legacyEntry === current?.id
            )
              ended(current?.id);
          }}
          onError={() => {
            if (
              manifest?.version === 1 &&
              video.current?._legacyEntry === current?.id
            )
              setError("播放失败，请重试或检查 NAS 连接");
          }}
        />
        <PlayerVisuals
          video={video}
          current={current}
          manifest={manifest}
          background={background}
          token={token}
          lyricsVisible={lyricsVisible}
          audioStage={audioStage}
          offsetMs={playback.lyricsOffsetMs || 0}
        />
        {!current && (
          <div className="stage-empty">
            <Mic2 size={34} />
            <span>客厅的舞台，留给你</span>
          </div>
        )}
        {warning && !error && !blocked && (
          <div
            role="status"
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              padding: "4px 8px",
              background: "#181320cc",
              color: "#fff",
              fontSize: 12,
            }}
          >
            {warning}
          </div>
        )}
        {(leaseError || (current && (blocked || error))) && (
          <div className="video-overlay">
            <p>{leaseError || error || "点击播放，开启今晚的第一首"}</p>
            {leaseError ? (
              <p>TV 优先播放；同级新页面可以接管。被接管后可继续点歌。</p>
            ) : (
              <button disabled={!lease || playback.paused} onClick={retry}>
                <Play size={17} />
                {playback.paused
                  ? "请先恢复播放"
                  : error
                    ? "重试播放"
                    : "开始播放"}
              </button>
            )}
          </div>
        )}
        {full && (
          <div className="fullscreen-sidebar">
            {join && (
              <aside className="fullscreen-join">
                <img src={join.qr} alt="手机扫码加入歌房" />
                <strong>扫码点歌</strong>
                <span>无需密码 · 手机互动</span>
              </aside>
            )}
            {showQueue && queue.length > 0 && (
              <aside className="fullscreen-queue" aria-label="已点歌曲预告">
                <div className="fullscreen-queue-heading">
                  <strong>已点歌曲</strong>
                  <span>{queue.length} 首</span>
                </div>
                <ol>
                  {queue.slice(0, 4).map((song, index) => (
                    <li key={song.id}>
                      <span className="queue-order">
                        {index === 0 ? "正在唱" : String(index)}
                      </span>
                      <div>
                        <strong>{song.title}</strong>
                        <span>{song.artist}</span>
                      </div>
                    </li>
                  ))}
                </ol>
                {queue.length > 4 && <p>后面还有 {queue.length - 4} 首</p>}
              </aside>
            )}
          </div>
        )}
        <div className="reaction-layer" aria-live="polite">
          {reactions.map((r, i) => (
            <span key={r.id} style={{ left: `${15 + i * 9}%` }}>
              {r.emoji}
            </span>
          ))}
        </div>
      </div>
      {(full || !actionsRef) && (
        <div
          className="video-caption"
          role="group"
          aria-label={full ? "全屏播放控制" : "播放控制"}
          aria-hidden={!controlsVisible}
        >
          {full && (
            <div className="video-caption-heading">
              <div>
                <strong>{current?.title || "等待开唱"}</strong>
                <span data-audio-variant={actualVariant || variant}>
                  {current?.artist} ·{" "}
                  {(actualVariant || variant) === "vocal" ? "原唱" : "伴奏"}
                </span>
              </div>
              <small>返回键收起控制 · 选择「退出全屏」返回点歌</small>
            </div>
          )}
          {full && current && (
            <div className="full-controls">
              {[
                ["pause", playback.paused ? "继续" : "暂停"],
                ...(!current.ambient &&
                !["original", "instrumental"].includes(current.mode)
                  ? [["vocal", playback.vocal ? "切伴奏" : "切原唱"]]
                  : []),
                ["next", "切歌"],
              ].map(([action, label]) => (
                <button
                  key={action}
                  data-player-action={action}
                  onClick={() =>
                    request(
                      "/control",
                      { action, entryId: current.id },
                      "POST",
                    ).catch((e) => notify(e.message))
                  }
                >
                  {label}
                </button>
              ))}
              <button
                onClick={toggleLyrics}
                aria-pressed={lyricsVisible}
                aria-label={lyricsVisible ? "隐藏歌词" : "显示歌词"}
              >
                {lyricsVisible ? "隐藏歌词" : "显示歌词"}
              </button>
              <button
                onClick={() => setDiagnostics((value) => !value)}
                aria-pressed={diagnostics}
              >
                播放信息
              </button>
              <button
                data-fullscreen
                onClick={fullscreen}
                aria-label="退出全屏"
              >
                <Monitor size={18} />
                退出全屏
              </button>
            </div>
          )}
          {(!full || !current) && (
            <button
              data-fullscreen
              onClick={fullscreen}
              aria-label={full ? "退出全屏" : "全屏播放"}
            >
              <Monitor size={18} />
              {full ? "退出全屏" : "全屏"}
            </button>
          )}
          {full && current && lyricsVisible && (
            <div className="lyric-adjust" aria-label="歌词时间微调">
              {[10, 3, 0.5, 0.1].map((seconds) => (
                <button
                  key={seconds}
                  aria-label={`歌词提前 ${seconds} 秒`}
                  onClick={() => adjustLyrics(seconds * 1000)}
                >
                  ← {seconds} 秒
                </button>
              ))}
              <output aria-live="polite">
                歌词{" "}
                {playback.lyricsOffsetMs
                  ? `${playback.lyricsOffsetMs > 0 ? "提前" : "延后"} ${(Math.abs(playback.lyricsOffsetMs) / 1000).toFixed(1)} 秒`
                  : "原始时间"}
              </output>
              {[0.1, 0.5, 3, 10].map((seconds) => (
                <button
                  key={seconds}
                  aria-label={`歌词延后 ${seconds} 秒`}
                  onClick={() => adjustLyrics(-seconds * 1000)}
                >
                  {seconds} 秒 →
                </button>
              ))}
              <button
                aria-label="重置歌词微调"
                onClick={() => adjustLyrics(0, true)}
              >
                复位
              </button>
            </div>
          )}
          {full && lyricsSaved && (
            <p className="lyrics-save-status" role="status">
              {lyricsSaved}
            </p>
          )}
          <PlaybackDiagnostics video={video} open={full && diagnostics} />
        </div>
      )}
    </section>
  );
}
