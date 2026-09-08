import { bilibiliProvider } from "./providers/bilibili.js";
import { youtubeProvider } from "./providers/youtube.js";
import {
  canonicalVideo,
  createSourceCandidate,
} from "../shared/source-candidate.js";
export { canonicalVideo } from "../shared/source-candidate.js";
import { run } from "./process.js";
import { mkdir, stat, writeFile, rm, mkdtemp, rename } from "node:fs/promises";
import { withKeyLock } from "./song-writes.js";
import { probe } from "./media-utils.js";
import path from "node:path";
import { createHash } from "node:crypto";
export async function withBiliCookie(cookie, dir, action) {
  if (!cookie) return action(undefined);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `cookies-${crypto.randomUUID()}.txt`);
  const lines = cookie
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.includes("="))
    .map((v) => {
      const n = v.indexOf("=");
      return (
        ".bilibili.com\tTRUE\t/\tTRUE\t0\t" +
        v.slice(0, n) +
        "\t" +
        v.slice(n + 1)
      );
    });
  try {
    await writeFile(file, "# Netscape HTTP Cookie File\n" + lines.join("\n"), {
      mode: 0o600,
    });
    return await action(file);
  } finally {
    await rm(file, { force: true });
  }
}
export async function onlineSearch(query, provider, cookie = "") {
  const adapter =
    provider === "bilibili"
      ? bilibiliProvider
      : provider === "youtube"
        ? youtubeProvider
        : null;
  if (!adapter) throw new Error("不支持的搜索平台");
  return adapter.search(query, cookie);
}
export async function downloadVideo(url, dir, cookieFile) {
  return defaultDownloader(url, dir, cookieFile, false);
}
export async function downloadAudio(url, dir, cookieFile) {
  return defaultDownloader(url, dir, cookieFile, true);
}
const defaultDownloader = createMediaDownloader();
// Inject only transport for isolated download contract tests; validation stays real.
export function createMediaDownloader({
  video = fetchVideo,
  audio = fetchAudio,
} = {}) {
  const downloadScope = {};
  return async function lockedDownload(url, dir, cookieFile, audioOnly) {
    const canonical = canonicalVideo(url);
    return withKeyLock(
      downloadScope,
      path.resolve(dir) + "\n" + canonical,
      async () => {
        await mkdir(dir, { recursive: true });
        const id = createHash("sha256")
          .update(canonical)
          .digest("hex")
          .slice(0, 24);
        for (const extension of audioOnly ? [".m4a"] : [".mp4"]) {
          const file = path.join(dir, id + extension);
          try {
            const info = await probe(file);
            if (
              info.audio.length &&
              info.duration > 0 &&
              (audioOnly || info.hasVideo)
            )
              return { id, file };
          } catch {}
        }
        const staging = await mkdtemp(path.join(dir, ".ktv-download-"));
        try {
          const result = audioOnly
            ? await audio(canonical, staging, cookieFile)
            : await video(canonical, staging, cookieFile);
          const info = await probe(result.file);
          if (!info.audio.length || !(info.duration > 0))
            throw new Error("下载文件不含有效音频");
          const target = path.join(dir, path.basename(result.file));
          await rename(result.file, target);
          return { id, file: target };
        } finally {
          await rm(staging, { recursive: true, force: true });
        }
      },
    );
  };
}
async function fetchAudio(url, dir, cookieFile) {
  const id = createHash("sha256").update(url).digest("hex").slice(0, 24),
    file = path.join(dir, id + ".m4a");
  await run(
    process.env.YTDLP || "yt-dlp",
    [
      ...(process.env.YTDLP_FFMPEG
        ? ["--ffmpeg-location", process.env.YTDLP_FFMPEG]
        : []),
      ...(cookieFile ? ["--cookies", cookieFile] : []),
      "--ignore-config",
      "--no-playlist",
      "--socket-timeout",
      "20",
      "--retries",
      "2",
      "--max-filesize",
      "200M",
      "-x",
      "--audio-format",
      "m4a",
      "-o",
      path.join(dir, id + ".%(ext)s"),
      "--",
      url,
    ],
    900000,
  );
  return { id, file };
}
async function fetchVideo(url, dir, cookieFile) {
  await mkdir(dir, { recursive: true });
  const id = createHash("sha256")
    .update(canonicalVideo(url))
    .digest("hex")
    .slice(0, 24);
  const file = path.join(dir, `${id}.mp4`);
  try {
    await stat(file);
    return { id, file };
  } catch {}
  try {
    await run(
      process.env.YTDLP || "yt-dlp",
      [
        ...(process.env.YTDLP_FFMPEG
          ? ["--ffmpeg-location", process.env.YTDLP_FFMPEG]
          : []),
        ...(cookieFile ? ["--cookies", cookieFile] : []),
        "--ignore-config",
        "--js-runtimes",
        "node",
        "--no-playlist",
        "--no-warnings",
        "--socket-timeout",
        "20",
        "--retries",
        "2",
        "--max-filesize",
        "2G",
        "-f",
        "bv*[height<=1080]+ba/b[height<=1080]",
        "--merge-output-format",
        "mp4",
        "--recode-video",
        "mp4",
        "-o",
        file,
        "--",
        canonicalVideo(url),
      ],
      1800000,
    );
    await stat(file);
    return { id, file };
  } catch {
    const audio = path.join(dir, `${id}.m4a`);
    await run(
      process.env.YTDLP || "yt-dlp",
      [
        ...(process.env.YTDLP_FFMPEG
          ? ["--ffmpeg-location", process.env.YTDLP_FFMPEG]
          : []),
        ...(cookieFile ? ["--cookies", cookieFile] : []),
        "--ignore-config",
        "--no-playlist",
        "--socket-timeout",
        "20",
        "--max-filesize",
        "200M",
        "-x",
        "--audio-format",
        "m4a",
        "-o",
        path.join(dir, `${id}.%(ext)s`),
        "--",
        canonicalVideo(url),
      ],
      1800000,
    );
    await stat(audio);
    return { id, file: audio };
  }
}

export async function sourceMetadata(input, cookie = "") {
  const url = canonicalVideo(input);
  return (
    new URL(url).hostname === "www.bilibili.com"
      ? bilibiliProvider
      : youtubeProvider
  ).metadata(url, cookie);
}

export async function previewSourceCandidate(input, cookie = "", options = {}) {
  const info = await (options.metadata || sourceMetadata)(input, cookie);
  return createSourceCandidate(info, options.identity);
}
