export const videoQualities = [
  "highest",
  "2160",
  "1440",
  "1080",
  "720",
  "480",
  "360",
];
export function videoQuality(value = "highest") {
  const quality = String(value);
  if (!videoQualities.includes(quality))
    throw Object.assign(new Error("请选择有效的视频清晰度"), { status: 400 });
  return quality;
}
export function videoFormat(value = "highest") {
  const quality = videoQuality(value);
  const filter = quality === "highest" ? "" : `[height<=${quality}]`;
  return `bv*${filter}+ba/b${filter}`;
}
export function qualityChoices(formats) {
  const heights = new Set(formats.map((v) => String(v.height)));
  return videoQualities
    .filter((v) => v === "highest" || heights.has(v))
    .map((value) => ({
      value,
      label: value === "highest" ? "最高画质（至少 720p）" : `${value}p`,
    }));
}
