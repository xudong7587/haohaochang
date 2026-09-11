import React, { useEffect, useState } from "react";

export function PlaybackDiagnostics({ video, open }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (!open) return;
    const read = () => {
      const media = video.current;
      if (media?._nativeStats)
        setStats({ native: true, ...media._nativeStats });
      else {
        const quality = media?.getVideoPlaybackQuality?.();
        setStats({
          native: false,
          width: media?.videoWidth,
          height: media?.videoHeight,
          droppedFrames: quality?.droppedVideoFrames,
          decoder: "浏览器系统播放器",
        });
      }
    };
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [open, video]);
  if (!open || !stats) return null;
  return (
    <div className="playback-diagnostics" role="status">
      <strong>{stats.native ? "原生 Media3 · SurfaceView" : "网页播放"}</strong>
      <span>
        {stats.width || "—"} × {stats.height || "—"}
        {stats.fps > 0 ? ` · ${stats.fps.toFixed(2)} fps` : ""}
      </span>
      <span>解码器：{stats.decoder || "正在初始化"}</span>
      <span>
        累计掉帧：{stats.droppedFrames ?? "设备未提供"}
        {stats.native
          ? ` · 已缓冲 ${(stats.bufferedMs / 1000).toFixed(1)} 秒${stats.buffering ? " · 正在缓冲" : ""}`
          : ""}
      </span>
    </div>
  );
}
