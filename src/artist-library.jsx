import React, { useEffect, useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import { SongArtwork } from "./song-artwork.jsx";
import { LocalSongPreview } from "./local-song-preview.jsx";
import { Pagination } from "./workbench-controls.jsx";
export function ArtistLibrary({ artist, request, token, back, notify }) {
  const [songs, setSongs] = useState([]),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1),
    [selection, setSelection] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const read = () =>
      request(`/admin/library?artist=${encodeURIComponent(artist)}`)
        .then((rows) => {
          if (alive) {
            setSongs(rows.filter((row) => row.artist === artist));
            setError("");
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    read();
    const timer = setInterval(read, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [artist]);
  const filtered = songs
    .filter(
      (song) =>
        song.title.toLowerCase().includes(query.toLowerCase()) &&
        (filter === "all" ||
          (filter === "missing" ? !song.hasPoster : song.tier === filter)),
    )
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / 24)));
  return (
    <section className="artist-library-wall">
      <button className="back" onClick={back}>
        <ChevronLeft size={16} />
        返回歌手
      </button>
      <div className="section-heading">
        <div>
          <p className="wall-eyebrow">歌手曲库</p>
          <h1>
            {artist}
            <span className="count">{songs.length} 首</span>
          </h1>
          <p>点击封面试听原唱，查看歌曲文件夹和资源。</p>
        </div>
      </div>
      <div className="list-toolbar">
        <label className="list-search">
          <Search size={16} />
          <input
            aria-label="搜索歌手歌曲"
            placeholder="在这位歌手的曲库中搜索"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <select
          aria-label="海报墙筛选"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">全部歌曲</option>
          <option value="standard">标准曲库</option>
          <option value="audio">半标准曲库</option>
          <option value="pending">待整理</option>
          <option value="missing">待补封面</option>
        </select>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="song-poster-grid">
        {filtered.slice((current - 1) * 24, current * 24).map((song) => (
          <article className="song-poster-card" key={song.id}>
            <button
              onClick={() => setSelection(song)}
              aria-label={`预览 ${song.title}`}
            >
              <span className="song-poster-image">
                <SongArtwork song={song} token={token} size={52} />
                <span className="poster-play">▶ 原唱预览</span>
              </span>
              <strong>{song.title}</strong>
              <small>
                {song.posterSource?.album ||
                  (song.tier === "standard"
                    ? "画面与双音轨已准备"
                    : song.tier === "audio"
                      ? "双音轨已准备"
                      : "等待整理")}
              </small>
            </button>
            {song.posterSource?.sourceUrl && (
              <a
                className="poster-source-link"
                href={song.posterSource.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {song.posterSource.provider === "bilibili"
                  ? "B站封面"
                  : "iTunes 专辑"}{" "}
                ↗
              </a>
            )}
          </article>
        ))}
      </div>
      {!filtered.length && <p className="list-empty">没有匹配歌曲。</p>}
      <Pagination
        total={filtered.length}
        page={current}
        pageSize={24}
        onPage={setPage}
        label="海报墙"
      />
      {selection && (
        <LocalSongPreview
          song={selection}
          {...{ request, token, notify }}
          close={() => setSelection(null)}
        />
      )}
    </section>
  );
}
