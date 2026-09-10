import path from "node:path";
import { stageResources } from "../resource-publication.js";
import { encodePicture, savePackageInfo } from "../song-package.js";
import { requireHealthyPackage } from "../resource-health.js";
export async function compatibleVideo(
  job,
  payload,
  { store, cache, isPlaying },
) {
  const song = store.db
    .prepare("SELECT * FROM songs WHERE id=?")
    .get(payload.id);
  if (!song) throw new Error("歌曲不存在");
  if (
    isPlaying?.(song.id) ||
    store.db.prepare("SELECT id FROM queue WHERE song_id=?").get(song.id)
  )
    throw new Error("歌曲正在播放队列中，请播放结束后转换画面");
  const source = path.join(store.get("package:" + song.id), "画面.mp4");
  const stage = await stageResources(store, song, cache, {
    phase: "compatible-video",
  });
  try {
    await encodePicture(stage.store, song, source, stage.directory, {
      force: true,
    });
    await savePackageInfo(
      stage.store,
      { ...song, resourceRevision: song.resourceRevision + 1 },
      cache,
    );
    await requireHealthyPackage(stage.store, song, stage.directory, [
      "video",
      "vocal",
      "backing",
    ]);
    await stage.publish();
  } catch (e) {
    await stage.abandon();
    throw e;
  }
}
