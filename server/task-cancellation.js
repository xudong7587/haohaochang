import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
const scope = new AsyncLocalStorage();
export const cancellableDownload = (job) =>
  ["download", "favorite-download"].includes(job.kind);
export function taskSignal() {
  return scope.getStore();
}
export function checkTaskCancellation() {
  taskSignal()?.throwIfAborted();
}
export function withTaskSignal(signal, action) {
  return scope.run(signal, action);
}
export function taskFetch(input, options = {}) {
  const signal = taskSignal();
  signal?.throwIfAborted();
  return fetch(input, {
    ...options,
    signal:
      signal && options.signal
        ? AbortSignal.any([signal, options.signal])
        : signal || options.signal,
  });
}
export function taskDelay(ms) {
  return delay(ms, undefined, { signal: taskSignal() });
}
