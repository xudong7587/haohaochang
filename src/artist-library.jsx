import React, { useEffect, useState } from "react";
import { ChevronLeft, Search, Pencil, Play, Plus, Disc3 } from "lucide-react";
import { SongArtwork } from "./song-artwork.jsx";
import { LocalSongPreview } from "./local-song-preview.jsx";
import { Pagination } from "./workbench-controls.jsx";
import { ArtistArtwork, artistPhotoUrl } from "./artist-artwork.jsx";
import { ArtistProfileEditor } from "./artist-profile-editor.jsx";
import { ResourceRow } from "./library/resource-row.jsx";
import "./artist-library.css";

export function ArtistLibrary({
  artist,
  request,
  token,
  back,
  notify,
  manage = true,
  add,
  refreshProfile,
}) {
  const [songs, setSongs] = useState([]),
    [profile, setProfile] = useState(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1),
    [preview, setPreview] = useState(null),
    [editing, setEditing] = useState(""),
    [editProfile, setEditProfile] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function read() {
    const [rows, details] = await Promise.all([
      request(
        `${manage ? "/admin/library" : "/songs"}?artist=${encodeURIComponent(artist)}`,
      ),
      request("/artist-profile?artist=" + encodeURIComponent(artist)),
    ]);
    setSongs(rows.filter((row) => row.artist === artist));
    setProfile(details);
    setError("");
  }
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const [rows, details] = await Promise.all([
          request(
            `${manage ? "/admin/library" : "/songs"}?artist=${encodeURIComponent(artist)}`,
          ),
          request("/artist-profile?artist=" + encodeURIComponent(artist)),
        ]);
        if (alive) {
          setSongs(rows.filter((row) => row.artist === artist));
          setProfile(details);
          setError("");
        }
      } catch (e) {
        if (alive) setError(e.message);
      }
    }
    poll();
    const timer = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [artist, manage]);
  const filtered = songs
    .filter(
      (song) =>
        song.title.toLowerCase().includes(query.toLowerCase()) &&
        (filter === "all" ||
          (filter === "missing" ? !song.hasPoster : song.tier === filter)),
    )
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / 24)));
  async function action(work) {
    setBusy(true);
    try {
      const result = await work();
      await read();
      return result;
    } catch (e) {
      /* ResourceRow keeps errors in its dialog. */
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={`artist-library-wall ${manage ? "artist-manage" : "artist-listen"}`}
    >
      <button className="back" onClick={back}>
        <ChevronLeft size={16} />
        返回歌手
      </button>
      <div className="artist-detail-hero">
        {profile?.hasPhoto && (
          <img
            className="artist-hero-background"
            src={artistPhotoUrl(profile, token)}
            alt=""
          />
        )}
        <div className="artist-hero-shade" />
        <div className="artist-hero-content">
          <div className="artist-hero-portrait">
            {profile ? (
              <ArtistArtwork profile={profile} token={token} />
            ) : (
              <Disc3 size={60} />
            )}
          </div>
          <div className="artist-hero-copy">
            <p className="wall-eyebrow">ARTIST COLLECTION</p>
            <h1>{artist}</h1>
            <div className="artist-hero-meta">
              <span>{songs.length} 首歌曲</span>
              <span>我的音乐收藏</span>
            </div>
            {profile?.description ? (
              <p className="artist-description">{profile.description}</p>
            ) : (
              <p className="artist-description">
                {manage
                  ? "为这位歌手补充介绍，留下你喜欢的音乐故事。"
                  : "熟悉的声音，值得再唱一遍。"}
              </p>
            )}
            <div className="artist-hero-actions">
              {manage ? (
                <button
                  onClick={() => setEditProfile(true)}
                  disabled={!profile}
                >
                  <Pencil size={16} />
                  编辑歌星资料
                </button>
              ) : (
                <button
                  onClick={() =>
                    document
                      .getElementById("artist-song-wall")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  <Play size={16} />
                  浏览歌曲
                </button>
              )}
              {profile?.descriptionSource && (
                <a
                  href={profile.descriptionSource}
                  target="_blank"
                  rel="noreferrer"
                >
                  介绍来源 ↗
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="section-heading" id="artist-song-wall">
        <div>
          <h2>这位歌手的歌</h2>
          <p>
            {manage
              ? "点击封面编辑歌曲；也可以先试听原唱。"
              : "选一首，让这段旋律在客厅响起。"}
          </p>
        </div>
        <span className="pill">{filtered.length} 首</span>
      </div>
      <div className="list-toolbar">
        <label className="list-search">
          <Search size={16} />
          <input
            aria-label="搜索歌手歌曲"
            placeholder="在这位歌手的曲库中搜索"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
        {manage && (
          <select
            aria-label="海报墙筛选"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">全部歌曲</option>
            <option value="standard">标准曲库</option>
            <option value="audio">半标准曲库</option>
            <option value="pending">待整理</option>
            <option value="missing">待补封面</option>
          </select>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="artist-song-masonry song-poster-grid">
        {filtered.slice((current - 1) * 24, current * 24).map((song) => (
          <article className="song-poster-card" key={song.id}>
            <button
              onClick={() => (manage ? setEditing(song.id) : add(song))}
              aria-label={`${manage ? "编辑" : "点歌"} ${song.title}`}
            >
              <span className="song-poster-image">
                <SongArtwork song={song} token={token} size={52} />
                <span className="poster-play">
                  {manage ? (
                    <>
                      <Pencil size={16} />
                      编辑歌曲
                    </>
                  ) : (
                    <>
                      <Plus size={18} />
                      点歌
                    </>
                  )}
                </span>
              </span>
              <strong>{song.title}</strong>
              <small>{song.posterSource?.album || song.artist}</small>
            </button>
            <div className="artist-song-card-footer">
              <span>
                {song.duration > 0
                  ? `${Math.floor(song.duration / 60)}:${String(Math.floor(song.duration % 60)).padStart(2, "0")}`
                  : "曲库收藏"}
              </span>
              {manage ? (
                <button
                  onClick={() => setPreview(song)}
                  aria-label={`预览 ${song.title}`}
                >
                  <Play size={13} />
                  试听
                </button>
              ) : (
                <Plus size={15} />
              )}
            </div>
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
      {preview && (
        <LocalSongPreview
          song={preview}
          request={request}
          token={token}
          notify={notify}
          close={() => setPreview(null)}
        />
      )}
      {editing && songs.find((song) => song.id === editing) && (
        <ResourceRow
          key={editing}
          row={songs.find((song) => song.id === editing)}
          dialogOnly
          onClose={() => setEditing("")}
          request={request}
          action={action}
          busy={busy}
          notify={notify}
        />
      )}
      {editProfile && profile && (
        <ArtistProfileEditor
          profile={profile}
          request={request}
          token={token}
          close={() => setEditProfile(false)}
          saved={(value) => {
            setProfile(value);
            refreshProfile?.();
          }}
        />
      )}
    </section>
  );
}
