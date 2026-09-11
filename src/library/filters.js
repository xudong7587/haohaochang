export const resourceFilters = [
  ["lyrics", "缺少歌词"],
  ["poster", "缺少封面"],
  ["video", "缺少视频"],
];

export function videoResolution(row) {
  const video = row.videoInfo || row.manifest?.resources?.video;
  if (video?.available === false || row.manifest?.video === false)
    return "none";
  const height = Number(video?.height);
  if (!(height > 0)) return "unknown";
  return String(
    [2160, 1440, 1080, 720, 480, 360].find((h) => height >= h) || "low",
  );
}

export function matchesResourceFilters(row, missing, resolution) {
  return (
    missing.every((kind) => {
      if (kind === "lyrics") return !row.lyrics?.trim();
      if (kind === "poster") return !(row.hasPoster ?? !!row.poster);
      return videoResolution(row) === "none";
    }) &&
    (!resolution || videoResolution(row) === resolution)
  );
}
