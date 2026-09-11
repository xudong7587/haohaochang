// APK v1 bridge: Media3 owns video/audio decoding, sync and the audio clock.
// Browser/older APKs keep the existing controller. No dual HTML playback.
export const nativePlaybackAvailable = () =>
  globalThis.HaohaochangPlayer?.version === 1;

export function createNativeController({
  video,
  manifest,
  onStatus = () => {},
  onEnded = () => {},
}) {
  const bridge = globalThis.HaohaochangPlayer;
  const session = `native-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let disposed = false,
    ended = false,
    raf,
    lastBounds = "",
    statusKey = "";
  let state = { lease: false, paused: true, variant: "backing" };
  let clock = { positionMs: 0, playing: false, received: performance.now() };
  const stage = video.closest(".video-stage");
  const send = (action, value = {}) => {
    if (!disposed) bridge.postMessage({ action, session, ...value });
  };
  function picture(enabled) {
    stage?.classList.toggle("native-picture", enabled);
    stage
      ?.closest(".tv-player")
      ?.classList.toggle("native-picture-player", enabled);
    document.documentElement.classList.toggle("has-native-picture", enabled);
  }
  function layout() {
    if (disposed || !stage) return;
    const rect = stage.getBoundingClientRect();
    const value = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      visible:
        !!stage.getClientRects().length &&
        getComputedStyle(stage).visibility !== "hidden",
    };
    const key = JSON.stringify(value);
    if (key !== lastBounds) {
      lastBounds = key;
      send("bounds", value);
    }
  }
  const scheduleLayout = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(layout);
  };
  const receive = (event) => {
    if (disposed || event.detail?.session !== session) return;
    const value = event.detail;
    clock = {
      positionMs: Number(value.positionMs) || 0,
      playing: !!value.playing,
      received: performance.now(),
    };
    video._nativeStats = value;
    picture(!!manifest.resources.video && !value.pictureError);
    const status = {
      blocked: false,
      error: value.error || "",
      warning: value.warning || "",
      variant: value.variant,
      pictureError: !!value.pictureError,
    };
    const key = JSON.stringify(status);
    if (key !== statusKey) {
      statusKey = key;
      onStatus(status);
    }
    if (value.ended && !ended && state.lease && !state.paused) {
      ended = true;
      onEnded();
    }
  };
  video.pause();
  video.removeAttribute("src");
  video.load();
  video._audioTracks = [];
  video.dataset.engine = "native";
  window.addEventListener("haohaochang-native-state", receive);
  window.addEventListener("resize", scheduleLayout);
  window.addEventListener("scroll", scheduleLayout, true);
  const observer = new MutationObserver(scheduleLayout);
  for (let node = stage; node && node !== document; node = node.parentElement)
    observer.observe(node, {
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
    });
  const resize =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(scheduleLayout)
      : null;
  if (stage) resize?.observe(stage);
  const resources = {};
  for (const kind of ["video", "vocal", "backing"]) {
    const resource = manifest.resources[kind];
    if (resource)
      resources[kind] = {
        ...resource,
        url: new URL(resource.url, location.href).href,
      };
  }
  send("load", {
    resources,
    legacy: manifest.version === 1,
    variant: state.variant,
  });
  picture(!!resources.video);
  layout();
  // Fail closed if the page stops responding. This refreshes permission only;
  // the native watchdog and NAS lease each independently stop orphan playback.
  const heartbeat = setInterval(() => {
    send("state", state);
    layout();
  }, 2500);
  const controller = {
    engine: "native",
    getTime: () =>
      Math.max(
        0,
        (clock.positionMs +
          (clock.playing && state.lease && !state.paused
            ? Math.min(400, performance.now() - clock.received)
            : 0)) /
          1000,
      ),
    selected: () => null,
    setState(value) {
      state = { ...state, ...value };
      send("state", state);
    },
    seek(time) {
      if (Number.isFinite(time)) {
        ended = false;
        send("seek", { positionMs: Math.max(0, time * 1000) });
      }
    },
    async start() {
      ended = false;
      send("retry");
      send("state", state);
    },
    destroy() {
      send("stop");
      disposed = true;
      clearInterval(heartbeat);
      cancelAnimationFrame(raf);
      observer.disconnect();
      resize?.disconnect();
      picture(false);
      window.removeEventListener("haohaochang-native-state", receive);
      window.removeEventListener("resize", scheduleLayout);
      window.removeEventListener("scroll", scheduleLayout, true);
      if (video._playback === controller) {
        delete video._playback;
        delete video._nativeStats;
        delete video.dataset.engine;
      }
    },
  };
  video._playback = controller;
  return controller;
}
