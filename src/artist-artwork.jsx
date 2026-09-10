import React, { useState } from "react";
export const artistPhotoUrl = (profile, token) =>
  `/api/artist-photo/${profile.id}?token=${encodeURIComponent(token)}&v=${encodeURIComponent(profile.photoVersion || "")}`;
export function ArtistArtwork({ profile, token, className = "" }) {
  const url = artistPhotoUrl(profile, token),
    [failed, setFailed] = useState("");
  return profile.hasPhoto && failed !== url ? (
    <img
      className={className}
      src={url}
      alt={`${profile.artist}的照片`}
      loading="lazy"
      onError={() => setFailed(url)}
    />
  ) : (
    <span
      className={`artist-photo-placeholder ${className}`}
      aria-label={`${profile.artist}的照片待补充`}
    >
      {profile.artist.slice(0, 1)}
    </span>
  );
}
