import { stat } from "node:fs/promises";
import { filesUnder, importKey } from "./library.js";
import { inside } from "./media-utils.js";
export function startBackgroundTasks({
  store,
  roots,
  downloads,
  cache,
  addJob,
  enabled,
}) {
  const { db, get } = store;
  let stopped = false;
  const favoritesTimer = setInterval(() => {
    const c = get("favorites", {});
    if (stopped || !enabled || !c.enabled) return;
    const recent = db
      .prepare(
        "SELECT created FROM jobs WHERE kind='favorite-sync' ORDER BY created DESC LIMIT 1",
      )
      .get();
    if (!recent || Date.now() - recent.created > c.intervalMinutes * 60000)
      addJob("favorite-sync", {});
  }, 30000);
  favoritesTimer.unref();
  let checking = false;
  const observed = new Map();
  const importer = setInterval(async () => {
    if (checking || stopped || !enabled || !get("autoImport", true)) return;
    checking = true;
    try {
      for (const file of await filesUnder(downloads)) {
        if (roots.some((root) => inside(root, file)) || inside(cache, file))
          continue;
        const info = await stat(file),
          signature = info.size + ":" + info.mtimeMs,
          previous = observed.get(file);
        observed.set(file, signature);
        if (previous !== signature || Date.now() - info.mtimeMs < 60000)
          continue;
        if (get(importKey(file, info))) continue;
        const handled = db
          .prepare("SELECT payload FROM jobs WHERE kind='import'")
          .all()
          .some((j) => {
            const p = JSON.parse(j.payload);
            return p.file === file && p.signature === signature;
          });
        if (!handled) addJob("import", { file, signature });
      }
    } catch (e) {
      console.error("下载目录检查失败:", e.message);
    } finally {
      checking = false;
    }
  }, 30000);
  importer.unref();
  return {
    stop() {
      stopped = true;
      clearInterval(importer);
      clearInterval(favoritesTimer);
    },
  };
}
