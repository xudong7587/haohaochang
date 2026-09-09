import { run } from "./process.js";

// Ephemeral progress is cheap to update and never rewrites persistent settings.
const stores = new WeakMap();
export function taskProgress(store, id, value) {
  if (arguments.length === 3) {
    if (!stores.has(store)) stores.set(store, new Map());
    if (value) stores.get(store).set(id, value);
    else stores.get(store).delete(id);
  }
  return stores.get(store)?.get(id) || null;
}
export async function runWithProgress(args, duration, report) {
  let buffer = "";
  report(0);
  await run(
    process.env.FFMPEG || "ffmpeg",
    ["-nostats", "-progress", "pipe:1", ...args],
    3600000,
    8 * 1024 * 1024,
    (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const match = /^out_time_us=(\d+)/.exec(line);
        if (match && duration > 0)
          report(
            Math.min(
              99,
              Math.max(0, Math.floor(Number(match[1]) / 10000 / duration)),
            ),
          );
      }
    },
  );
  report(100);
}
