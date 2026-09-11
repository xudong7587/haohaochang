import path from "node:path";
import { realpath as nativeRealpath } from "node:fs/promises";
import { realpath as callbackRealpath } from "node:fs";
import { promisify } from "node:util";
const portableRealpath = promisify(callbackRealpath);
async function realpath(file) {
  try {
    return await nativeRealpath(file);
  } catch (error) {
    // Windows mapped SMB drives can reject the native final-path lookup.
    // The JS resolver still follows links before the same containment check.
    if (process.platform === "win32" && error.code === "UNKNOWN")
      return portableRealpath(file);
    throw error;
  }
}
import { pinyin } from "pinyin-pro";
import { run } from "./process.js";
export function searchText(title, artist) {
  const text = `${title} ${artist}`;
  return `${text} ${pinyin(text, { toneType: "none" })} ${pinyin(text, { pattern: "first", toneType: "none" }).replaceAll(" ", "")}`.toLowerCase();
}
export function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return (
    rel === "" ||
    (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel))
  );
}
export async function safeMedia(file, roots) {
  const actual = await realpath(file);
  for (const root of roots) {
    try {
      if (inside(await realpath(root), actual)) return actual;
    } catch {}
  }
  throw new Error("媒体文件不在挂载目录内");
}
export async function probe(file) {
  const data = JSON.parse(
    await run(process.env.FFPROBE || "ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      file,
    ]),
  );
  return {
    videoDuration: Number(
      data.streams.find(
        (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
      )?.duration ||
        data.format?.duration ||
        0,
    ),
    videoFps: (() => {
      const rate =
        data.streams.find(
          (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
        )?.avg_frame_rate || "0/1";
      const [n, d] = rate.split("/").map(Number);
      return n / (d || 1);
    })(),
    width:
      data.streams.find(
        (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
      )?.width || 0,
    height:
      data.streams.find(
        (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
      )?.height || 0,
    hasVideo: !!data.streams?.some(
      (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
    ),
    videoCodec: data.streams.find(
      (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
    )?.codec_name,
    pixelFormat: data.streams.find(
      (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
    )?.pix_fmt,
    colorTransfer: data.streams.find(
      (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
    )?.color_transfer,
    duration: Number(data.format?.duration || 0),
    audio: data.streams
      .filter((s) => s.codec_type === "audio")
      .map((s, i) => ({
        index: i,
        channels: s.channels,
        codec: s.codec_name,
        title: s.tags?.title || `音轨 ${i + 1}`,
      })),
  };
}
