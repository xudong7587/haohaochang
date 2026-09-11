import { probe } from "./media-utils.js";
import { stat } from "node:fs/promises";
import { waitingWorker } from "./clipping.js";
import { checkProvider, runProviderJob } from "./separation/protocol.js";

export async function prepareVideoOnPc(store, song, file, staging) {
  const ai = store.get("ai", {});
  if (!ai.pcEndpoint) return null;
  const info = await probe(file);
  if (!(info.duration > 0) || info.duration > 21600) return null;
  const config = {
    endpoint: ai.pcEndpoint,
    apiKey: ai.pcApiKey,
    model: `video:0:${info.duration}:${info.colorTransfer || "sdr"}`,
  };
  let health;
  try {
    health = await checkProvider(config, 3000);
  } catch {
    throw waitingWorker("等待 PC 上线后转换画面");
  }
  // Older organizers retain the previous NAS path until the PC is upgraded.
  if (!health.capabilities?.includes("video-prepare-v1")) return null;
  const maxVideoBytes = Number(health.max_video_upload_bytes) || 1024 ** 3;
  if ((await stat(file)).size > maxVideoBytes)
    throw waitingWorker("请更新 PC 整理器以处理超过 1 GB 的高清画面");
  if (
    ["smpte2084", "arib-std-b67"].includes(info.colorTransfer) &&
    !health.capabilities?.includes("video-prepare-v2")
  )
    throw waitingWorker("请更新 PC 整理器以正确处理 HDR 兼容转换");
  let result;
  try {
    result = await runProviderJob(store, song, file, staging, config, {
      clip: { start: 0, end: info.duration },
      videoOnly: true,
      videoInfo: info,
      maxVideoBytes,
    });
  } catch (error) {
    if (
      error.retryable ||
      ["TimeoutError", "AbortError"].includes(error.name) ||
      error instanceof TypeError
    )
      throw waitingWorker("PC 画面转换连接中断，等待恢复后继续原任务");
    throw error;
  }
  const output = await probe(result.file);
  if (
    !output.hasVideo ||
    output.videoCodec !== "h264" ||
    !["yuv420p", "yuvj420p"].includes(output.pixelFormat) ||
    output.audio.length ||
    output.height < info.height ||
    output.width < info.width ||
    (info.videoFps > 0 && output.videoFps + 0.1 < info.videoFps) ||
    Math.abs(output.duration - (info.videoDuration || info.duration)) > 0.5
  ) {
    store.set(result.checkpointKey, null);
    throw new Error(
      `PC 画面校验失败：输入 ${info.width}×${info.height}，画面 ${(info.videoDuration || info.duration).toFixed(3)}秒 / 容器 ${info.duration.toFixed(3)}秒；输出 ${output.width}×${output.height} ${output.videoCodec}/${output.pixelFormat} ${output.duration.toFixed(3)}秒，音轨${output.audio.length}。旧资源保持可用`,
    );
  }
  return result;
}
