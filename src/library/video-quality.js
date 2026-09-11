export function videoQuality(row) {
  const video = row.videoInfo || row.manifest?.resources?.video;
  if (video?.available === false || (!video && row.manifest?.video === false))
    return "无视频";
  const height = Number(video?.height);
  if (height > 0) return `${Math.round(height)}p`;
  return "分辨率待识别";
}
