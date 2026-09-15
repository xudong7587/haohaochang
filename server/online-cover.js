import { allowedPosterUrl, downloadPoster } from "./poster-source.js";
import { fail } from "./http-utils.js";

export function onlineCoverPath(value) {
  if (!value) return "";
  try {
    const url = allowedPosterUrl(
      String(value)
        .replace(/^\/\//, "https://")
        .replace(/^http:/, "https:"),
    );
    return `/api/online/cover?url=${encodeURIComponent(url.href)}`;
  } catch {
    return "";
  }
}

// Small, per-server cache: search thumbnails never become library resources.
export function onlineCoverApi({ app, member, download = downloadPoster }) {
  const cache = new Map(),
    pending = new Map();
  let bytes = 0;
  let active = 0;
  const waiting = [];
  const maxBytes = 32 * 1024 * 1024;
  async function load(url) {
    if (active >= 8) await new Promise((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await download(url);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }
  app.get("/api/online/cover", member, async (req, res) => {
    let url;
    try {
      url = allowedPosterUrl(req.query.url).href;
    } catch {
      throw fail(400, "视频封面地址无效");
    }
    let hit = cache.get(url);
    if (hit && hit.expires <= Date.now()) {
      cache.delete(url);
      bytes -= hit.data.length;
      hit = null;
    }
    if (!hit) {
      if (!pending.has(url)) {
        if (pending.size >= 64) throw fail(429, "封面加载繁忙，请稍后重试");
        const work = Promise.resolve()
          .then(() => load(url))
          .then((data) => {
            while (
              cache.size &&
              (cache.size >= 64 || bytes + data.length > maxBytes)
            ) {
              const key = cache.keys().next().value;
              bytes -= cache.get(key).data.length;
              cache.delete(key);
            }
            const entry = { data, expires: Date.now() + 3600000 };
            cache.set(url, entry);
            bytes += data.length;
            return entry;
          })
          .finally(() => pending.delete(url));
        pending.set(url, work);
      }
      try {
        hit = await pending.get(url);
      } catch {
        throw fail(502, "视频封面暂时无法加载");
      }
    }
    const data = hit.data;
    const type =
      data[0] === 0xff
        ? "image/jpeg"
        : data[0] === 137
          ? "image/png"
          : "image/webp";
    res
      .set({
        "Content-Type": type,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      })
      .send(data);
  });
}
