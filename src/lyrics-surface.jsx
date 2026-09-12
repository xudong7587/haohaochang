import React, { useEffect, useRef } from "react";
import { normalizeLyricsStyle } from "../shared/lyrics-style.js";
import "./lyrics-settings.css";
export function LyricsSurface({ style, children }) {
  const ref = useRef(null),
    value = normalizeLyricsStyle(style);
  useEffect(() => {
    const element = ref.current;
    const resize = () => {
      const width = element.clientWidth;
      element.style.setProperty("--lyrics-scale", String(width / 960));
      const lines = element.querySelector(".lyric-lines");
      if (!lines || !width) return;
      lines.style.setProperty("--line-fit", "1");
      const current = lines.querySelector("strong");
      const measured = current?.scrollWidth || lines.scrollWidth;
      const fit = Math.min(1, (width * 0.9) / Math.max(1, measured));
      lines.style.setProperty("--line-fit", String(fit));
      const textWidth = Math.min(
        width * 0.9,
        lines.getBoundingClientRect().width,
      );
      const center = Math.max(
        width * 0.05 + textWidth / 2,
        Math.min(width * 0.95 - textWidth / 2, (width * value.x) / 100),
      );
      lines.style.left = center + "px";
    };
    resize();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(element);
    const textObserver = new MutationObserver(resize);
    textObserver.observe(element, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      textObserver.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [value.size, value.x, value.font]);
  return (
    <div
      ref={ref}
      className="lyrics-scene lyrics-positioned"
      style={{
        fontFamily: value.font,
        "--karaoke-size": value.size + "px",
        "--karaoke-color": value.color,
        "--lyrics-x": value.x + "%",
        "--lyrics-y": value.y + "%",
      }}
    >
      {children}
    </div>
  );
}
