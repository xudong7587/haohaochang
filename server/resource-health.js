import path from "node:path";
import { stat, readFile } from "node:fs/promises";
import { probe } from "./media-utils.js";
import { run } from "./process.js";
import { resourceNames } from "./resource-manifest.js";

let active = 0;
const waiting = [];
async function bounded(action) {
  if (active >= 2) await new Promise((r) => waiting.push(r));
  active++;
  try {
    return await action();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
export async function inspectPackage(store, song, directory) {
  const previous = store.get("package-health:" + song.id, {}),
    result = {};
  for (const [kind, name] of Object.entries(resourceNames)) {
    const file = path.join(directory, name);
    let info;
    try {
      info = await stat(file);
      if (!info.isFile() || !info.size) throw new Error("文件缺失或为空");
      const prior = previous[kind];
      if (
        prior?.file === file &&
        prior.size === info.size &&
        prior.mtimeMs === info.mtimeMs
      ) {
        result[kind] = prior;
        continue;
      }
      if (kind === "lyrics") {
        if ((await readFile(file, "utf8")) !== (song.lyrics || ""))
          throw new Error("歌词与资料不一致");
        result[kind] = {
          file,
          size: info.size,
          mtimeMs: info.mtimeMs,
          available: true,
          duration: song.duration,
        };
        continue;
      }
      result[kind] = await bounded(async () => {
        const media = await probe(file);
        if (
          !(media.duration > 0) ||
          (kind === "video" && !media.hasVideo) ||
          (kind !== "video" && (media.audio.length !== 1 || media.hasVideo))
        )
          throw new Error("媒体轨道或时长无效");
        await run(
          process.env.FFMPEG || "ffmpeg",
          [
            "-v",
            "error",
            "-xerror",
            "-err_detect",
            "explode",
            "-i",
            file,
            "-map",
            "0",
            ...(kind === "video" ? ["-c", "copy"] : []),
            "-f",
            "null",
            "-",
          ],
          3600000,
        );
        return {
          file,
          size: info.size,
          mtimeMs: info.mtimeMs,
          available: true,
          duration: media.duration,
          ...(kind === "video"
            ? {
                width: media.width,
                height: media.height,
                codec: media.videoCodec,
                verification: "packets",
              }
            : {}),
        };
      });
    } catch (e) {
      result[kind] = {
        file,
        size: info?.size,
        mtimeMs: info?.mtimeMs,
        available: false,
        reason: e.message.slice(-300),
      };
    }
  }
  if (result.vocal.available && result.backing.available) {
    const tolerance = Math.max(
      0.25,
      Math.min(1, result.vocal.duration * 0.005),
    );
    if (Math.abs(result.vocal.duration - result.backing.duration) > tolerance)
      result.backing = {
        ...result.backing,
        available: false,
        reason: "伴奏与原唱时长不一致，需要重新制作配套音轨",
      };
  }
  if (
    store.get("package:" + song.id) === directory &&
    JSON.stringify(previous) !== JSON.stringify(result)
  )
    store.set("package-health:" + song.id, result);
  return result;
}
export async function requireHealthyPackage(store, song, directory, kinds) {
  const health = await inspectPackage(store, song, directory);
  for (const kind of kinds)
    if (!health[kind]?.available)
      throw new Error("资源校验失败（" + kind + "）：" + health[kind]?.reason);
  return health;
}
