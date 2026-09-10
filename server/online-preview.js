import {
  videoQuality,
  videoFormat,
  qualityChoices,
} from "../shared/video-quality.js";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { run } from "./process.js";
import { withBiliCookie, canonicalVideo } from "./sources.js";
import { bilibiliProvider } from "./providers/bilibili.js";

export function biliStreamUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !/(^|\.)bilivideo\.(com|cn)$/.test(url.hostname)
  )
    throw new Error("B站未返回可用的直连视频流");
  return url.href;
}
export async function resolvePreview(url, cookie, dir, quality = "highest") {
  quality = videoQuality(quality);
  url = canonicalVideo(url);
  if (new URL(url).hostname !== "www.bilibili.com")
    throw new Error("预览仅支持 B站视频");
  try {
    const data = await bilibiliProvider.preview(url, cookie, fetch, quality);
    const media = (value) => ({
      url: biliStreamUrl(value),
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://www.bilibili.com/",
      },
    });
    return {
      duration: data.duration,
      quality,
      qualities: data.qualities,
      previewHeight: data.previewHeight,
      downloadHeight: data.downloadHeight,
      video: media(data.video),
      audio: media(data.audio),
    };
  } catch {}
  const raw = await withBiliCookie(cookie, dir, (file) =>
    run(
      process.env.YTDLP || "yt-dlp",
      [
        "--ignore-config",
        "--no-playlist",
        "--skip-download",
        "--dump-single-json",
        "--socket-timeout",
        "15",
        "--retries",
        "1",
        ...(file ? ["--cookies", file] : []),
        "-f",
        videoFormat(quality)
          .replace("bv*", "bv[vcodec^=avc1][ext=mp4]")
          .replace("+ba", "+ba[ext=m4a]"),
        url,
      ],
      60000,
    ),
  );
  const data = JSON.parse(raw),
    formats = data.requested_formats || [data];
  const video = formats.find((f) => f.vcodec && f.vcodec !== "none"),
    audio = formats.find((f) => f.vcodec === "none" && f.acodec !== "none");
  if (!video || !(data.duration > 0)) throw new Error("无法取得可预览的视频流");
  const stream = (f) => ({
    url: biliStreamUrl(f.url),
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://www.bilibili.com/",
      ...(data.http_headers || {}),
      ...(f.http_headers || {}),
    },
  });
  return {
    duration: Number(data.duration),
    quality,
    qualities: qualityChoices(data.formats || formats),
    previewHeight: video.height,
    downloadHeight: Math.max(
      ...(data.formats || formats)
        .filter(
          (f) =>
            f.height > 0 &&
            (quality === "highest" || f.height <= Number(quality)),
        )
        .map((f) => f.height),
    ),
    video: stream(video),
    audio: audio ? stream(audio) : null,
  };
}
export function previewSessions({
  resolve = resolvePreview,
  fetcher = fetch,
} = {}) {
  const sessions = new Map();
  const resolving = new Map();
  let pending = 0,
    streaming = 0;
  function lookup(id) {
    for (const [key, v] of sessions)
      if (v.expires < Date.now()) sessions.delete(key);
    const value = sessions.get(id);
    if (!value)
      throw Object.assign(new Error("预览已过期，请重新打开视频"), {
        status: 410,
      });
    return value;
  }
  return {
    lookup,
    async create(
      url,
      cookie,
      dir,
      { refresh = false, quality = "highest" } = {},
    ) {
      quality = videoQuality(quality);
      for (const [key, v] of sessions)
        if (v.expires < Date.now()) sessions.delete(key);
      const cacheKey = createHash("sha256")
        .update(url + "\n" + cookie + "\n" + quality)
        .digest("hex");
      if (refresh)
        for (const [id, data] of sessions)
          if (data.cacheKey === cacheKey) sessions.delete(id);
      const publicData = (id, data) => ({
        id,
        duration: data.duration,
        quality,
        qualities: data.qualities || qualityChoices([]),
        previewHeight: data.previewHeight || null,
        downloadHeight: data.downloadHeight || null,
        video: `/api/online/preview/${id}/video`,
        audio: data.audio ? `/api/online/preview/${id}/audio` : null,
      });
      for (const [id, data] of sessions)
        if (data.cacheKey === cacheKey) return publicData(id, data);
      if (resolving.has(cacheKey)) return resolving.get(cacheKey);
      if (pending >= 3 || sessions.size >= 40)
        throw new Error("预览请求较多，请稍后再试");
      pending++;
      const task = (async () => {
        try {
          const data = await resolve(url, cookie, dir, quality),
            id = randomUUID();
          sessions.set(id, {
            ...data,
            url,
            cacheKey,
            expires: Date.now() + 20 * 60000,
          });
          return publicData(id, data);
        } catch {
          throw new Error(
            "B站暂时无法提供预览，请稍后重试；需要登录的视频可在后台保存 B站 Cookie。",
          );
        } finally {
          pending--;
          resolving.delete(cacheKey);
        }
      })();
      resolving.set(cacheKey, task);
      return task;
    },
    async stream(req, res) {
      const data = lookup(req.params.id),
        media = data[req.params.track];
      if (!["video", "audio"].includes(req.params.track) || !media)
        throw new Error("预览轨道不存在");
      if (streaming >= 12) throw new Error("同时预览的连接过多");
      const range = req.get("range");
      if (range && !/^bytes=\d*-\d*$/.test(range))
        throw new Error("视频请求区间无效");
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 300000);
      let clientClosed = false,
        upstreamFailed = false;
      const closed = () => {
        clientClosed = true;
        controller.abort();
      };
      res.on("close", closed);
      streaming++;
      try {
        let url = media.url,
          response;
        for (let count = 0; count < 4; count++) {
          response = await fetcher(biliStreamUrl(url), {
            headers: {
              ...media.headers,
              "Accept-Encoding": "identity",
              ...(range ? { Range: range } : {}),
            },
            signal: controller.signal,
            redirect: "manual",
          });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            url = new URL(response.headers.get("location"), url).href;
            await response.body?.cancel();
            continue;
          }
          break;
        }
        if (![200, 206, 416].includes(response.status)) {
          await response.body?.cancel();
          throw new Error("B站预览流暂时不可用，请重新打开");
        }
        res.status(response.status).set("Cache-Control", "private, no-store");
        for (const name of ["content-length", "content-range", "accept-ranges"])
          if (response.headers.has(name))
            res.set(name, response.headers.get(name));
        res.type(req.params.track === "video" ? "video/mp4" : "audio/mp4");
        if (response.body) {
          const upstream = Readable.fromWeb(response.body);
          upstream.on("error", () => {
            if (!clientClosed) upstreamFailed = true;
          });
          await pipeline(upstream, res);
        } else res.end();
      } catch (error) {
        if (
          upstreamFailed ||
          (!(
            clientClosed &&
            ["ERR_STREAM_PREMATURE_CLOSE", "ABORT_ERR", "ECONNRESET"].includes(
              error.code,
            )
          ) &&
            !(clientClosed && error.name === "AbortError"))
        )
          throw error;
      } finally {
        clearTimeout(timer);
        res.off("close", closed);
        streaming--;
      }
    },
  };
}
