import { checkProvider, runProviderJob } from "./protocol.js";
import { validateResult } from "./validation.js";
import { waitingWorker } from "../clipping.js";

// F boundary: produce and validate a new accompaniment, without publishing a
// song or changing its current audio. A publishes the complete recording once.
export async function separateRecording(store, song, vocal, staging) {
  const ai = store.get("ai", {});
  if (!ai.enabled) throw waitingWorker("请启用 PC 整理与伴奏分离后重试更新");
  const candidates = [
    ai.pcEndpoint && {
      endpoint: ai.pcEndpoint,
      apiKey: ai.pcApiKey,
      model: ai.pcModel || "htdemucs",
      pc: true,
    },
    ai.endpoint && {
      endpoint: ai.endpoint,
      apiKey: ai.apiKey,
      model: ai.model,
    },
  ].filter(Boolean);
  let last;
  for (const candidate of candidates) {
    try {
      await checkProvider(candidate, 3000);
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
      last =
        candidate.pc &&
        (error.retryable ||
          ["TimeoutError", "AbortError"].includes(error.name) ||
          error instanceof TypeError)
          ? waitingWorker("等待 PC 恢复后继续分离新版本；旧歌曲保持可用")
          : error;
    }
  }
  throw last || waitingWorker("等待 PC 整理器连接后分离新版本");
}
