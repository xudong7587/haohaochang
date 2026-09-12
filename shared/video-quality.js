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
      label: value === "highest" ? "最高可用画质" : `${value}p`,
    }));
}
export function previewDownloadHeight(preview, value) {
  const quality = videoQuality(value);
  const limit = quality === "highest" ? Infinity : Number(quality);
  const heights = (preview.qualities || []).map((item) => Number(item.value));
  if (preview.downloadHeight) heights.push(preview.downloadHeight);
  return Math.max(
    0,
    ...heights.filter((height) => height > 0 && height <= limit),
  );
}
