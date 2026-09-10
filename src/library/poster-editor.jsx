import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Search, Upload } from "lucide-react";
import { adminToken } from "../api.js";
import { SongArtwork } from "../song-artwork.jsx";

export function PosterEditor({
  row,
  title,
  artist,
  review,
  busy,
  request,
  run,
  notify,
  photoEndpoint,
  currentImage,
  autoFind,
  onSaved,
}) {
  const endpoint =
    photoEndpoint || ((action) => `/admin/library/${row.id}/poster/${action}`);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState(null);
  const [file, setFile] = useState(null);
  const [localUrl, setLocalUrl] = useState("");
  const [searchError, setSearchError] = useState("");
  const input = useRef(null),
    searchInput = useRef(null);
  const generation = useRef(0);
  useEffect(() => {
    if (!file) {
      setLocalUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const imageUrl = (item) =>
    `/api/admin/poster-candidates/${item.id}/image?token=${encodeURIComponent(adminToken)}`;
  async function search(nextPage = 1, initial = false) {
    const value = initial ? `${artist} ${title}`.trim() : query.trim();
    setQuery(value);
    if (!value) {
      setSearchError("请输入封面关键词");
      return;
    }
    const current = ++generation.current;
    setSearching(true);
    setSearchError("");
    setResults([]);
    try {
      const data = await request(
        `/admin/poster-search?q=${encodeURIComponent(value)}&page=${nextPage}`,
      );
      if (current !== generation.current) return;
      setResults(data.results);
      setPage(data.page);
      setHasMore(data.hasMore);
    } catch (error) {
      if (current === generation.current) setSearchError(error.message);
    } finally {
      if (current === generation.current) setSearching(false);
    }
  }
  async function save() {
    await run(async () => {
      let result;
      if (file)
        result = await request(
          `${endpoint("upload")}${endpoint("upload").includes("?") ? "&" : "?"}expectedRevision=${row.metadataRevision}`,
          file,
          "POST",
        );
      else
        result = await request(
          endpoint("select"),
          { candidateId: selected.id, expectedRevision: row.metadataRevision },
          "POST",
        );
      setFile(null);
      setSelected(null);
      onSaved?.(result);
      notify("封面已保存");
    });
  }
  return (
    <section
      className="poster-editor"
      aria-label={photoEndpoint ? "歌星照片" : "歌曲封面"}
    >
      <div className="poster-editor-overview">
        <div
          className="poster-editor-preview"
          aria-label={file || selected ? "待保存封面预览" : "当前封面预览"}
        >
          {file || selected ? (
            <img
              src={file ? localUrl || undefined : imageUrl(selected)}
              alt="待保存封面"
            />
          ) : currentImage ? (
            <img src={currentImage} alt="当前歌星照片" />
          ) : (
            <SongArtwork song={row} token={adminToken} size={56} />
          )}
        </div>
        <div className="poster-editor-tools">
          <strong>
            {file || selected ? "新封面预览 · 尚未保存" : "当前封面"}
          </strong>
          <p className="muted">
            {file?.name ||
              selected?.title ||
              row.posterSource?.source ||
              "暂未设置封面"}
          </p>
          <div className="actions">
            <button
              disabled={busy || review}
              onClick={() =>
                run(async () => {
                  if (autoFind) {
                    const candidate = await autoFind();
                    setFile(null);
                    setSelected(candidate);
                    notify("照片已找到，请预览后保存");
                    return;
                  }
                  await request(
                    `/admin/library/${row.id}/poster`,
                    { expectedRevision: row.metadataRevision, force: true },
                    "POST",
                  );
                  notify("已加入封面获取任务");
                })
              }
            >
              <ImagePlus size={16} />
              {photoEndpoint
                ? "获取歌手照片"
                : row.hasPoster
                  ? "重新获取封面"
                  : "获取歌曲封面"}
            </button>
            <button
              disabled={busy || searching}
              onClick={() => {
                search(1, true);
                searchInput.current?.focus();
              }}
            >
              <Search size={16} />去 B站搜索封面
            </button>
            <button
              disabled={busy || review}
              onClick={() => input.current.click()}
            >
              <Upload size={16} />
              上传封面
            </button>
            <input
              ref={input}
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="选择封面文件"
              onChange={(event) => {
                const next = event.target.files?.[0];
                event.target.value = "";
                if (!next) return;
                if (
                  next.size > 8 * 1024 * 1024 ||
                  !["image/jpeg", "image/png", "image/webp"].includes(next.type)
                ) {
                  setSearchError("请选择不超过 8 MB 的 JPG、PNG 或 WebP 图片");
                  return;
                }
                setSearchError("");
                setSelected(null);
                setFile(next);
              }}
            />
          </div>
          <small className="muted">
            JPG、PNG、WebP，最大 8 MB。
            {review ? "入库后可保存封面。" : "选择后预览，点击保存封面生效。"}
          </small>
          {(file || selected) && (
            <div className="actions poster-choice-actions">
              <button
                className="primary"
                disabled={busy || review}
                onClick={save}
              >
                保存封面
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  setSelected(null);
                }}
              >
                取消选择
              </button>
            </div>
          )}
        </div>
      </div>
      {searchError && (
        <p role="alert" className="poster-search-error">
          {searchError}
        </p>
      )}
      {results !== null && (
        <div className="poster-search">
          <form
            className="poster-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              search();
            }}
          >
            <input
              ref={searchInput}
              value={query}
              aria-label="B站封面关键词"
              placeholder="歌手、歌名或封面关键词"
              onChange={(e) => setQuery(e.target.value)}
            />
            <button disabled={searching} type="submit">
              {searching ? "正在搜索…" : "搜索封面"}
            </button>
            <button
              type="button"
              onClick={() => {
                generation.current++;
                setSearching(false);
                setResults(null);
              }}
            >
              收起
            </button>
          </form>
          <p className="muted">只使用视频封面，不下载或关联视频。</p>
          <div className="poster-candidates">
            {results.map((item) => (
              <button
                key={item.id}
                className="poster-candidate"
                aria-pressed={selected?.id === item.id}
                aria-label={`选择封面：${item.title}`}
                onClick={() => {
                  setFile(null);
                  setSelected(item);
                }}
              >
                <img src={imageUrl(item)} alt={item.title} loading="lazy" />
                <strong>{item.title}</strong>
                <small>{item.uploader}</small>
              </button>
            ))}
          </div>
          {!searching && !results.length && !searchError && (
            <p>没有找到封面，试试修改关键词。</p>
          )}
          {!searching && (page > 1 || hasMore) && (
            <div className="actions">
              <button disabled={page === 1} onClick={() => search(page - 1)}>
                上一页
              </button>
              <span>第 {page} 页</span>
              <button disabled={!hasMore} onClick={() => search(page + 1)}>
                下一页
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
