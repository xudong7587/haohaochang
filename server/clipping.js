import path from "node:path";
import { mkdir } from "node:fs/promises";
import { probe } from "./media-utils.js";
import { checkProvider, runProviderJob } from "./separation/protocol.js";

export const waitingWorker = (message = "等待局域网 PC 整理器上线") =>
  Object.assign(new Error(message), { code: "WAITING_WORKER" });
export function clipRange(input, duration) {
  if (!input) return null;
  if (
    typeof input !== "object" ||
    Array.isArray(input) ||
    ["start", "end"].some(
      (key) => input[key] != null && typeof input[key] !== "number",
    )
  )
    throw new Error("裁剪时间必须为秒数");
  const start = input.start == null ? 0 : Number(input.start),
    end = input.end == null ? duration : Number(input.end);
  if (
    ![start, end, duration].every(Number.isFinite) ||
    start < 0 ||
    end <= start ||
    end > duration + 0.1 ||
    duration > 21600
  )
    throw new Error("裁剪区间无效，请检查开始与结束时间");
  return { start, end: Math.min(end, duration) };
}
export async function clipOnPc(
  store,
  job,
  payload,
  file,
  downloads,
  videoOnly = false,
) {
  if (!payload.clip) return file;
  const source = await probe(file);
  const clip = clipRange(payload.clip, source.duration);
  const ai = store.get("ai", {});
  if (!ai.pcEndpoint) throw waitingWorker();
  const config = {
    endpoint: ai.pcEndpoint,
    apiKey: ai.pcApiKey,
    model: `${videoOnly ? "video" : "clip"}:${clip.start}:${clip.end}`,
  };
  let health;
  try {
    health = await checkProvider(config, 3000);
  } catch {
    throw waitingWorker();
  }
  if (!health.capabilities?.includes("video-clip-v1"))
    throw new Error("PC 整理器需要升级后才能裁剪视频");
  const staging = path.join(downloads, ".ktv-online", "clips", job.id);
  await mkdir(staging, { recursive: true });
  const target = path.join(staging, "clip.mp4");
  const valid = (info) =>
    info.hasVideo &&
    (videoOnly ? !info.audio.length : info.audio.length) &&
    (!source.height || info.height >= source.height) &&
    Math.abs(
      info.duration -
        ((videoOnly
          ? Math.min(clip.end, source.videoDuration || source.duration)
          : clip.end) -
          clip.start),
    ) < 0.5;
  try {
    if (valid(await probe(target))) return target;
  } catch {}
  let result;
  try {
    result = await runProviderJob(
      store,
      { id: job.id, title: payload.title, artist: payload.artist },
      file,
      staging,
      config,
      { clip, videoOnly, videoInfo: source },
    );
  } catch (error) {
    if (
      error.retryable ||
      ["TimeoutError", "AbortError"].includes(error.name) ||
      (error instanceof TypeError && /fetch/i.test(error.message))
    )
      throw waitingWorker("PC 连接中断，等待重新上线后继续裁剪");
    throw error;
  }
  if (!valid(await probe(result.file))) {
    store.set(result.checkpointKey, null);
    throw new Error("PC 裁剪结果时长或音视频轨道不匹配");
  }
  store.set(result.checkpointKey, null);
  return result.file;
}
