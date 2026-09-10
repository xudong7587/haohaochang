import {
  lyricsTitle,
  sameLyricsTitle,
  lyricsArtist,
  normalizeLyricsIdentity,
} from "../../shared/lyrics-identity.js";

export async function lyricsJson(fetcher, url, options = {}) {
  const response = await fetcher(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`歌词服务返回 HTTP ${response.status}`);
  }
  const limit = 2 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("歌词响应过大");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error("歌词响应过大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function manualLyricsTitle(a, b) {
  if (sameLyricsTitle(a, b)) return true;
  const key = (s) =>
    normalizeLyricsIdentity(
      lyricsTitle(s).replace(/\s*[（(\[【][^）)\]】]+[）)\]】]\s*$/u, ""),
    );
  return !!key(a) && key(a) === key(b);
}
export function rankLyricsTracks(rows, query) {
  return rows
    .filter(
      (row) =>
        (query.manual
          ? manualLyricsTitle(row.title, query.title)
          : sameLyricsTitle(row.title, query.title)) &&
        (query.manual ||
          lyricsArtist(row.artist) === lyricsArtist(query.artist)),
    )
    .sort(
      (a, b) =>
        Number(lyricsArtist(b.artist) === lyricsArtist(query.artist)) -
          Number(lyricsArtist(a.artist) === lyricsArtist(query.artist)) ||
        Math.abs((a.duration || 0) - query.duration) -
          Math.abs((b.duration || 0) - query.duration),
    )
    .slice(0, 6);
}
export function decodeLyricEntities(text) {
  return String(text || "")
    .replace(/&#(x[\da-f]+|\d+);/gi, (all, code) => {
      const n =
        code[0].toLowerCase() === "x"
          ? parseInt(code.slice(1), 16)
          : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    })
    .replace(
      /&(?:amp|lt|gt|quot|apos);/g,
      (s) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
        })[s],
    );
}
