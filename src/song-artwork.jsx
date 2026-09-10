import React, { useState } from "react";
import { Disc3 } from "lucide-react";
export function posterUrl(song, token) {
  return `/api/poster/${encodeURIComponent(song.id || song.song_id)}?token=${encodeURIComponent(token)}&v=${encodeURIComponent(song.posterVersion || song.posterSource?.hash || "")}`;
}
export function SongArtwork({ song, token, className = "", size = 36 }) {
  const url = posterUrl(song, token);
  const [failed, setFailed] = useState("");
  return song.hasPoster && failed !== url ? (
    <img
      className={className}
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(url)}
    />
  ) : (
    <Disc3 size={size} aria-hidden="true" />
  );
}
