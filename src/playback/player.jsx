import React, { useEffect, useRef, useState } from "react";
import { Mic2, Monitor, Play } from "lucide-react";
import { useMediaPlayback } from "../media-playback.js";
import { Spectrum } from "../spectrum.jsx";
import { Lyrics } from "../lyrics.jsx";
import { Background } from "./background.jsx";
import { usePlayerLease } from "./use-player-lease.js";

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
  const [time, setTime] = useState(0),
    [showQueue, setShowQueue] = useState(false),
    [actualVariant, setActualVariant] = useState(null);
  const [blocked, setBlocked] = useState(false),
    [full, setFull] = useState(false),
    [error, setError] = useState(""),
    [warning, setWarning] = useState(""),
    [pictureError, setPictureError] = useState(false),
    [reload, setReload] = useState(0);
  function adjustLyrics(deltaMs, reset = false) {
    if (!current) return;
    request(
      "/control",
      { action: "lyrics-offset", entryId: current.id, deltaMs, reset },
      "POST",
    ).catch((e) => notify(e.message));
  }
  useEffect(() => {
    if (!current || !lyricsVisible || !(full || keyboardLyrics)) return;
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
    if (status.pictureError) setPictureError(true);
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
    setTime(0);
    setActualVariant(null);
  }, [current?.id]);
  // Legacy muxed media is isolated from the v2 controller.
  useEffect(() => {
    const v = video.current;
    if (!v || !current || manifest?.version !== 1) return;
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
    if (!v || manifest?.version !== 1) return;
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
    let raf,
      last = 0;
    const tick = (now) => {
      if (now - last > 32) {
        setTime(
          video.current?._playback?.getTime() ??
            video.current?.currentTime ??
            0,
        );
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
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
    } else {
      // CSS also fills the TV WebView on devices which reject the native API.
      fullscreenMode.current = "fallback";
      setFull(true);
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
    if (!full) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (event) => {
      if (
        !["Escape", "BrowserBack"].includes(event.key) ||
        document.querySelector("dialog[open]")
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      fullscreenRequest.current++;
      fullscreenMode.current = "none";
      setFull(false);
      void exitNativeFullscreen();
      container.current?.querySelector("[data-fullscreen]")?.focus();
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", key, true);
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
    <section ref={container} className={`tv-player ${full ? "is-full" : ""}`}>
      <div
        className="video-stage"
        ref={stage}
        tabIndex={0}
        role="group"
        aria-label={
          lyricsVisible
            ? "演唱画面，确认键全屏，左右键微调歌词"
            : "演唱画面，确认键全屏"
        }
        onKeyDown={(event) => {
          if (
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
        {audioStage && (
          <>
            <Background
              background={background || manifest.background}
              token={token}
              time={time}
            />
            <Spectrum video={video} />
          </>
        )}
        {current && lyricsVisible && (
          <Lyrics
            song={current}
            time={time}
            token={token}
            resource={manifest?.resources?.lyrics}
            offsetMs={playback.lyricsOffsetMs || 0}
          />
        )}
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
      <div className="video-caption">
        <div className="video-caption-heading">
          <span data-audio-variant={actualVariant || variant}>
            <span className={`dot ${lease ? "" : "offline"}`} />
            {current?.ambient
              ? "随机原唱 · " + current.title
              : current
                ? "正在舞台上 · " +
                  ((actualVariant || variant) === "vocal" ? "原唱" : "伴奏")
                : "等待开唱"}
          </span>
          <button
            type="button"
            onClick={toggleLyrics}
            aria-pressed={lyricsVisible}
            aria-label={lyricsVisible ? "隐藏歌词" : "显示歌词"}
          >
            {lyricsVisible ? "隐藏歌词" : "显示歌词"}
          </button>
          <button
            data-fullscreen
            onClick={fullscreen}
            aria-label={full ? "退出全屏" : "全屏播放"}
          >
            <Monitor size={16} />
            {full ? "退出全屏" : "全屏"}
          </button>
        </div>
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
          </div>
        )}
        {current && lyricsVisible && (
          <div className="lyric-adjust" aria-label="歌词时间微调">
            {[10, 3, 0.5].map((seconds) => (
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
            {[0.5, 3, 10].map((seconds) => (
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
      </div>
    </section>
  );
}
