import { migrateSongAssets } from "../assets.js";
import path from "node:path";
import os from "node:os";
import QRCode from "qrcode";
import { safeMedia } from "../media.js";

import { fail } from "../http-utils.js";

export function mediaApi({
  app,
  admin,
  member,
  store,
  db,
  get,
  set,
  cache,
  legacyCache,
  dir,
  roots,
  downloads,
  addJob,
  work,
  emit,
  enqueue,
  snapshot,
  allowedOrigin,
}) {
  app.get("/api/media/:id/:variant", member, async (req, res) => {
    if (
      !/^[a-f0-9]{24}$/.test(req.params.id) ||
      !["backing", "vocal"].includes(req.params.variant)
    )
      throw fail(404, "资源不存在");
    const song = db
      .prepare("SELECT * FROM songs WHERE id=?")
      .get(req.params.id);
    if (!song || song.status !== "ready") throw fail(404, "歌曲未就绪");
    if (!store.readOnlyMedia)
      await migrateSongAssets(song.id, legacyCache, cache);
    res.sendFile(
      path.join(
        cache,
        `${song.id}-${song.mode === "original" ? "vocal" : song.mode === "instrumental" ? "backing" : req.params.variant}.mp4`,
      ),
    );
  });
  app.get("/api/poster/:id", member, async (req, res) => {
    const song = db
      .prepare("SELECT poster FROM songs WHERE id=?")
      .get(req.params.id);
    if (!song?.poster) throw fail(404, "没有海报");
    res.sendFile(
      await safeMedia(song.poster, [
        ...roots,
        downloads,
        path.join(dir, "downloads"),
        path.join(dir, "posters"),
      ]),
    );
  });
  app.get("/api/join", member, async (req, res) => {
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((n) => n?.family === "IPv4" && !n.internal)?.address;
    const configured = get("publicUrl", "");
    const browserOrigin = allowedOrigin(req, req.query.origin)
      ? req.query.origin
      : "";
    const base =
      configured ||
      browserOrigin ||
      (req.hostname === "localhost" || req.hostname === "127.0.0.1"
        ? `http://${lan || req.hostname}:${process.env.PORT || 3210}`
        : `${req.protocol}://${req.get("host")}`);
    const url = `${base.replace(/\/$/, "")}/control#${get("roomToken")}`;
    res.json({
      url,
      qr: await QRCode.toDataURL(url, { width: 220, margin: 2 }),
      configured: !!configured,
    });
  });
}
