import React, { useEffect, useMemo, useState } from "react";
import { parseLyrics, progress } from "../shared/lyrics.js";
export { parseLyrics } from "../shared/lyrics.js";
export function Lyrics({ song, time, token, resource }) {
  const [style, setStyle] = useState({
    font: "sans-serif",
    size: 48,
    color: "#ffd66e",
    offset: 0,
  });
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/lyrics-style?token=" + encodeURIComponent(token), {
      signal: abort.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (v && !abort.signal.aborted) setStyle(v);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [song.id, token]);
  useEffect(() => {
    const abort = new AbortController();
    setFetched(null);
    if (resource?.url)
      fetch(resource.url, { signal: abort.signal })
        .then((r) => {
          if (!r.ok) throw new Error("歌词读取失败");
          return r.text();
        })
        .then((text) => {
          if (!abort.signal.aborted) setFetched({ url: resource.url, text });
        })
        .catch(() => {});
    return () => abort.abort();
  }, [song.id, resource?.url]);
  const text =
    fetched?.url === resource?.url
      ? (fetched?.text ?? song.lyrics)
      : song.lyrics;
  const lines = useMemo(() => parseLyrics(text || ""), [text]);
  const clock =
      time + (Number(style.offset) || 0) + (Number(resource?.offset) || 0),
    index = lines.reduce((found, l, i) => (l.time <= clock ? i : found), -1),
    line = lines[index],
    end = lines[index + 1]?.time ?? song.duration;
  return (
    <div
      className="lyrics-scene"
      style={{
        fontFamily: style.font,
        "--karaoke-size": style.size + "px",
        "--karaoke-color": style.color,
      }}
    >
      {!!song.needs_video && (
        <div className="audio-title">
          <small>音频舞台 · 待补 MTV</small>
          <h2>{song.title}</h2>
          <p>{song.artist}</p>
        </div>
      )}
      {lines.length ? (
        <div className="lyric-lines">
          <strong
            className={line?.words?.length ? "" : "karaoke-line"}
            style={{
              "--lyric-fill": progress(clock, line?.time ?? 0, end) + "%",
            }}
          >
            {!line
              ? "前奏，准备开唱…"
              : line.words.length
                ? line.words.map((word, i) => (
                    <span
                      key={i}
                      className="karaoke-line"
                      style={{
                        "--lyric-fill":
                          progress(
                            clock,
                            word.time,
                            line.words[i + 1]?.time ?? end,
                          ) + "%",
                      }}
                    >
                      {word.text}
                    </span>
                  ))
                : line.text}
          </strong>
          <span>{lines[Math.max(0, index + 1)]?.text}</span>
        </div>
      ) : (
        <div className="lyric-lines">
          <strong>{text || "歌词待补充"}</strong>
          <span>
            {text ? "纯文本歌词 · 暂无时间轴" : "请在后台自动查找或导入 LRC"}
          </span>
        </div>
      )}
    </div>
  );
}
