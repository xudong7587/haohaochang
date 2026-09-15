import {
  checkProvider,
  runProviderJob,
  resumeCandidates,
  hasProviderCheckpoint,
} from "./protocol.js";
import { checkTaskCancellation } from "../task-cancellation.js";
import { validateResult } from "./validation.js";
import { waitingWorker } from "../clipping.js";
import { providerCandidates } from "./providers.js";

// F boundary: produce and validate a new accompaniment, without publishing a
// song or changing its current audio. A publishes the complete recording once.
export async function separateRecording(store, song, vocal, staging) {
  const ai = store.get("ai", {});
  if (!ai.enabled) throw waitingWorker("请启用自动整理与伴奏分离后重试更新");
  const candidates = resumeCandidates(store, song, providerCandidates(ai));
  let last;
  for (const candidate of candidates) {
    try {
      const health = await checkProvider(candidate, 3000);
      if (
        candidate.pc &&
        candidates.some((c) => !c.pc) &&
        health.busy &&
        !hasProviderCheckpoint(store, song, candidate)
      )
        throw new Error("PC 正在处理其他任务，转备用服务");
      const result = await runProviderJob(
        store,
        song,
        vocal,
        staging,
        candidate,
      );
      try {
        await validateResult(vocal, result.file);
      } catch (error) {
        store.set(result.checkpointKey, null);
        throw error;
      }
      return result;
    } catch (error) {
      checkTaskCancellation();
      last =
        candidate.pc &&
        (error.retryable ||
          ["TimeoutError", "AbortError"].includes(error.name) ||
          error instanceof TypeError)
          ? waitingWorker("等待 PC 恢复后继续分离新版本；旧歌曲保持可用")
          : error;
    }
  }
  throw last || waitingWorker("没有可用的分离服务，请检查自动整理设置");
}
