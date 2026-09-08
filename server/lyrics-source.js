import { parseLyrics } from "../shared/lyrics.js";
import { recordingVersion } from "../shared/catalog.js";
import { localLyricsProvider } from "./providers/local-lyrics.js";
import { lrclibProvider } from "./providers/lrclib.js";

const normalize = (s) =>
  String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");

export function lyricsMatchReasons(row, query) {
  const reasons = [];
  if (normalize(row.title) !== normalize(query.title))
    reasons.push("title-mismatch");
  if (normalize(row.artist) !== normalize(query.artist))
    reasons.push("artist-mismatch");
  if (
    query.duration > 0 &&
    (!(row.duration > 0) || Math.abs(row.duration - query.duration) > 4)
  )
    reasons.push("duration-mismatch");
  const expected = normalize(
      recordingVersion(query.version) ||
        query.version ||
        recordingVersion(query.title),
    ),
    actual = normalize(
      recordingVersion(row.version) ||
        row.version ||
        recordingVersion(row.title),
    );
  if (expected !== actual) reasons.push("recording-version-mismatch");
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
      const reasons = lyricsMatchReasons(row, query);
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
    if (distinct.size > 1) {
      const error = new Error(
        "找到多个同名、同歌手、相近时长的歌词版本，请导入确认过的 LRC",
      );
      error.code = "LYRICS_AMBIGUOUS";
      error.candidates = matches.map(({ lyrics, ...row }) => row);
      throw error;
    }
    const row = matches[0];
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
      reviewReasons: ["recording-alignment-needs-review"],
    };
  }
  const error = new Error(
    "没有找到歌名、歌手、时长和版本匹配的 LRC，请手动补充",
  );
  error.code = "LYRICS_NOT_FOUND";
  error.diagnostics = diagnostics;
  throw error;
}
