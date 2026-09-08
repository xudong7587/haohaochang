// Render a reusable video from real audio. No browser analyser or AI request is needed.
export function audioVisualArgs(
  file,
  cover,
  duration,
  track = 0,
  channel = null,
) {
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("无法读取音频时长");
  const args = ["-y", "-v", "error", "-i", file];
  const images = (Array.isArray(cover) ? cover : cover ? [cover] : []).slice(
    0,
    5,
  );
  if (images.length)
    for (const image of images)
      args.push("-loop", "1", "-framerate", "20", "-i", image);
  else args.push("-f", "lavfi", "-i", "color=c=0x211d31:s=1280x720:r=20");
  const audio =
    channel === null ? "anull" : `pan=stereo|c0=c${channel}|c1=c${channel}`;
  const filters = [
    `[0:a:${track}]${audio},asplit=2[aout][s]`,
    `[s]showfreqs=s=1100x190:mode=bar:ascale=sqrt:fscale=log:win_size=2048:rate=20:colors=0xbda4ff[spectrum]`,
  ];
  const count = Math.max(1, images.length);
  for (let n = 0; n < count; n++)
    filters.push(
      `[${n + 1}:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,eq=brightness='-0.10+0.025*sin(t/5)':eval=frame[image${n}]`,
    );
  let background = "image0";
  for (let n = 1; n < count; n++) {
    filters.push(
      `[${background}][image${n}]overlay=enable='eq(floor(mod(t,${count * 12})/12),${n})'[cycle${n}]`,
    );
    background = "cycle" + n;
  }
  filters.push(
    `[${background}][spectrum]overlay=90:290:shortest=1,format=yuv420p[v]`,
  );
  const filter = filters.join(";");
  return [
    ...args,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    String(duration),
    "-shortest",
  ];
}
