import React, { useEffect, useState } from "react";
import { LyricsSurface } from "../lyrics-surface.jsx";
import {
  defaultLyricsStyle,
  normalizeLyricsStyle,
} from "../../shared/lyrics-style.js";
export function LyricsSettings({ request, notify }) {
  const [style, setStyle] = useState(defaultLyricsStyle);
  useEffect(() => {
    request("/lyrics-style")
      .then((value) => setStyle(normalizeLyricsStyle(value)))
      .catch(() => {});
  }, []);
  return (
    <form
      className="settings-card"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await request("/admin/lyrics-style", style, "POST");
          notify("字幕样式已保存，下一首歌应用");
        } catch (error) {
          notify(error.message);
        }
      }}
    >
      <h3>演唱字幕</h3>
      <div className="lyrics-preview-frame" aria-label="歌词静态预览">
        <small>16:9 · 歌词预览</small>
        <LyricsSurface style={style}>
          <div className="lyric-lines">
            <strong className="karaoke-line">今晚，唱一首喜欢的歌</strong>
            <span>熟悉的旋律，和身边的人</span>
          </div>
        </LyricsSurface>
      </div>
      <p className="lyrics-preview-note">
        预览按播放画面比例缩放。保存后，网页歌房和 TV 在下一首歌应用。
      </p>
      <div className="lyrics-tuning">
        {[
          ["size", "歌词大小", 24, 90],
          ["x", "水平位置", 10, 90],
          ["y", "垂直位置", 20, 80],
        ].map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <output>
              {style[key]}
              {key === "size" ? "" : "%"}
            </output>
            <input
              aria-label={label}
              type="range"
              min={min}
              max={max}
              step="1"
              value={style[key]}
              onChange={(event) =>
                setStyle({ ...style, [key]: Number(event.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <p>
        当前句渐变着色、下一句预告。增强 LRC 使用逐字时间戳；普通 LRC
        按整句进度着色。
      </p>
      <label>
        字体名称
        <input
          value={style.font}
          onChange={(event) => setStyle({ ...style, font: event.target.value })}
          placeholder="例如 Microsoft YaHei, sans-serif"
        />
      </label>
      <p>字体需安装在播放设备上；未安装时使用系统字体。</p>
      <label>
        字号
        <input
          type="number"
          min="24"
          max="90"
          value={style.size}
          onChange={(event) =>
            setStyle({ ...style, size: Number(event.target.value) })
          }
        />
      </label>
      <label>
        演唱颜色
        <input
          type="color"
          value={style.color}
          onChange={(event) =>
            setStyle({ ...style, color: event.target.value })
          }
        />
      </label>
      <label>
        歌词提前量（秒，可为负数）
        <input
          type="number"
          step="0.1"
          min="-10"
          max="10"
          value={style.offset}
          onChange={(event) =>
            setStyle({ ...style, offset: Number(event.target.value) })
          }
        />
      </label>
      <button>保存字幕设置</button>
    </form>
  );
}
