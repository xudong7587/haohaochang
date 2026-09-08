import React, { useEffect, useReducer, useState } from "react";
import { createDraft, draftReducer, isRevisionConflict } from "./draft.js";
import { VideoConfirmation, validOffset } from "./video-confirmation.jsx";

const resourceNames = {
  video: "视频画面",
  vocal: "原唱音轨",
  backing: "伴奏音轨",
  lyrics: "同步歌词",
};
export function ResourceRow({
  row,
  review,
  request,
  action,
  busy,
  notify,
  onEdit,
  hidden,
}) {
  const [open, setOpen] = useState(false),
    [draft, dispatch] = useReducer(draftReducer, row, createDraft);
  const [confirmed, setConfirmed] = useState(false),
    [offset, setOffset] = useState(""),
    [parsed, setParsed] = useState(null),
    [checkedConflict, setCheckedConflict] = useState(false),
    [conflictLoaded, setConflictLoaded] = useState(true);
  const form = draft.values,
    changedUrl = !!form.url && form.url !== row.sourceUrl;
  const hasDualAudio = row.manifest
    ? row.manifest.vocal && row.manifest.backing
    : ["audio", "standard"].includes(row.tier);
  useEffect(() => {
    dispatch({ type: "refresh", row });
    setConflictLoaded(true);
  }, [row]);
  useEffect(() => {
    setCheckedConflict(false);
  }, [draft.latest.revision, draft.conflict]);
  useEffect(() => {
    setConfirmed(false);
    setOffset("");
    setParsed(null);
  }, [form.url]);
  const edit = (patch) => dispatch({ type: "edit", patch });
  async function run(fn) {
    await action(async () => {
      try {
        return await fn();
      } catch (error) {
        if (isRevisionConflict(error)) {
          dispatch({ type: "conflict" });
          setConflictLoaded(false);
          setOpen(true);
        }
        throw error;
      }
    });
  }
  function checkDraft() {
    if (draft.conflict) throw new Error("资料已经变化，请先处理草稿冲突");
  }
  function replacementPayload(revision = draft.revision) {
    if (!confirmed || !validOffset(offset))
      throw new Error("请试听确认录音版本并填写视频偏移");
    return {
      url: form.url,
      expectedRevision: revision,
      confirmed: true,
      offset: Number(offset),
    };
  }
  async function save(prepare = false) {
    checkDraft();
    if (!form.title.trim() || !form.artist.trim() || form.artist === "未知歌手")
      throw new Error("请填写歌名和实际演唱者");
    if (prepare && !form.lyrics.trim()) throw new Error("请先补充同步歌词");
    if (prepare && !review && changedUrl) replacementPayload();
    const values = { ...form };
    if (review) {
      await request(
        row.inbox ? "/admin/inbox" : "/admin/reviews/" + row.id,
        {
          ...values,
          file: row.file,
          sourceUrl: form.url,
          expectedRevision: draft.revision,
          action: "confirm",
        },
        "POST",
      );
      dispatch({ type: "saved", values, revision: draft.revision });
      notify("已保存并继续整理");
      return;
    }
    const result = await request(
      "/admin/library/" + row.id + "/save",
      {
        ...values,
        prepare: prepare && !changedUrl,
        expectedRevision: draft.revision,
      },
      "POST",
    );
    // Saving metadata does not imply that an edited video URL has been published.
    dispatch({
      type: "saved",
      values: { ...values, url: row.sourceUrl || "" },
      revision: result.metadataRevision,
    });
    if (prepare && changedUrl) {
      await request(
        "/admin/library/" + row.id + "/source",
        replacementPayload(result.metadataRevision),
        "POST",
      );
      notify("资料已保存，已提交视频关联");
    } else notify(prepare ? "资料已保存，已继续整理" : "已保存信息");
  }
  async function organize() {
    if (review) return run(() => save(true));
    if (draft.dirty || draft.conflict) {
      setOpen(true);
      notify("有未保存草稿，请先核对并保存");
      return;
    }
    await run(async () => {
      await request(
        "/admin/library/" + row.id + "/organize",
        { expectedRevision: draft.revision },
        "POST",
      );
      notify("已开始整理，任务进度可在设置与任务查看");
    });
  }
  async function findLyrics() {
    setOpen(true);
    await run(async () => {
      const result = await request(
        "/admin/find-lyrics",
        {
          title: form.title,
          artist: form.artist,
          duration: row.duration,
          version:
            row.candidate?.identity?.version ||
            parsed?.candidate?.identity?.version ||
            "",
        },
        "POST",
      );
      const { lyrics, ...lyricsSource } = result;
      edit({ lyrics, lyricsSource });
      notify(
        `${result.source || result.provider || "歌词提供者"} 候选已载入，请试听核对录音版本与字幕节奏后保存`,
      );
    });
  }
  async function refreshMetadata() {
    setOpen(true);
    await run(async () => {
      const result = await request(
        "/admin/refresh-metadata",
        {
          id: review ? undefined : row.id,
          ...form,
          expectedRevision: draft.revision,
        },
        "POST",
      );
      edit({
        title: result.title || form.title,
        artist: result.artist || form.artist,
      });
      notify(result.note || "识别资料已放入草稿，请核对后保存");
    });
  }
  return (
    <article className="workbench-row" hidden={hidden} data-song-id={row.id}>
      <header>
        <div>
          <strong>{row.title || "未识别歌名"}</strong>
          <p>
            {row.artist || "未识别歌手"} ·{" "}
            {{
              ready: "播放资源已准备",
              new: "等待处理",
              preparing: "处理中",
              error: "处理失败",
              import: "等待入库",
              acquire: "等待找歌",
            }[row.status || row.kind] || "待处理"}
            {draft.dirty ? " · 草稿未保存" : ""}
          </p>
        </div>
        <div className="actions">
          <button
            className="primary"
            disabled={busy || draft.conflict}
            onClick={organize}
          >
            {row.tier === "audio" ? "整理 / 查找 MV" : "开始整理"}
          </button>
          <button disabled={busy || draft.conflict} onClick={refreshMetadata}>
            刷新歌名 / 歌手
          </button>
          <button disabled={busy} onClick={() => setOpen(true)}>
            {row.tier === "audio" ? "补充 MV" : "替换视频"}
          </button>
          <button
            disabled={busy || draft.conflict || !form.title || !form.artist}
            onClick={findLyrics}
          >
            自动找歌词
          </button>
          <button onClick={() => setOpen(!open)}>
            {open ? "收起" : "编辑歌曲"}
          </button>
        </div>
      </header>
      {row.note && <p>{row.note}</p>}
      {row.missing?.length > 0 && (
        <p className="error">
          缺失或未通过校验：
          {row.missing.map((name) => resourceNames[name] || name).join("、")}
        </p>
      )}
      {row.folder && (
        <details>
          <summary>文件位置</summary>
          <code>{row.folder}</code>
        </details>
      )}
      {draft.conflict && (
        <div role="alert" className="settings-card">
          <strong>资料已更新，草稿已保留</strong>
          <p>
            请比较最新资料后决定如何继续。当前草稿基于修订 {draft.revision}
            ，最新修订 {draft.latest.revision}。
          </p>
          <p>
            最新歌名：{draft.latest.values.title}；最新歌手：
            {draft.latest.values.artist}
          </p>
          <details>
            <summary>查看最新歌词</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {draft.latest.values.lyrics || "没有歌词"}
            </pre>
          </details>
          {!conflictLoaded && <p>正在刷新最新资料，加载完成后再处理冲突。</p>}
          <div className="actions">
            <button
              disabled={busy || !conflictLoaded}
              onClick={() => dispatch({ type: "adopt" })}
            >
              采用最新资料，放弃草稿
            </button>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={checkedConflict}
                onChange={(event) => setCheckedConflict(event.target.checked)}
              />
              我已比较最新资料，确认要保存现有草稿
            </label>
            <button
              disabled={busy || !conflictLoaded || !checkedConflict}
              onClick={() => {
                dispatch({ type: "rebase" });
                setCheckedConflict(false);
              }}
            >
              保留草稿，按最新修订继续编辑
            </button>
          </div>
        </div>
      )}
      {open && (
        <>
          <div className="organize-fields">
            <label>
              歌手
              <input
                disabled={busy}
                value={form.artist}
                onChange={(event) => edit({ artist: event.target.value })}
              />
            </label>
            <label>
              歌名
              <input
                disabled={busy}
                value={form.title}
                onChange={(event) => edit({ title: event.target.value })}
              />
            </label>
          </div>
          <p>
            {hasDualAudio
              ? "补充或替换画面会保留现有原唱、伴奏和歌词。请核对同一录音版本与起始偏移。"
              : "尚未具备完整双音轨。更换视频来源后需要重新匹配歌词和准备音轨。"}
          </p>
          <label>
            视频链接（B站支持 ?p= 分集）
            <input
              disabled={busy}
              value={form.url}
              onChange={(event) => edit({ url: event.target.value })}
              placeholder="https://www.bilibili.com/video/BV…"
            />
          </label>
          <div className="actions">
            <button
              disabled={busy || draft.conflict || !form.url}
              onClick={() =>
                run(async () => {
                  const info = await request(
                    "/admin/source-info",
                    { url: form.url },
                    "POST",
                  );
                  setParsed(info);
                  edit({
                    title: info.title || form.title,
                    artist: info.artist || form.artist,
                  });
                  notify(
                    info.needs_review
                      ? "已提取标题，请核对歌手、歌名与录音版本"
                      : "识别资料已放入草稿",
                  );
                })
              }
            >
              解析 MV 信息
            </button>
            <button
              disabled={busy || draft.conflict || !form.title || !form.artist}
              onClick={findLyrics}
            >
              自动找歌词
            </button>
            <label>
              导入 LRC
              <input
                disabled={busy || draft.conflict}
                type="file"
                accept=".lrc,.txt"
                onChange={async (event) => {
                  try {
                    const file = event.target.files[0];
                    if (!file) return;
                    if (file.size > 25000)
                      throw new Error("歌词文件不能超过 25 KB");
                    edit({
                      lyrics: await file.text(),
                      lyricsSource: {
                        source: "本地导入",
                        provider: "manual",
                        sourceId: file.name,
                        offsetUnit: "milliseconds",
                      },
                    });
                  } catch (error) {
                    notify(error.message);
                  }
                }}
              />
            </label>
          </div>
          {(parsed?.candidate?.canonicalUrl || form.url) && (
            <p>
              <a
                href={parsed?.candidate?.canonicalUrl || form.url}
                target="_blank"
                rel="noreferrer"
              >
                打开视频试听
              </a>
              {parsed?.candidate?.externalTitle
                ? ` · ${parsed.candidate.externalTitle}`
                : ""}
            </p>
          )}
          {!review && form.url && (
            <VideoConfirmation
              {...{ confirmed, setConfirmed, offset, setOffset, busy }}
            />
          )}
          <p className="muted">
            歌词来源：
            {form.lyricsSource?.source ||
              form.lyricsSource?.provider ||
              (form.lyrics ? "原有歌词，来源未记录" : "尚未选择")}
            。歌名、歌手和时长匹配只代表候选，请试听核对录音版本与字幕节奏。
          </p>
          <label>
            歌词
            <textarea
              disabled={busy}
              value={form.lyrics}
              onChange={(event) =>
                edit({
                  lyrics: event.target.value,
                  lyricsSource: {
                    source: "手动编辑",
                    provider: "manual",
                    offsetUnit: "milliseconds",
                  },
                })
              }
              placeholder="[00:12.00]带时间戳的歌词"
            />
          </label>
          <div className="actions">
            <button
              className="primary"
              disabled={
                busy ||
                draft.conflict ||
                (!review && changedUrl && (!confirmed || !validOffset(offset)))
              }
              onClick={() => run(() => save(true))}
            >
              保存并继续整理
            </button>
            {!review && (
              <>
                <button
                  disabled={busy || draft.conflict}
                  onClick={() => run(() => save(false))}
                >
                  仅保存信息
                </button>
                <button
                  disabled={
                    busy ||
                    draft.conflict ||
                    !form.url ||
                    !confirmed ||
                    !validOffset(offset)
                  }
                  onClick={() =>
                    run(async () => {
                      checkDraft();
                      await request(
                        "/admin/library/" + row.id + "/source",
                        replacementPayload(),
                        "POST",
                      );
                      notify("已提交视频关联，完成后生效");
                    })
                  }
                >
                  {row.tier === "audio"
                    ? "下载并补充 MV"
                    : "下载并替换当前视频"}
                </button>
                {onEdit && (
                  <button disabled={busy} onClick={onEdit}>
                    音轨高级设置
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await request("/admin/library/" + row.id, {}, "DELETE");
                      notify("已隐藏歌曲，可在已隐藏页恢复");
                    })
                  }
                >
                  移出曲库
                </button>
              </>
            )}
          </div>
        </>
      )}
    </article>
  );
}
