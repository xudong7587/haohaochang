import { cleanResourceVersions } from "./resource-cleanup.js";
import { cleanImportedDownloads } from "./download-cleanup.js";

// A periodic check is still needed for resources pinned by playback or jobs.
// Read-only checks must not create an endless history of empty cleanup jobs.
export async function scheduleResourceCleanup({
  store,
  cache,
  downloads,
  addJob,
  legacyCache,
  isPlaying,
  stopped = () => false,
}) {
  const pending = () =>
    store.db
      .prepare(
        "SELECT id FROM jobs WHERE kind='resource-cleanup' AND status IN ('queued','running','waiting-worker','review') LIMIT 1",
      )
      .get();
  if (stopped() || pending()) return false;
  const resources = await cleanResourceVersions(store, cache, {
    dryRun: true,
    legacyCache,
    isPlaying,
  });
  const imports = await cleanImportedDownloads(store, downloads, {
    dryRun: true,
  });
  if (stopped() || pending()) return false;
  if (!resources.removed && !resources.files && !imports.removed) return false;
  addJob("resource-cleanup", {});
  return true;
}
