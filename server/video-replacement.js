import path from "node:path";
import { copyFile } from "node:fs/promises";
import {
  encodePackage,
  encodePicture,
  savePackageInfo,
  present,
} from "./song-package.js";
import { probe } from "./media-utils.js";
import { stageResources } from "./resource-publication.js";
import {
  withSongWrite,
  publicationKey,
  metadataRevisionFor,
} from "./song-writes.js";
import { inspectPackage, requireHealthyPackage } from "./resource-health.js";
export async function replaceVideo(
  store,
  song,
  file,
  url,
  cache,
  options = {},
) {
  return withSongWrite(
    store,
    song.id,
    async (latest) => {
      const key = publicationKey(song.id, "video");
      if (key && store.get(key))
        return { keepAudio: !!store.get("video-source:" + song.id)?.keepAudio };
      const info = await probe(file);
      if (!info.hasVideo) throw new Error("新链接必须提供视频画面");
      const oldDir = store.get("package:" + song.id);
      const health = oldDir ? await inspectPackage(store, latest, oldDir) : {};
      const keepAudio =
        !!health.vocal?.available && !!health.backing?.available;
      if (
        ["separated", "tracks", "channels"].includes(latest.mode) &&
        !keepAudio
      )
        throw new Error("现有双音轨缺失或损坏，请先修复音频后补画面");
      const offset = Number(options.offset) || 0;
      if (!Number.isFinite(offset) || Math.abs(offset) > 600)
        throw new Error("视频偏移必须在 -600 至 600 秒之间");
      if (
        keepAudio &&
        latest.duration &&
        Math.abs(info.duration - latest.duration) > 4
      )
        throw new Error(
          "视频与现有音轨时长不匹配，旧版本保持可用；请更换相同录音版本的 MV",
        );
      if (keepAudio && !options.confirmed)
        throw Object.assign(
          new Error("请试听确认同一录音版本并填写画面偏移后发布"),
          { status: 409, code: "VIDEO_REVIEW_REQUIRED" },
        );
      if (!keepAudio && !info.audio.length)
        throw new Error("待整理来源需要原唱音轨");
      const stage = await stageResources(store, latest, cache, {
        copy: keepAudio,
        phase: "video",
      });
      try {
        const source = path.join(stage.directory, "来源" + path.extname(file));
        await copyFile(file, source);
        if (keepAudio) {
          await encodePicture(stage.store, latest, source, stage.directory, {
            info,
          });
        } else {
          stage.store.set("package-fingerprint:" + song.id, null);
          stage.store.set("video-source:" + song.id, null);
          await encodePackage(
            stage.store,
            { ...latest, path: source, mode: "original" },
            info,
            cache,
          );
        }
        const patch = keepAudio
          ? { needs_video: 0, status: "ready", error: "" }
          : {
              path: source,
              mode: "original",
              duration: info.duration,
              needs_video: 0,
              status: "ready",
              lyrics: "",
              error: "",
            };
        stage.store.set("package-ready:" + song.id, true);
        stage.store.set("video-source:" + song.id, {
          url,
          path: source,
          previousPackage: oldDir,
          keepAudio,
          offset,
          alignment: options.confirmed ? "confirmed" : "source",
          duration: info.duration,
        });
        if (!keepAudio)
          stage.store.set("lyrics-match:" + song.id, {
            status: "needs-review",
            reason: "音频来源改变，需要重新匹配歌词",
          });
        await savePackageInfo(
          stage.store,
          {
            ...latest,
            ...patch,
            metadataRevision: metadataRevisionFor(latest, patch),
            resourceRevision: latest.resourceRevision + 1,
          },
          cache,
        );
        await requireHealthyPackage(
          stage.store,
          { ...latest, ...patch },
          stage.directory,
          keepAudio ? ["video", "vocal", "backing"] : ["video", "vocal"],
        );
        stage.publish(patch);
        return { keepAudio };
      } catch (error) {
        await stage.abandon();
        throw error;
      }
    },
    { wait: true },
  );
}
