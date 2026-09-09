import { prepareSong } from "../media.js";
import { inspectPackage } from "../resource-health.js";
import { resourceManifest } from "../resource-manifest.js";
import { cleanSongVersions } from "../resource-cleanup.js";

export async function standardize(job, payload, context) {
  const { store, cache, roots, downloads } = context;
  let song = store.db.prepare("SELECT * FROM songs WHERE id=?").get(payload.id);
  if (
    context.isPlaying?.(song.id) ||
    store.db.prepare("SELECT song_id FROM queue WHERE song_id=?").get(song.id)
  )
    throw new Error("歌曲已进入播放队列，请播放结束后再整理");
  context.report?.("preparing");
  if (store.get("package-ready:" + song.id))
    await inspectPackage(store, song, store.get("package:" + song.id));
  const manifest = resourceManifest(store, song, cache);
  if (manifest.version !== 2 || manifest.tier !== "standard") {
    await prepareSong(store, song.id, [...roots, downloads], cache);
    song = store.db.prepare("SELECT * FROM songs WHERE id=?").get(song.id);
    if (resourceManifest(store, song, cache).tier !== "standard")
      throw new Error("现有资源未能组成标准双音轨，请在曲库中核对缺失项");
  }
  context.report?.("resource-cleanup");
  const cleanup = await cleanSongVersions(store, song.id, cache, {
    ignoreJobId: job.id,
    legacyCache: context.legacyCache,
    isPlaying: context.isPlaying,
  });
  store.set("standardize:" + song.id, { finished: Date.now(), ...cleanup });
}
