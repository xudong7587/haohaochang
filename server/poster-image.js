import { run } from "./process.js";

// Convert on the NAS. The second, opaque white stream avoids FFmpeg 5.1's
// packed-RGBA drawbox replace bug, while preserving transparent image edges.
export async function savePosterImage(input, output, { crop = true } = {}) {
  const size = crop
    ? "scale=w='min(1200,min(iw,ih))':h='min(1200,min(iw,ih))':force_original_aspect_ratio=increase:force_divisible_by=2:flags=lanczos,crop=w='min(iw,ih)':h='min(iw,ih)'"
    : "scale=w='min(1600,iw)':h='min(1600,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos";
  await run(
    process.env.FFMPEG || "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-max_pixels",
      "40000000",
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      size +
        ",format=rgba,split[fg][bg];[bg]lutrgb=r=255:g=255:b=255,format=rgb24[base];[base][fg]overlay=shortest=1:format=auto,format=yuvj444p",
      "-map_metadata",
      "-1",
      "-q:v",
      "2",
      output,
    ],
    30000,
  );
}
