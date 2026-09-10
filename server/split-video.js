import path from "node:path";
import { copyFile } from "node:fs/promises";
import { probe } from "./media-utils.js";
import { stageResources } from "./resource-publication.js";
import { encodePicture, savePackageInfo } from "./song-package.js";
import { requireHealthyPackage } from "./resource-health.js";
import { canonicalVideo } from "../shared/source-candidate.js";

export function hdUpgradeSource(store, song) {
  try {
    const evidence = JSON.parse(song.evidence || "[]");
    const selection = evidence.find(
      (item) => item.kind === "user-selection" && item.url,
    );
    if (!selection) return null;
    const url = canonicalVideo(selection.url);
    if (new URL(url).hostname !== "www.bilibili.com") return null;
    const replacement = store.get("video-source:" + song.id);
    if (replacement?.url && canonicalVideo(replacement.url) !== url)
      return null;
    return { url, clip: selection.clip || null };
  } catch {
    return null;
  }
}

// importMedia deduplicates by the exact audio bytes. An HD retry must be able to
// upgrade its picture without re-separating or overwriting the existing audio.
export async function upgradeSplitVideo(store, song, file, sourceUrl, cache) {
  const incoming = await probe(file);
  let previous;
  try {
    previous = await probe(
      path.join(store.get("package:" + song.id), "画面.mp4"),
    );
  } catch {}
  if (previous?.height >= incoming.height) return false;
  if (
    !incoming.hasVideo ||
    incoming.audio.length ||
    Math.abs(incoming.duration - song.duration) > 1
  )
    throw new Error("高清画面与已有音频不匹配，已保留旧资源");
  const stage = await stageResources(store, song, cache, {
    phase: "upgrade-hd",
  });
  try {
    const source = path.join(stage.directory, "来源画面.mp4");
    await copyFile(file, source);
    stage.store.set("split-video:" + song.id, source);
    stage.store.set("download-quality:" + song.id, {
      height: incoming.height,
      sourceUrl,
    });
    await encodePicture(stage.store, song, source, stage.directory, {
      info: incoming,
    });
    const updated = {
      ...song,
      needs_video: 0,
      resourceRevision: song.resourceRevision + 1,
    };
    await savePackageInfo(stage.store, updated, cache);
    await requireHealthyPackage(stage.store, updated, stage.directory, [
      "video",
      "vocal",
      ...(["separated", "tracks", "channels"].includes(song.mode)
        ? ["backing"]
        : []),
    ]);
    await stage.publish({ needs_video: 0 });
    return true;
  } catch (error) {
    await stage.abandon();
    throw error;
  }
}
