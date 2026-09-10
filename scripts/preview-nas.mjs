import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { createApp } from "../server/app.js";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
process.env.FFMPEG = ffmpeg;
process.env.FFPROBE = ffprobe.path;
const dataDir = path.resolve("data/local-nas-preview");
const root = path.resolve("media");
if (!existsSync(path.join(dataDir, "ktv.sqlite"))) throw new Error("请先准备独立 NAS 曲库快照；预览不会自动创建示例歌曲。");
console.log("Opening local snapshot");
const service = createApp({
  dataDir,
  roots: [root],
  downloads: path.join(dataDir, "downloads"),
  adminToken: "preview-ktv-2026",
  worker: false,
  discovery: false,
  readOnlyMedia: true,
});
console.log("Snapshot opened");
service.store.set("publicUrl", "http://127.0.0.1:3212");
service.store.set("ai", { enabled: false, autoDiscover: false });
service.store.set("autoImport", false);
// The copied NAS validation is retained as snapshot evidence. Only translate the
// filesystem timestamp precision; this preview never re-encodes shared media.
let checked = 0;
for (const row of service.store.db
  .prepare("SELECT key,value FROM settings WHERE key LIKE 'package-health:%'")
  .all()) {
  const health = JSON.parse(row.value);
  for (const item of Object.values(health)) {
    try {
      item.file = path.normalize(item.file);
      const s = statSync(item.file);
      if (s.size === item.size) item.mtimeMs = s.mtimeMs;
    } catch {}
  }
  service.store.set(row.key, health);
  if (++checked % 50 === 0) console.log("Mapped health records", checked);
}
service.app.listen(3212, "127.0.0.1", () =>
  console.log("NAS media preview: http://127.0.0.1:3212/admin"),
);
