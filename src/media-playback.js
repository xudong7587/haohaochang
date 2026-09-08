import { useEffect, useRef, useState } from "react";
import { normalizeManifest } from "./playback/manifest.js";
import { createPlaybackController } from "./playback/controller.js";
export function useMediaPlayback({
  video,
  current,
  variant,
  lease,
  paused,
  token,
  reload = 0,
  onError = () => {},
  onStatus = () => {},
  onEnded = () => {},
}) {
  const [manifest, setManifest] = useState(null),
    callbacks = useRef({ onError, onStatus, onEnded });
  callbacks.current = { onError, onStatus, onEnded };
  useEffect(() => {
    const abort = new AbortController();
    setManifest(null);
    if (!current) return () => abort.abort();
    fetch(
      `/api/playback-assets/${current.song_id}?token=${encodeURIComponent(token)}`,
      { signal: abort.signal },
    )
      .then((r) => {
        if (!r.ok) throw new Error("播放资源读取失败");
        return r.json();
      })
      .then((value) => {
        if (!abort.signal.aborted)
          setManifest({
            ...normalizeManifest(value, { songId: current.song_id, token }),
            entryId: current.id,
          });
      })
      .catch((error) => {
        if (!abort.signal.aborted) callbacks.current.onError(error.message);
      });
    return () => abort.abort();
  }, [current?.id, current?.song_id, current?.resourceRevision, token, reload]);
  useEffect(() => {
    if (
      !video.current ||
      manifest?.version !== 2 ||
      manifest.entryId !== current?.id
    )
      return;
    const controller = createPlaybackController({
      video: video.current,
      manifest,
      onStatus: (status) => callbacks.current.onStatus(status),
      onEnded: () => callbacks.current.onEnded(current.id),
    });
    return () => controller.destroy();
  }, [video, manifest, current?.id]);
  useEffect(() => {
    video.current?._playback?.setState({ lease, paused, variant });
  }, [video, manifest, lease, paused, variant]);
  return manifest?.entryId === current?.id ? manifest : null;
}
