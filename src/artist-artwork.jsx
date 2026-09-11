import React, { useState } from "react";
import { cropPhotoBars } from "./artist-crop.js";
export const artistPhotoUrl = (profile, token) =>
  `/api/artist-photo/${profile.id}?token=${encodeURIComponent(token)}&v=${encodeURIComponent(profile.photoVersion || "")}`;
export function ArtistArtwork({ profile, token, className = "" }) {
  const url = artistPhotoUrl(profile, token),
    [failed, setFailed] = useState("");
  const [cropped, setCropped] = useState(null);
  return profile.hasPhoto && failed !== url ? (
    <img
      className={className}
      src={cropped?.url === url ? cropped.image : url}
      alt={`${profile.artist}的照片`}
      loading="lazy"
      onLoad={(event) => {
        if (cropped?.url === url) return;
        try {
          const image = cropPhotoBars(event.currentTarget);
          if (image) setCropped({ url, image });
        } catch {} // Keep the original when canvas access is unavailable.
      }}
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
