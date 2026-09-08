import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, stat, open, copyFile, rm } from "node:fs/promises";
import { safeMedia, inside } from "./media.js";

const maxBytes = 10 * 1024 * 1024;
const types = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const extensions = {
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".png": "png",
  ".webp": "webp",
};
const revisionPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error = (status, message) =>
  Object.assign(new Error(message), { status });

async function inspectImage(file, { extension = false } = {}) {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 12 || info.size > maxBytes)
      throw error(
        400,
        "每张背景图片须为不超过 10 MB 的 JPEG、PNG 或 WebP 文件",
      );
    const header = Buffer.alloc(32),
      { bytesRead } = await handle.read(header, 0, header.length, 0);
    let format;
    if (
      header
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      header.toString("ascii", 12, 16) === "IHDR"
    )
      format = "png";
    else if (header[0] === 255 && header[1] === 216 && header[2] === 255)
      format = "jpeg";
    else if (
      bytesRead >= 16 &&
      header.toString("ascii", 0, 4) === "RIFF" &&
      header.toString("ascii", 8, 12) === "WEBP" &&
      ["VP8 ", "VP8L", "VP8X"].includes(header.toString("ascii", 12, 16))
    )
      format = "webp";
    if (
      !format ||
      (extension && extensions[path.extname(file).toLowerCase()] !== format)
    )
      throw error(400, "图片内容与格式不符，仅支持真实 JPEG、PNG 或 WebP 图片");
    return { format, size: info.size, mtimeMs: info.mtimeMs };
  } finally {
    await handle.close();
  }
}

export function backgroundApi({
  app,
  admin,
  member,
  store,
  cache,
  roots = [],
  downloads,
  emit = () => {},
}) {
  const base = path.resolve(cache, "backgrounds"),
    allowed = [...roots, ...(downloads ? [downloads] : [])];
  const settings = () => {
    const current = store.get("background", {});
    return {
      paths: store.get("background:paths:" + current.revision, []),
      intervalSeconds: current.intervalSeconds || 12,
    };
  };
  let publishing = Promise.resolve();
  app.get("/api/admin/background", admin, (_req, res) => res.json(settings()));
  app.post("/api/admin/background", admin, async (req, res) => {
    const body = req.body || {};
    if (
      !Array.isArray(body.images) ||
      body.images.length > 20 ||
      body.images.some(
        (item) =>
          typeof item !== "string" || !item.trim() || item.length > 4096,
      )
    )
      throw error(400, "请提供最多 20 张背景图片的容器内路径");
    const interval = Number(body.intervalSeconds);
    if (!Number.isFinite(interval) || interval < 3 || interval > 3600)
      throw error(400, "轮播间隔应为 3 到 3600 秒");
    const paths = body.images.map((item) => item.trim());
    if (paths.some((file) => !path.isAbsolute(file)))
      throw error(400, "请使用映射目录中的绝对路径");
    const publish = async () => {
      const sources = [];
      // Resolve symlinks and check every candidate before creating a new revision.
      for (const source of paths) {
        let file;
        try {
          file = await safeMedia(source, allowed);
        } catch {
          throw error(400, "背景图片不存在或不在媒体、下载映射目录内");
        }
        sources.push({
          file,
          ...(await inspectImage(file, { extension: true })),
        });
      }
      await mkdir(base, { recursive: true });
      await safeMedia(base, [cache]);
      const revision = randomUUID(),
        directory = path.resolve(base, revision);
      if (!inside(base, directory) || path.dirname(directory) !== base)
        throw error(500, "背景资源目录无效");
      await mkdir(directory, { recursive: true });
      try {
        for (const [index, source] of sources.entries()) {
          const target = path.join(directory, String(index));
          await copyFile(source.file, target);
          const copied = await inspectImage(target),
            after = await stat(source.file);
          if (
            copied.format !== source.format ||
            copied.size !== source.size ||
            after.size !== source.size ||
            after.mtimeMs !== source.mtimeMs
          )
            throw error(409, "图片在保存过程中发生变化，请重试");
        }
        const value = {
          revision,
          images: sources.map((_, index) => ({
            url: `/api/backgrounds/${revision}/${index}`,
            revision,
          })),
          intervalSeconds: interval,
        };
        // Private source paths follow the immutable revision; the public manifest has no paths.
        store.set("background:paths:" + revision, paths);
        store.set("background", value);
      } catch (cause) {
        if (
          path.dirname(path.resolve(directory)) !== base ||
          !revisionPattern.test(path.basename(directory))
        )
          throw cause;
        await rm(directory, { recursive: true, force: true });
        throw cause;
      }
      emit("library", {});
      return settings();
    };
    const pending = publishing.then(publish);
    publishing = pending.catch(() => {});
    res.json(await pending);
  });
  app.get("/api/backgrounds/:revision/:index", member, async (req, res) => {
    if (
      !revisionPattern.test(req.params.revision) ||
      !/^([0-9]|1[0-9])$/.test(req.params.index)
    )
      throw error(404, "背景图片不存在");
    const directory = path.resolve(base, req.params.revision),
      target = path.resolve(directory, req.params.index);
    if (path.dirname(directory) !== base || path.dirname(target) !== directory)
      throw error(404, "背景图片不存在");
    let file;
    try {
      await safeMedia(base, [cache]);
      file = await safeMedia(target, [base]);
    } catch {
      throw error(404, "背景图片不存在");
    }
    let image;
    try {
      image = await inspectImage(file);
    } catch {
      throw error(404, "背景图片不存在或不可读取");
    }
    res
      .type(types[image.format])
      .set({
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      })
      .sendFile(file);
  });
}
