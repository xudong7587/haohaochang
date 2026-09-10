import path from "node:path";
import { downloadBiliTracks } from "../bili-download.js";
import { clipOnPc } from "../clipping.js";
import { hdUpgradeSource, upgradeSplitVideo } from "../split-video.js";
export async function upgradeHd(job, payload, context) {
  const { store, downloads, cache } = context;
  const song = store.db
    .prepare("SELECT * FROM songs WHERE id=?")
    .get(payload.id);
  if (!song) throw new Error("歌曲不存在");
  if (
    context.isPlaying?.(song.id) ||
    store.db.prepare("SELECT id FROM queue WHERE song_id=?").get(song.id)
  )
    throw new Error("歌曲正在播放队列中，请播放结束后升级画面");
  const source = hdUpgradeSource(store, song);
  if (!source) throw new Error("缺少原视频和裁剪记录，请手动核对画面来源");
  context.report?.("downloading");
  const downloaded = await downloadBiliTracks(
    source.url,
    path.join(downloads, ".ktv-online", "dash"),
    store.get("favorites", {}).cookie,
    "highest",
  );
  if (source.clip) context.report?.("clipping");
  const file = await clipOnPc(
    store,
    job,
    { ...source, title: song.title, artist: song.artist },
    downloaded.videoFile,
    downloads,
    true,
  );
  context.report?.("preparing-video");
  await upgradeSplitVideo(store, song, file, source.url, cache);
}
