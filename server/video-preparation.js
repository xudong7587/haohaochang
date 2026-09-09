import { probe } from "./media-utils.js";
import { waitingWorker } from "./clipping.js";
import { checkProvider, runProviderJob } from "./separation/protocol.js";

export async function prepareVideoOnPc(store, song, file, staging) {
  const ai = store.get("ai", {});
  if (!ai.pcEndpoint) return null;
  const info = await probe(file);
  const config = {
    endpoint: ai.pcEndpoint,
    apiKey: ai.pcApiKey,
    model: `video:0:${info.duration}`,
  };
  let health;
  try {
    health = await checkProvider(config, 3000);
  } catch {
    throw waitingWorker("等待 PC 上线后转换画面");
  }
  // Older organizers retain the previous NAS path until the PC is upgraded.
  if (!health.capabilities?.includes("video-prepare-v1")) return null;
  let result;
  try {
    result = await runProviderJob(store, song, file, staging, config, {
      clip: { start: 0, end: info.duration },
      videoOnly: true,
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
    Math.abs(output.duration - info.duration) > 0.5
  ) {
    store.set(result.checkpointKey, null);
    throw new Error("PC 画面结果的轨道、编码或时长不匹配，旧资源保持可用");
  }
  return result;
}
