import React, { useState } from "react";
import { OnlineSongs } from "../online-songs.jsx";

export function VideoRefresh({ row, revision, request, notify, busy }) {
  const [search, setSearch] = useState(null);
  const source = row.recordingSource;
  const canKeepAudio = !!row.manifest?.vocal && !!row.manifest?.backing;
  const detail = row.manifest?.resources?.video;
  return (
    <section className="video-refresh">
      <h3>更新视频</h3>
      <p>
        保留下载的原始 4K
        和高帧率规格。更换录音版本时，重新生成原唱并去除人声；完成前继续保留旧资源。
      </p>
      {detail?.width > 0 && (
        <p>
          当前画面：{detail.width} × {detail.height}
          {detail.codec ? ` · ${detail.codec}` : ""}
          {detail.fps ? ` · ${detail.fps.toFixed(2)} fps` : ""}
        </p>
      )}
      {source?.url ? (
        <div className="video-refresh-source">
          <span>原始来源</span>
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.url}
          </a>
          <small>
            {!canKeepAudio
              ? "双音轨尚未齐全，更新时会重新生成原唱与伴奏。"
              : source.untrimmed
                ? "同一分 P，确认未裁剪，可仅更新画面。"
                : source.clip
                  ? `曾裁剪 ${source.clip.start}–${source.clip.end} 秒，更新时重新分离音频。`
                  : "裁剪或录音来源记录不完整，更新时重新分离音频。"}
          </small>
        </div>
      ) : (
        <p>
          这首歌没有可信的在线来源记录。可以按歌名、歌手查找，或粘贴
          B站链接选取新版本。
        </p>
      )}
      <div className="actions">
        {source?.url && (
          <button
            disabled={busy}
            onClick={() => setSearch({ key: Date.now(), url: source.url })}
          >
            从原链接更新
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => setSearch({ key: Date.now(), url: "" })}
        >
          在线寻找新视频
        </button>
      </div>
      {search && (
        <OnlineSongs
          key={search.key}
          initialTitle={row.title}
          initialArtist={row.artist}
          initialUrl={search.url}
          refreshSource={canKeepAudio ? source : null}
          notify={notify}
          canLogin
          onReplace={async (input) => {
            if (busy) throw new Error("歌曲正在处理中，请稍后再试");
            const result = await request(
              `/admin/library/${row.id}/refresh-video`,
              { ...input, expectedRevision: revision },
              "POST",
            );
            notify(
              result.mode === "video-only"
                ? "已提交仅更新视频；原唱、伴奏和歌词偏移保留。"
                : "已提交新版本：重新生成原唱、分离伴奏并核对歌词。完成后整套更新。旧歌词微调会重新开始。",
            );
          }}
        />
      )}
    </section>
  );
}
