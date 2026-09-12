export function parseLyrics(text = "") {
  const offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  const seconds = (m, s) => Number(m) * 60 + Number(s) - offset;
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const words = [
        ...line.matchAll(/<(\d+):(\d{1,2}(?:\.\d+)?)>([^<]*)/g),
      ].map((m) => ({ time: seconds(m[1], m[2]), text: m[3] }));
      const plain = line.replace(/\[[^\]]+\]|<[^>]+>/g, "").trim();
      if (!plain) return [];
      return [...line.matchAll(/\[(\d+):(\d{1,2}(?:\.\d+)?)\]/g)].map((m) => ({
        time: seconds(m[1], m[2]),
        text: plain,
        words,
      }));
    })
    .sort((a, b) => a.time - b.time);
}
export const progress = (time, start, end) =>
  end > start
    ? Math.max(0, Math.min(100, ((time - start) / (end - start)) * 100))
    : time >= start
      ? 100
      : 0;

// Presentation offsets are independent of resource/metadata revisions.
export const clampLyricsOffset = (value) => {
  const offset = Number(value);
  return Number.isFinite(offset)
    ? Math.max(
        -Number.MAX_SAFE_INTEGER,
        Math.min(Number.MAX_SAFE_INTEGER, Math.round(offset)),
      )
    : 0;
};
export function lyricFrame(lines, clock, duration) {
  const index = lines.reduce(
    (found, line, i) => (line.time <= clock ? i : found),
    -1,
  );
  const active = Math.max(0, index),
    line = lines[active];
  const remaining = index < 0 && line ? Math.max(0, line.time - clock) : 0;
  return {
    index,
    line,
    next: lines[active + 1],
    end: lines[active + 1]?.time ?? duration,
    countdown: index < 0 ? Math.min(4, Math.ceil(remaining)) : 0,
  };
}
