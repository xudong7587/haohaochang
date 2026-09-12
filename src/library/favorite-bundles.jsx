import React, { useState } from "react";
export function FavoriteBundles({ bundles, request, refresh, notify }) {
  const [drafts, setDrafts] = useState({}),
    [busy, setBusy] = useState("");
  async function submit(group, operation) {
    setBusy(group.id);
    try {
      await request(
        `/admin/favorite-bundles/${group.id}/${operation}`,
        drafts[group.id] || {},
        "POST",
      );
      await refresh();
      notify(
        operation === "confirm"
          ? "已按各 P 的歌名逐首建立处理任务"
          : "已重试未完成的下载",
      );
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy("");
    }
  }
  if (!bundles.length) return null;
  return (
    <section className="favorite-bundles" aria-label="收藏夹待整理">
      {bundles.map((group) => {
        const draft = drafts[group.id] || {};
        const update = (key, value) =>
          setDrafts((all) => ({
            ...all,
            [group.id]: { ...all[group.id], [key]: value },
          }));
        return (
          <article
            key={group.id}
            className="favorite-bundle"
            data-bundle-id={group.id}
          >
            <strong>{group.title}</strong>
            <p className="muted">
              {group.total > 1 ? "多 P 合集" : "单首歌曲"} · 已下载{" "}
              {group.downloaded}/{group.total} 首 ·{" "}
              {group.status === "review"
                ? "等待补充资料"
                : group.status === "analyzing"
                  ? "正在读取 NFO"
                  : "等待下载齐全"}
            </p>
            <details>
              <summary>查看各首歌名与识别结果</summary>
              <ol>
                {group.parts.map((part) => (
                  <li key={part.cid}>
                    P{part.page} · {part.title} · {part.artist || "歌手待识别"}
                    {!part.downloaded ? " · 未下载完成" : ""}
                  </li>
                ))}
              </ol>
            </details>
            {group.status === "review" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submit(group, "confirm");
                }}
              >
                <label>
                  歌手
                  <input
                    aria-label={`合集歌手：${group.title}`}
                    required
                    maxLength={120}
                    value={draft.artist || ""}
                    onChange={(e) => update("artist", e.target.value)}
                    placeholder="填写一次，补齐缺少歌手的歌曲"
                  />
                </label>
                {group.total === 1 && (
                  <label>
                    歌名
                    <input
                      aria-label={`歌曲名称：${group.title}`}
                      maxLength={120}
                      value={draft.title ?? group.parts[0].title}
                      onChange={(e) => update("title", e.target.value)}
                    />
                  </label>
                )}
                <button
                  className="primary"
                  disabled={!!busy || !draft.artist?.trim()}
                >
                  确认并逐首处理
                </button>
                <small className="muted">
                  保留每一 P
                  的独立歌名及已识别演唱者；合集本身不会进入标准曲库。
                </small>
              </form>
            )}
            {group.status === "downloading" && (
              <button disabled={!!busy} onClick={() => submit(group, "retry")}>
                重试未完成下载
              </button>
            )}
          </article>
        );
      })}
    </section>
  );
}
