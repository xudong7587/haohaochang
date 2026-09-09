import { bilibiliProvider } from "./providers/bilibili.js";
import { findLyrics } from "./lyrics-source.js";

import { rankVideos } from "../shared/video-ranking.js";
export { rankVideos } from "../shared/video-ranking.js";
export async function searchSongs(
  title,
  artist,
  cookie,
  page = 1,
  { search = bilibiliProvider.search, lyrics = findLyrics } = {},
) {
  const [rows, reference] = await Promise.all([
    search(`${title} ${artist}`.trim(), cookie, fetch, page),
    artist ? lyrics(title, artist, 0).catch(() => null) : null,
  ]);
  const duration = reference?.recording?.duration || null;
  return {
    results: rankVideos(rows, duration),
    duration,
    durationSource: duration ? reference.source : null,
    page,
    hasMore: rows.length >= 20,
  };
}
