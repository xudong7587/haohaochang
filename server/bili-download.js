import {
  taskSignal,
  taskFetch,
  checkTaskCancellation,
} from "./task-cancellation.js";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { bilibiliProvider } from "./providers/bilibili.js";
import { biliStreamCandidates, openBiliStream } from "./bili-stream.js";
import { probe } from "./media-utils.js";
import { withKeyLock } from "./song-writes.js";
import { videoQuality } from "../shared/video-quality.js";

export function requireDownloadHeight(actual, quality, expected = 0) {
  // A requested quality is a ceiling, not a minimum. Only the freshly
  // resolved stream is authoritative when validating the downloaded file.
  const minimum = Math.max(1, Number(expected) || 0);
  if (!Number.isFinite(actual) || actual < minimum)
    throw new Error(
      `实际视频 ${actual || 0}p 未达到所选视频流 ${minimum}p，请重试下载。`,
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
  const streams = await resolve(url, cookie, taskFetch, quality, true);
  requireDownloadHeight(streams.previewHeight, quality);
  const id = createHash("sha256")
    .update(
      [
        url,
        cookie,
        quality,
        streams.previewHeight,
        streams.previewFps || 0,
        streams.videoCodec || "",
      ].join("\n"),
    )
    .digest("hex")
    .slice(0, 24);
  return withKeyLock(locks, path.resolve(directory, id), async () => {
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, id),
      file = path.join(target, "audio.m4a"),
      videoFile = path.join(target, "video.mp4");
    const validate = async (audio, video) => {
      const [a, v] = await Promise.all([probe(audio), probe(video)]);
      requireDownloadHeight(v.height, quality, streams.previewHeight);
      if (streams.previewFps > 0 && v.videoFps + 0.1 < streams.previewFps)
        throw new Error("实际视频帧率低于所选视频流，请重试下载");
      if (
        !a.audio.length ||
        a.hasVideo ||
        !v.hasVideo ||
        v.audio.length ||
        !(a.duration > 0) ||
        !(v.duration > 0)
      )
        throw new Error("B站下载文件缺少有效的独立画面或原唱轨道，请重试下载");
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
        { backups: streams.videoBackups },
      );
      await transfer(
        streams.audio,
        path.join(staging, "audio.m4a"),
        200 * 1024 ** 2,
        { backups: streams.audioBackups },
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
export async function downloadStream(
  value,
  target,
  maximum,
  { backups = [], fetcher = taskFetch } = {},
) {
  let last;
  for (const url of biliStreamCandidates(value, backups)) {
    checkTaskCancellation();
    const temporary = target + "." + randomUUID() + ".part";
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 1800000);
    let stalled = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await openBiliStream(url, {
        fetcher,
        signal: taskSignal()
          ? AbortSignal.any([controller.signal, taskSignal()])
          : controller.signal,
      });
      clearTimeout(stalled);
      stalled = setTimeout(() => controller.abort(), 30000);
      const length = Number(response.headers.get("content-length")) || 0;
      const range = response.headers
        .get("content-range")
        ?.match(/^bytes 0-(\d+)\/(\d+)$/);
      if (
        ![200, 206].includes(response.status) ||
        !response.body ||
        (response.status === 206 &&
          (!range || Number(range[1]) + 1 !== Number(range[2])))
      ) {
        await response.body?.cancel();
        throw new Error(
          `B站轨道下载失败或返回了不完整分段 (${response.status})`,
        );
      }
      if (length > maximum) {
        await response.body.cancel();
        throw new Error("B站轨道超过下载大小限制");
      }
      let bytes = 0;
      await pipeline(
        Readable.fromWeb(response.body),
        new Transform({
          transform(chunk, encoding, callback) {
            clearTimeout(stalled);
            stalled = setTimeout(() => controller.abort(), 30000);
            bytes += chunk.length;
            callback(
              bytes > maximum ? new Error("B站轨道超过下载大小限制") : null,
              chunk,
            );
          },
        }),
        createWriteStream(temporary, { flags: "wx" }),
        {
          signal: taskSignal()
            ? AbortSignal.any([controller.signal, taskSignal()])
            : controller.signal,
        },
      );
      if (
        !bytes ||
        (length && length !== bytes) ||
        (range && Number(range[2]) !== bytes)
      )
        throw new Error("B站轨道传输不完整");
      await rename(temporary, target);
      return;
    } catch (error) {
      checkTaskCancellation();
      last = error;
    } finally {
      clearTimeout(deadline);
      clearTimeout(stalled);
      await rm(temporary, { force: true });
    }
  }
  throw new Error(
    `B站下载线路均未成功，请重试下载（${last?.name === "AbortError" ? "线路超时" : "连接中断、拒绝或文件不完整"}）`,
  );
}
