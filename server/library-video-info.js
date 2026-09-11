import path from "node:path";
import { stat } from "node:fs/promises";
import { probe } from "./media-utils.js";

let active = 0;
const waiting = [];
async function readVideo(file) {
  if (active >= 2) await new Promise((resolve) => waiting.push(resolve));
  active++;
  try {
    return await probe(file);
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// Old health records and legacy MP4 packages may lack resolution metadata.
// Read headers once per file revision; never encode or change resource readiness.
export async function libraryVideoInfo(store, song, manifest, cache) {
  const resource = manifest.resources.video;
  if (resource.available && resource.width > 0 && resource.height > 0)
    return { available: true, width: resource.width, height: resource.height };
  let file;
  if (manifest.version === 2) {
    if (!resource.available) return { available: false };
    file = path.join(store.get("package:" + song.id), "画面.mp4");
  } else if (resource.available || manifest.backing)
    file = path.join(
      cache,
      song.id + (resource.available ? "-vocal.mp4" : "-backing.mp4"),
    );
  else file = song.path;
  if (!file) return { available: false };
  try {
    const info = await stat(file);
    if (!info.isFile()) return { available: false };
    const key = "library-video-info:" + song.id;
    const previous = store.get(key);
    if (
      previous?.file === file &&
      previous.size === info.size &&
      previous.mtimeMs === info.mtimeMs &&
      (!previous.retryAt || previous.retryAt > Date.now())
    )
      return previous.video;
    let video, retryAt;
    try {
      const media = await readVideo(file);
      video = {
        available: media.hasVideo,
        width: media.width,
        height: media.height,
      };
    } catch {
      video = { available: resource.available || null };
      retryAt = Date.now() + 60000;
    }
    store.set(key, {
      file,
      size: info.size,
      mtimeMs: info.mtimeMs,
      video,
      retryAt,
    });
    return video;
  } catch {
    return { available: resource.available || false };
  }
}
