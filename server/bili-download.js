import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { bilibiliProvider } from "./providers/bilibili.js";
import { biliStreamUrl } from "./online-preview.js";
import { probe } from "./media-utils.js";
import { withKeyLock } from "./song-writes.js";
import { videoQuality } from "../shared/video-quality.js";

export function requireDownloadHeight(actual, quality, expected = 0) {
  const minimum = Math.max(
    expected,
    quality === "highest" ? 720 : Number(quality),
  );
  if (!(actual >= minimum))
    throw new Error(
      `B站仅返回 ${actual || 0}p，未达到${quality === "highest" ? "高清" : quality + "p"}要求。请到“在线资源”扫码登录或更新 Cookie，并检查会员权限；若原视频只有低清，请明确选择该清晰度。`,
    );
}

const locks = {};
export async function downloadBiliTracks(
  url,
  directory,
  cookie = "",
  quality = "highest",
  expectedHeight = 0,
  {
    resolve = (...args) => bilibiliProvider.preview(...args),
    transfer = downloadStream,
  } = {},
) {
  quality = videoQuality(quality);
  // Resolve on every attempt: expired credentials must not reuse an old low-quality cache.
  const streams = await resolve(url, cookie, fetch, quality, true);
  requireDownloadHeight(streams.previewHeight, quality, expectedHeight);
  const id = createHash("sha256")
    .update(url + "\n" + cookie + "\n" + quality + "\n" + streams.previewHeight)
    .digest("hex")
    .slice(0, 24);
  return withKeyLock(locks, path.resolve(directory, id), async () => {
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, id),
      file = path.join(target, "audio.m4a"),
      videoFile = path.join(target, "video.mp4");
    const validate = async (audio, video) => {
      const [a, v] = await Promise.all([probe(audio), probe(video)]);
      requireDownloadHeight(
        v.height,
        quality,
        Math.max(expectedHeight, streams.previewHeight),
      );
      if (
        !a.audio.length ||
        a.hasVideo ||
        !v.hasVideo ||
        v.audio.length ||
        !(a.duration > 0) ||
        Math.abs(a.duration - v.duration) > 1 ||
        Math.abs(v.duration - streams.duration) > 1
      )
        throw new Error("B站独立音视频轨道不完整或时长不匹配");
      return v.height;
    };
    try {
      return { file, videoFile, height: await validate(file, videoFile) };
    } catch {}
    const staging = await mkdtemp(path.join(directory, ".ktv-dash-"));
    try {
      await transfer(
        streams.video,
        path.join(staging, "video.mp4"),
        2 * 1024 ** 3,
      );
      await transfer(
        streams.audio,
        path.join(staging, "audio.m4a"),
        200 * 1024 ** 2,
      );
      const height = await validate(
        path.join(staging, "audio.m4a"),
        path.join(staging, "video.mp4"),
      );
      // The cache directory is exclusively owned by this download key.
      await rm(target, { recursive: true, force: true });
      await rename(staging, target);
      return { file, videoFile, height };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  });
}
async function downloadStream(value, target, maximum) {
  const response = await fetch(biliStreamUrl(value), {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://www.bilibili.com/",
    },
    redirect: "error",
    signal: AbortSignal.timeout(1800000),
  });
  if (!response.ok || !response.body)
    throw new Error(`B站轨道下载失败 (${response.status})，请重试`);
  let bytes = 0;
  await pipeline(
    Readable.fromWeb(response.body),
    new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        callback(
          bytes > maximum ? new Error("B站轨道超过下载大小限制") : null,
          chunk,
        );
      },
    }),
    createWriteStream(target, { flags: "wx" }),
  );
}
