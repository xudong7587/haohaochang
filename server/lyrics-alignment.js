import { parseLyrics } from "../shared/lyrics.js";
import { stageResources } from "./resource-publication.js";
import { savePackageInfo } from "./song-package.js";
import { currentSong } from "./song-writes.js";

const normalized = (value) =>
  String(value || "")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .toLowerCase();
export function alignLyrics(
  lyrics,
  activity,
  { title, artist, duration } = {},
) {
  if (
    activity?.version !== 1 ||
    !Array.isArray(activity.onsets) ||
    activity.onsets.length > 1000 ||
    !Number.isFinite(activity.duration) ||
    Math.abs(activity.duration - duration) > 1
  )
    return null;
  const onsets = activity.onsets;
  if (
    onsets.some(
      (n, i) =>
        !Number.isFinite(n) ||
        n < 0 ||
        n > duration ||
        (i && n <= onsets[i - 1]),
    )
  )
    return null;
  const lines = parseLyrics(lyrics).filter(
    (line) =>
      !/作词|作曲|编曲|制作人|词曲|出品|发行|录音|混音|母带|音乐监制|版权所有|未经许可/.test(
        line.text,
      ) &&
      ![
        normalized(title),
        normalized(artist),
        normalized(title + artist),
      ].includes(normalized(line.text)),
  );
  const first = lines[0];
  if (!first || lines.length < 3 || onsets.length < 3 || onsets[0] < 2)
    return null;
  const shift = Math.round((onsets[0] - first.time) * 1000) / 1000;
  if (Math.abs(shift) < 0.5 || Math.abs(shift) > 30) return null;
  const leading = lines.slice(0, 5);
  const nearby = leading.map(
    (line) =>
      onsets
        .map((onset, index) => ({
          index,
          error: Math.abs(onset - line.time - shift),
        }))
        .sort((a, b) => a.error - b.error)[0],
  );
  const matches = nearby.filter((v) => v?.error <= 0.8);
  // Three distinct line starts must support the same translation; one onset is insufficient.
  if (
    new Set(matches.map((v) => v.index)).size < 3 ||
    matches.length / leading.length < 0.8
  )
    return null;
  if (
    lines.some(
      (line) => line.time + shift < 0 || line.time + shift > duration + 1,
    )
  )
    return null;
  const translated = lyrics.replace(
    /([\[<])(\d+):(\d{1,2}(?:\.\d+)?)([\]>])/g,
    (match, open, minutes, seconds, close) => {
      if ((open === "[" && close !== "]") || (open === "<" && close !== ">"))
        return match;
      const ms = Math.max(
        0,
        Math.round((Number(minutes) * 60 + Number(seconds) + shift) * 1000),
      );
      return `${open}${String(Math.floor(ms / 60000)).padStart(2, "0")}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}${close}`;
    },
  );
  return {
    lyrics: translated,
    shiftMs: Math.round(shift * 1000),
    firstVocal: onsets[0],
    firstLyric: first.time,
    matchedLines: matches.length,
  };
}

export async function autoAlignLyrics(store, id, cache, activity) {
  const song = currentSong(store, id);
  if (
    !song.lyrics ||
    store.get("lyrics-auto:" + id) ||
    store.get("lyrics-offset:" + id, 0)
  )
    return false;
  const source = store.get("lyrics-match:" + id, {});
  if (source.provider === "manual" || /手动|本地导入/.test(source.source || ""))
    return false;
  const result = alignLyrics(song.lyrics, activity, song);
  if (!result) return false;
  const stage = await stageResources(store, song, cache, {
    phase: "lyrics-align",
  });
  try {
    stage.store.set("lyrics-auto:" + id, {
      ...result,
      original: song.lyrics,
      created: Date.now(),
    });
    await savePackageInfo(
      stage.store,
      {
        ...song,
        lyrics: result.lyrics,
        metadataRevision: song.metadataRevision + 1,
        resourceRevision: song.resourceRevision + 1,
      },
      cache,
    );
    await stage.publish({ lyrics: result.lyrics });
    return true;
  } catch (error) {
    await stage.abandon();
    throw error;
  }
}
