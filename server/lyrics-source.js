import { parseLyrics } from "../shared/lyrics.js";
import { localLyricsProvider } from "./providers/local-lyrics.js";
import { lrclibProvider } from "./providers/lrclib.js";
import { sameLyricsTitle, lyricsArtist } from "../shared/lyrics-identity.js";

const normalize = (s) =>
  String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");

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
  };
  if (!query.title || !query.artist || query.artist === "未知歌手")
    throw new Error("请先确认歌名和实际演唱者");
  const providers = options.providers || [
    ...(options.localIndex || process.env.KTV_LYRICS_INDEX
      ? [
          localLyricsProvider(
            options.localIndex || process.env.KTV_LYRICS_INDEX,
          ),
        ]
      : []),
    ...(options.lrclib === false
      ? []
      : [lrclibProvider(options.fetcher || fetch)]),
  ];
  const diagnostics = [];
  for (const provider of providers) {
    let rows;
    try {
      rows = await provider.search(query);
    } catch (error) {
      diagnostics.push({ provider: provider.id, error: error.message });
      continue;
    }
    const matches = rows.filter((row) => {
      const reasons = lyricsMatchReasons(row, query).filter(
        (reason) => !(options.manual && reason === "duration-mismatch"),
      );
      if (reasons.length)
        diagnostics.push({
          provider: provider.id,
          sourceId: row.sourceId,
          reasons,
        });
      return !reasons.length;
    });
    if (!matches.length) continue;
    const distinct = new Map(
      matches.map((row) => [String(row.lyrics).trim(), row]),
    );
    const candidates = [...distinct.values()].sort(
      (a, b) =>
        Math.abs((Number(a.duration) || 0) - query.duration) -
        Math.abs((Number(b.duration) || 0) - query.duration),
    );
    const row = candidates[0];
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
      },
      evidence: row.evidence || [],
      offsetUnit: "milliseconds",
      status: "candidate",
      candidateCount: candidates.length,
      selection: candidates.length > 1 ? "closest-duration" : "single-match",
      reviewReasons: [
        "recording-alignment-needs-review",
        ...lyricsMatchReasons(row, query),
      ],
      warning: lyricsMatchReasons(row, query).includes("duration-mismatch")
        ? "歌词与视频时长相差超过两分钟，已作为候选载入，请先试听核对。"
        : "",
    };
  }
  const unavailable =
    providers.length > 0 &&
    diagnostics.filter((d) => d.error).length === providers.length;
  const error = new Error(
    unavailable
      ? "歌词来源暂时无法连接，请稍后重试，或导入本地 LRC。"
      : options.manual
        ? "没有找到同歌名、同演唱者且带时间戳的 LRC；可导入本地歌词或修改搜索信息。"
        : "没有找到歌名、歌手匹配且时长相差不超过两分钟的 LRC，请手动补充",
  );
  error.code = "LYRICS_NOT_FOUND";
  error.diagnostics = diagnostics;
  throw error;
}
