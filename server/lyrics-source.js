import { parseLyrics } from "../shared/lyrics.js";
import { localLyricsProvider } from "./providers/local-lyrics.js";
import { lrclibProvider } from "./providers/lrclib.js";
import { qqLyricsProvider } from "./providers/qq-lyrics.js";
import { neteaseLyricsProvider } from "./providers/netease-lyrics.js";
import { manualLyricsTitle } from "./providers/lyrics-http.js";
import { sameLyricsTitle, lyricsArtist } from "../shared/lyrics-identity.js";

export function lyricsMatchReasons(row, query) {
  const reasons = [];
  if (!sameLyricsTitle(row.title, query.title)) reasons.push("title-mismatch");
  if (lyricsArtist(row.artist) !== lyricsArtist(query.artist))
    reasons.push("artist-mismatch");
  if (
    query.duration > 0 &&
    row.duration > 0 &&
    Math.abs(row.duration - query.duration) > 120
  )
    reasons.push("duration-mismatch");
  if (!parseLyrics(row.lyrics || "").length)
    reasons.push("synced-lyrics-missing");
  return reasons;
}

// The fourth argument accepts the historical fetch function, or provider options.
// Local catalog configuration belongs to the operator, never a remote request path.
export async function findLyrics(title, artist, duration, options = {}) {
  if (typeof options === "function") options = { fetcher: options };
  const query = {
    title: String(title || "").trim(),
    artist: String(artist || "").trim(),
    duration: Number(duration) || 0,
    version: String(options.version || ""),
    manual: options.manual === true,
  };
  if (!query.title || !query.artist || query.artist === "未知歌手")
    throw new Error("请先确认歌名和实际演唱者");
  // Preserve the historical LRCLIB fetch injection and local-only test mode.
  const extended = !options.fetcher && options.lrclib !== false;
  let providers = options.providers || [
    ...(options.localIndex || process.env.KTV_LYRICS_INDEX
      ? [
          localLyricsProvider(
            options.localIndex || process.env.KTV_LYRICS_INDEX,
          ),
        ]
      : []),
    ...(extended && options.qqmusic !== false
      ? [qqLyricsProvider(options.qqFetcher || fetch)]
      : []),
    ...(extended && options.netease !== false
      ? [neteaseLyricsProvider(options.neteaseFetcher || fetch)]
      : []),
    ...(options.lrclib === false
      ? []
      : [lrclibProvider(options.fetcher || fetch)]),
  ];
  if (options.source && options.source !== "auto")
    providers = providers.filter((p) => p.id === options.source);
  const diagnostics = [];
  const alternatives = [];
  function resultFor(entries) {
    const distinct = new Map(
      entries.map(({ row, provider }) => [
        String(row.lyrics).trim(),
        { row, provider },
      ]),
    );
    const candidates = [...distinct.values()]
      .sort(
        (a, b) =>
          Number(lyricsArtist(b.row.artist) === lyricsArtist(query.artist)) -
            Number(lyricsArtist(a.row.artist) === lyricsArtist(query.artist)) ||
          Number(sameLyricsTitle(b.row.title, query.title)) -
            Number(sameLyricsTitle(a.row.title, query.title)) ||
          Math.abs((Number(a.row.duration) || 0) - query.duration) -
            Math.abs((Number(b.row.duration) || 0) - query.duration),
      )
      .slice(0, 12)
      .map(({ row, provider }) => {
        const reasons = lyricsMatchReasons(row, query);
        const warnings = [];
        if (reasons.includes("artist-mismatch"))
          warnings.push("演唱者不同，可能是翻唱或同名的另一首歌，请核对内容");
        if (reasons.includes("title-mismatch"))
          warnings.push("歌曲版本标注不同，请核对录音");
        if (reasons.includes("duration-mismatch"))
          warnings.push("歌词与视频时长相差超过两分钟，请试听核对");
        return {
          lyrics: row.lyrics,
          source: row.source || provider.id,
          sourceId: row.sourceId,
          sourceUrl: row.sourceUrl || "",
          provider: provider.id,
          recording: {
            title: row.title,
            artist: row.artist,
            duration: Number(row.duration) || null,
            version: row.version || "",
            album: row.album || row.evidence?.find((e) => e.album)?.album || "",
          },
          evidence: row.evidence || [],
          offsetUnit: "milliseconds",
          status: "candidate",
          reviewReasons: ["recording-alignment-needs-review", ...reasons],
          warning: warnings.join("；"),
        };
      });
    const first = candidates[0];
    return {
      ...first,
      candidateCount: candidates.length,
      selection: candidates.length > 1 ? "closest-duration" : "single-match",
      ...(options.manual
        ? {
            candidates,
            selectionRequired:
              candidates.length > 1 ||
              first.reviewReasons.some((r) =>
                ["artist-mismatch", "title-mismatch"].includes(r),
              ),
          }
        : {}),
    };
  }
  for (const provider of providers) {
    let rows;
    try {
      rows = await provider.search(query);
    } catch (error) {
      diagnostics.push({ provider: provider.id, error: error.message });
      continue;
    }
    const matches = rows.filter((row) => {
      const reasons = lyricsMatchReasons(row, query);
      if (
        options.manual &&
        manualLyricsTitle(row.title, query.title) &&
        !reasons.includes("synced-lyrics-missing")
      )
        return true;
      if (reasons.length)
        diagnostics.push({
          provider: provider.id,
          sourceId: row.sourceId,
          reasons,
        });
      return !reasons.length;
    });
    if (!matches.length) continue;
    const entries = matches.map((row) => ({ row, provider }));
    if (
      !options.manual ||
      matches.some(
        (row) => lyricsArtist(row.artist) === lyricsArtist(query.artist),
      )
    )
      return resultFor(entries);
    alternatives.push(...entries);
  }
  if (options.manual && alternatives.length) return resultFor(alternatives);
  const unavailable =
    providers.length > 0 &&
    diagnostics.filter((d) => d.error).length === providers.length;
  const error = new Error(
    unavailable
      ? "歌词来源暂时无法连接，请稍后重试，或导入本地 LRC。"
      : options.manual
        ? "当前歌词来源未找到带时间戳的候选；试试切换 QQ 音乐、网易云或 LRCLIB，也可导入本地 LRC。"
        : "没有找到歌名、歌手匹配且时长相差不超过两分钟的 LRC，请手动补充",
  );
  error.code = "LYRICS_NOT_FOUND";
  error.diagnostics = diagnostics;
  throw error;
}
