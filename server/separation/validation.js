import { probe } from "../media-utils.js";
import { run } from "../process.js";

// Check actual decoded stream metadata before any encoding can pad/truncate it.
export async function validateResult(vocal, result) {
  const [source, output] = await Promise.all([probe(vocal), probe(result)]);
  if (
    source.audio.length !== 1 ||
    !Number.isFinite(source.duration) ||
    source.duration <= 0
  )
    throw new Error("待分离原唱音轨或时长无效");
  if (
    output.hasVideo ||
    output.audio.length !== 1 ||
    !output.audio[0].channels ||
    !Number.isFinite(output.duration) ||
    output.duration <= 0
  )
    throw new Error("分离结果必须包含一条有效音轨且没有视频");
  const tolerance = Math.max(0.25, Math.min(1, source.duration * 0.005));
  if (Math.abs(source.duration - output.duration) > tolerance)
    throw new Error(
      `分离结果时长不匹配（原唱 ${source.duration.toFixed(2)} 秒，伴奏 ${output.duration.toFixed(2)} 秒），已保留原资源`,
    );
  // ffprobe may read a valid header from an incomplete file; require a full decode.
  await run(
    process.env.FFMPEG || "ffmpeg",
    [
      "-v",
      "error",
      "-xerror",
      "-i",
      result,
      "-map",
      "0:a:0",
      "-f",
      "null",
      "-",
    ],
    600000,
  );
  return output;
}
