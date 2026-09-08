import React, { useState } from "react";
import { Modal } from "./components.jsx";
import { api } from "./api.js";
export function Editor({ song, close, attempt, refresh }) {
  const [form, setForm] = useState({ ...song }),
    [lyrics, setLyrics] = useState(song.lyrics || ""),
    [replacement, setReplacement] = useState(""),
    [audio, setAudio] = useState(JSON.parse(song.audio || "[]")),
    [busy, setBusy] = useState(false);
  const field = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  async function save(prepare) {
    setBusy(true);
    const ok = await attempt(() =>
      api(
        `/admin/songs/${song.id}`,
        { ...form, lyrics, expectedRevision: song.metadataRevision },
        "PATCH",
        true,
      ),
    );
    if (ok) {
      if (prepare)
        await attempt(
          () => api(`/admin/songs/${song.id}/prepare`, {}, "POST", true),
          "已加入转码任务",
        );
      refresh();
      close();
    }
    setBusy(false);
  }
  return (
    <Modal title="歌曲与音频设置" close={close}>
      <div className="editor">
        <label>
          歌名
          <input
            value={form.title}
            onChange={(e) => field("title", e.target.value)}
          />
        </label>
        <label>
          歌手
          <input
            value={form.artist}
            onChange={(e) => field("artist", e.target.value)}
          />
        </label>
        <label>
          资源类型
          <select
            value={form.mode}
            onChange={(e) => field("mode", e.target.value)}
          >
            {song.mode === "separated" && (
              <option value="separated">已保存 AI 伴奏 / 原唱</option>
            )}
            <option value="original">普通 MV · 原始音频</option>
            <option value="instrumental">纯伴奏 · 无原唱版本</option>
            <option value="tracks">KTV · 独立双音轨</option>
            <option value="channels">KTV · 左右声道</option>
          </select>
        </label>
        <button
          onClick={async () => {
            const info = await attempt(() =>
              api(`/admin/songs/${song.id}/probe`, {}, "POST", true),
            );
            if (info) setAudio(info.audio);
          }}
        >
          检测媒体音轨
        </button>
        {audio.map((a) => (
          <p className="fine" key={a.index}>
            音轨 {a.index} · {a.title} · {a.channels} 声道 · {a.codec}
          </p>
        ))}
        {["tracks", "channels"].includes(form.mode) && (
          <div className="two-cols">
            {[
              ["backing", "伴奏"],
              ["vocal", "原唱"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                {form.mode === "channels"
                  ? "声道（0 左 / 1 右）"
                  : "音轨序号（从 0 开始）"}
                <input
                  type="number"
                  min="0"
                  max={form.mode === "channels" ? 1 : 31}
                  value={form[key]}
                  onChange={(e) => field(key, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
        )}
        <p className="note">
          依据实际文件配置。系统不会自动消除普通 MV
          的人声；改变音轨配置后需要重新准备。
        </p>
        {song.error && <p className="error">{song.error}</p>}
        <label>
          歌词（LRC 或纯文本）
          <textarea
            rows="5"
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder="[00:12.00]第一句歌词"
          />
        </label>
        {!!song.needs_video && (
          <label>
            补充视频的容器内路径
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="/media/歌手 - 歌名.mp4"
            />
            <button
              type="button"
              disabled={!replacement}
              onClick={async () => {
                const ok = await attempt(
                  () =>
                    api(
                      `/admin/songs/${song.id}/replace`,
                      {
                        path: replacement,
                        expectedRevision: song.metadataRevision,
                        confirmed: confirm(
                          "确认已试听为相同录音版本、画面偏移为0秒？",
                        ),
                      },
                      "POST",
                      true,
                    ),
                  "视频已补充，请重新检测音轨并准备播放",
                );
                if (ok) {
                  refresh();
                  close();
                }
              }}
            >
              关联补充视频
            </button>
          </label>
        )}
        <div className="modal-actions">
          <button disabled={busy} onClick={() => save(false)}>
            保存
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => save(true)}
          >
            {busy ? "保存中…" : "保存并准备播放"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
