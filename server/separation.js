// NAS orchestration only: provider transport and validation live behind the adapter.
import { packageDir, publishBacking, present } from "./song-package.js";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { inspectPackage } from "./resource-health.js";
import { waitingWorker } from "./clipping.js";
import {
  checkProvider,
  runProviderJob,
  hasProviderCheckpoint,
} from "./separation/protocol.js";
import { validateResult } from "./separation/validation.js";
export { providerConfig } from "./separation/config.js";
export { testProvider } from "./separation/protocol.js";

const pcActive = new Map();
export async function separateSong(store, song, cache) {
  const config = store.get("ai", {});
  if (!config.enabled) return false;
  if (
    song.mode === "separated" &&
    (await inspectPackage(store, song, await packageDir(store, song, cache)))
      .backing.available
  )
    return true;
  const pc = config.pcEndpoint
    ? {
        endpoint: config.pcEndpoint,
        model: config.pcModel || "htdemucs",
        apiKey: config.pcApiKey,
        pc: true,
      }
    : null;
  const cloud = config.endpoint
    ? { endpoint: config.endpoint, model: config.model, apiKey: config.apiKey }
    : null;
  const resumingPc = pc && hasProviderCheckpoint(store, song, pc);
  const candidates = [pc, cloud].filter(Boolean);
  let last;
  for (const candidate of candidates) {
    let reserved = false;
    try {
      if (candidate.pc) {
        let health;
        try {
          health = await checkProvider(candidate, 3000);
        } catch (error) {
          if (!cloud) throw waitingWorker();
          throw error;
        }
        // Existing v1 adapters need not advertise load; local concurrency still applies.
        if (
          cloud &&
          !resumingPc &&
          (health.busy === true ||
            Number(health.pending) >= (Number(health.concurrency) || 1) ||
            (pcActive.get(candidate.endpoint) || 0) >=
              (Number(health.concurrency) || 1))
        )
          throw new Error("PC 分离服务忙碌，转备用服务");
        pcActive.set(
          candidate.endpoint,
          (pcActive.get(candidate.endpoint) || 0) + 1,
        );
        reserved = true;
      }
      const root = path.join(cache, "separation-tasks");
      await mkdir(root, { recursive: true });
      const staging = await mkdtemp(path.join(root, "task-"));
      try {
        const vocal = path.join(
          await packageDir(store, song, cache),
          "原唱.m4a",
        );
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
        await publishBacking(store, song, cache, result.file);
        store.db
          .prepare(
            "UPDATE songs SET mode='separated',status='ready',error='' WHERE id=?",
          )
          .run(song.id);
        store.set(result.checkpointKey, null);
        return true;
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    } catch (error) {
      last =
        candidate.pc &&
        !cloud &&
        (error.retryable ||
          ["TimeoutError", "AbortError"].includes(error.name) ||
          (error instanceof TypeError && /fetch/i.test(error.message)))
          ? waitingWorker("PC 连接中断，等待重新上线后继续原任务")
          : error;
    } finally {
      if (reserved)
        pcActive.set(
          candidate.endpoint,
          Math.max(0, pcActive.get(candidate.endpoint) - 1),
        );
    }
  }
  throw (
    last ||
    (config.autoDiscover !== false
      ? waitingWorker()
      : new Error("没有可用的分离服务"))
  );
}
