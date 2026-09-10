import { setTimeout as delay } from "node:timers/promises";
import { pinyin } from "pinyin-pro";
import { bilibiliProvider } from "./providers/bilibili.js";

const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
const sameName = (a, b) =>
  normalize(a) === normalize(b) ||
  (/\p{Script=Han}/u.test(a) &&
    /\p{Script=Han}/u.test(b) &&
    normalize(pinyin(a, { toneType: "symbol" })) ===
      normalize(pinyin(b, { toneType: "symbol" })));
export function matchAlbumTrack(row, song) {
  return (
    !!row.trackName &&
    !!row.artistName &&
    sameName(row.trackName, song.title) &&
    sameName(row.artistName, song.artist) &&
    (!(song.duration > 0 && row.trackTimeMillis > 0) ||
      Math.abs(song.duration - row.trackTimeMillis / 1000) <= 120)
  );
}
const imageHosts = ["hdslb.com", "biliimg.com", "mzstatic.com"];
export function allowedPosterUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("封面地址无效");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !imageHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith("." + host),
    )
  )
    throw new Error("封面地址不属于受支持的图片来源");
  return url;
}
async function readLimited(response, limit) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`封面来源返回 HTTP ${response.status}`);
  }
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("封面响应过大");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error("封面响应过大");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function downloadPoster(
  url,
  { fetcher = fetch, signal = AbortSignal.timeout(15000) } = {},
) {
  for (let redirects = 0; redirects < 4; redirects++) {
    const target = allowedPosterUrl(url);
    const response = await fetcher(target, {
      signal,
      redirect: "manual",
      headers: {
        "User-Agent":
          "Haohaochang/0.3 (https://github.com/xudong7587/haohaochang)",
        ...(target.hostname.endsWith(".hdslb.com") ||
        target.hostname.endsWith(".biliimg.com")
          ? { Referer: "https://www.bilibili.com/" }
          : {}),
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) throw new Error("封面重定向地址缺失");
      url = new URL(next, target).href;
      continue;
    }
    const data = await readLimited(response, 8 * 1024 * 1024);
    const jpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    const png = data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp =
      data.toString("ascii", 0, 4) === "RIFF" &&
      data.toString("ascii", 8, 12) === "WEBP";
    if (!jpeg && !png && !webp)
      throw new Error("封面不是有效的 JPEG、PNG 或 WebP 图片");
    return data;
  }
  throw new Error("封面来源重定向次数过多");
}
let nextSearch = 0;
async function paceSearch() {
  const now = Date.now(),
    start = Math.max(now, nextSearch);
  nextSearch = start + 3200;
  if (start > now) await delay(start - now);
}
const searches = new Map();
async function searchMusic(term, { fetcher, throttle, entity = "song" }) {
  const key = entity + ":" + term.toLowerCase();
  if (
    fetcher === fetch &&
    searches.has(key) &&
    searches.get(key).expires > Date.now()
  )
    return searches.get(key).rows;
  await throttle();
  const url = new URL("https://itunes.apple.com/search");
  url.search = new URLSearchParams({
    term,
    media: "music",
    entity,
    country: "TW",
    limit: "50",
  });
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(12000),
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  const body = JSON.parse(
    (await readLimited(response, 2 * 1024 * 1024)).toString("utf8"),
  );
  const rows = Array.isArray(body.results) ? body.results : [];
  if (fetcher === fetch) {
    searches.set(key, { rows, expires: Date.now() + 24 * 3600000 });
    if (searches.size > 500) searches.delete(searches.keys().next().value);
  }
  return rows;
}
const artistPictures = new Map();
function artworkSource(row, artistFallback = false) {
  const artwork = allowedPosterUrl(row.artworkUrl100);
  artwork.pathname = artwork.pathname.replace(/\/100x100bb\./, "/600x600bb.");
  const sourceUrl = String(row.collectionViewUrl || row.trackViewUrl || "");
  return {
    provider: artistFallback ? "itunes-artist" : "itunes",
    source: artistFallback ? "歌手专辑图片" : "iTunes 专辑封面",
    ...(artistFallback ? { fallback: "artist" } : {}),
    imageUrl: artwork.href,
    fallbackImageUrl: row.artworkUrl100,
    sourceUrl: /^https:\/\/(music\.apple\.com|itunes\.apple\.com)\//.test(
      sourceUrl,
    )
      ? sourceUrl
      : "",
    album: row.collectionName || "",
    title: artistFallback ? row.artistName : row.trackName,
    artist: row.artistName,
  };
}
export async function findArtistPoster(
  artist,
  { fetcher = fetch, throttle = paceSearch, random = Math.random } = {},
) {
  if (!artist || artist === "未知歌手") return null;
  const key = normalize(artist),
    cached = artistPictures.get(key);
  if (fetcher === fetch && cached?.expires > Date.now()) return cached.result;
  const lookup = async () => {
    // Public artist pages provide a portrait independent of any particular song.
    try {
      const rows = await searchMusic(artist, {
        fetcher,
        throttle,
        entity: "musicArtist",
      });
      for (const row of rows
        .filter(
          (row) =>
            sameName(row.artistName || "", artist) &&
            /^\d+$/.test(String(row.artistId)),
        )
        .slice(0, 3)) {
        try {
          const sourceUrl = `https://music.apple.com/cn/artist/${encodeURIComponent(row.artistName)}/${row.artistId}`;
          const response = await fetcher(sourceUrl, {
            signal: AbortSignal.timeout(12000),
            redirect: "error",
          });
          const html = (await readLimited(response, 3 * 1024 * 1024)).toString(
            "utf8",
          );
          const tag = html.match(
            /<meta\b[^>]*\bproperty=["']og:image["'][^>]*>/i,
          )?.[0];
          const value = tag
            ?.match(/\bcontent=["']([^"']+)["']/i)?.[1]
            ?.replaceAll("&amp;", "&");
          if (!value) continue;
          const image = allowedPosterUrl(value);
          if (!image.hostname.endsWith(".mzstatic.com")) continue;
          // Request the square portrait, rather than Apple's padded share card.
          const original = image.href;
          image.pathname = image.pathname.replace(
            /\/\d+x\d+cw\.[^/]+$/,
            "/600x600bb.jpg",
          );
          return {
            provider: "apple-artist",
            source: "歌手照片",
            fallback: "artist",
            artist: row.artistName,
            title: row.artistName,
            album: "",
            imageUrl: image.href,
            fallbackImageUrl: original,
            sourceUrl,
          };
        } catch {
          /* Try another exact-name artist or the artist's artwork. */
        }
      }
    } catch {
      /* Artist search may be unavailable while song search still works. */
    }
    const rows = await searchMusic(artist, { fetcher, throttle });
    const unique = new Map();
    for (const row of rows) {
      if (!row.artworkUrl100 || !sameName(row.artistName || "", artist))
        continue;
      try {
        const source = artworkSource(row, true);
        unique.set(source.imageUrl, source);
      } catch {}
    }
    const candidates = [...unique.values()];
    if (candidates.length)
      return candidates[
        Math.min(
          candidates.length - 1,
          Math.floor(random() * candidates.length),
        )
      ];
    // Duet metadata may list several performers; any named performer is a valid fallback.
    let performers = artist.split(
      /\s*[、,，&＆;+＋/]\s*|\s+(?:feat\.?|ft\.?)\s+/i,
    );
    if (performers.length === 1) {
      const names = artist.trim().split(/\s+/);
      if (
        names.length > 1 &&
        names.every((name) => /^[\p{Script=Han}·]{2,}$/u.test(name))
      )
        performers = names;
    }
    if (performers.length > 1) {
      for (const name of [
        ...new Set(performers.map((name) => name.trim()).filter(Boolean)),
      ].slice(0, 4)) {
        if (normalize(name) === key) continue;
        const result = await findArtistPoster(name, {
          fetcher,
          throttle,
          random,
        });
        if (result) return { ...result, requestedArtist: artist };
      }
    }
    return null;
  };
  const result = lookup().catch(() => null);
  if (fetcher === fetch) {
    artistPictures.set(key, { result, expires: Date.now() + 24 * 3600000 });
    if (artistPictures.size > 500)
      artistPictures.delete(artistPictures.keys().next().value);
  }
  return result;
}
export async function findPoster(
  song,
  {
    source = {},
    sourceUrl = "",
    cookie = "",
    fetcher = fetch,
    throttle = paceSearch,
    random = Math.random,
  } = {},
) {
  const url = source.canonicalUrl || source.url || sourceUrl;
  if (url && /^https:\/\/(www\.)?bilibili\.com\//i.test(url)) {
    try {
      const cover =
        source.cover ||
        (await bilibiliProvider.metadata(url, cookie, fetcher)).cover;
      if (!cover) throw new Error("B站未返回此视频的封面");
      allowedPosterUrl(cover);
      return {
        provider: "bilibili",
        source: "B站视频封面",
        imageUrl: cover,
        sourceUrl: url,
        title: source.externalTitle || song.title,
        album: "",
      };
    } catch {
      /* Continue to album matching and the artist fallback. */
    }
  }
  if (!song.title || !song.artist || song.artist === "未知歌手")
    throw new Error("请先确认歌名和歌手，再查找专辑封面");
  for (const term of [`${song.title} ${song.artist}`, song.title]) {
    let rows;
    try {
      rows = await searchMusic(term, { fetcher, throttle });
    } catch {
      continue;
    }
    const match = rows
      .filter((row) => row.artworkUrl100 && matchAlbumTrack(row, song))
      .sort((a, b) => {
        if (song.duration > 0)
          return (
            Math.abs(a.trackTimeMillis / 1000 - song.duration) -
            Math.abs(b.trackTimeMillis / 1000 - song.duration)
          );
        return String(a.releaseDate || "").localeCompare(
          String(b.releaseDate || ""),
        );
      })[0];
    if (match) {
      try {
        return artworkSource(match);
      } catch {
        /* Invalid artwork can still use an artist picture. */
      }
    }
  }
  const artist = await findArtistPoster(song.artist, {
    fetcher,
    throttle,
    random,
  });
  if (artist) return artist;
  throw new Error("没有找到歌曲封面或对应歌手的图片，原封面已保留");
}
