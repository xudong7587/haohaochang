import { canonicalVideo } from "./source-candidate.js";

export function canonicalBiliRecording(value) {
  const url = new URL(canonicalVideo(value));
  if (url.hostname !== "www.bilibili.com")
    throw new Error("更新视频请选择 B站链接");
  if (url.searchParams.get("p") === "1") url.searchParams.delete("p");
  return url.href;
}
export function videoRefreshMode(source, url, clip) {
  const canonical = canonicalBiliRecording(url);
  let same = false;
  try {
    same = !!source?.url && canonicalBiliRecording(source.url) === canonical;
  } catch {}
  const videoOnly = same && source?.untrimmed === true && !clip;
  return {
    mode: videoOnly ? "video-only" : "recording",
    url: canonical,
    reason: videoOnly
      ? "同一 B站链接、同一分 P，且没有裁剪记录，仅更新画面。"
      : "来源不同、来源记录不完整或存在裁剪，将重新生成原唱、分离伴奏并核对歌词。",
  };
}
