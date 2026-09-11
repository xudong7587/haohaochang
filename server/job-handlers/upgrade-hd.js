import { hdUpgradeSource } from "../split-video.js";
import { refreshVideo } from "./refresh-video.js";

// Old queued jobs follow the same recording policy as the current update UI.
export async function upgradeHd(job, payload, context) {
  const song = context.store.db
    .prepare("SELECT * FROM songs WHERE id=?")
    .get(payload.id);
  if (!song) throw new Error("歌曲不存在");
  const source = hdUpgradeSource(context.store, song);
  if (!source) throw new Error("缺少原视频来源，请在更新视频中选择新来源");
  return refreshVideo(
    job,
    { ...payload, ...source, quality: "highest" },
    context,
  );
}
