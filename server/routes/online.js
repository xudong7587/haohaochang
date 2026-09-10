import { videoQuality } from "../../shared/video-quality.js";
import { canonicalVideo, onlineSearch } from "../media.js";
import { canEnqueue } from "../resource-manifest.js";

import { fail, clean } from "../http-utils.js";
import { searchSongs } from "../online-search.js";
import { previewSessions } from "../online-preview.js";
import { clipRange } from "../clipping.js";
import { biliLoginStatus } from "../bili-login.js";
import { requireDownloadHeight } from "../bili-download.js";

export function onlineApi({
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
  const previews = previewSessions();
  let loginCache;
  app.get("/api/online/bilibili/status", member, async (req, res) => {
    const cookie = get("favorites", {}).cookie || "";
    if (
      !loginCache ||
      loginCache.cookie !== cookie ||
      loginCache.expires < Date.now()
    )
      loginCache = {
        cookie,
        expires: Date.now() + 60000,
        value: await biliLoginStatus(cookie),
      };
    res.json({
      loggedIn: loginCache.value.loggedIn,
      vip: loginCache.value.vip,
    });
  });
  app.get("/api/online/songs", member, async (req, res) => {
    if (!get("onlineEnabled", true))
      throw fail(
        403,
        "在线搜索已手动关闭，请到“设置与任务 → 在线资源”重新启用。",
      );
    const title = clean(req.query.title),
      artist = clean(req.query.artist),
      page = Number(req.query.page || 1);
    if (!title || !Number.isInteger(page) || page < 1 || page > 20)
      throw fail(400, "请填写歌名和有效页码");
    res.json(
      await searchSongs(title, artist, get("favorites", {}).cookie, page),
    );
  });
  app.post("/api/online/preview", member, async (req, res) => {
    if (!get("onlineEnabled", true))
      throw fail(
        403,
        "在线搜索已手动关闭，请到“设置与任务 → 在线资源”重新启用。",
      );
    res.json(
      await previews.create(
        canonicalVideo(req.body.url),
        get("favorites", {}).cookie,
        dir,
        {
          refresh: req.body.refresh === true,
          quality: videoQuality(req.body.quality),
        },
      ),
    );
  });
  app.get("/api/online/preview/:id/:track", member, async (req, res) => {
    if (!get("onlineEnabled", true)) throw fail(403, "在线资源已关闭");
    await previews.stream(req, res);
  });
  app.post("/api/requests", member, (req, res) => {
    if (!get("onlineEnabled", true))
      throw fail(
        403,
        "在线搜索已手动关闭，请到“设置与任务 → 在线资源”重新启用。",
      );
    const title = clean(req.body.title),
      artist = clean(req.body.artist);
    if (!title) throw fail(400, "请填写歌名");
    const local = db
      .prepare(
        "SELECT * FROM songs WHERE title=? AND artist=? AND status='ready' AND mode IN ('separated','tracks','channels') AND lyrics!=''",
      )
      .all(title, artist)
      .find((song) => canEnqueue(store, song, cache));
    if (local) {
      enqueue(local.id, clean(req.body.name) || "家人");
      return res.json({ id: local.id, local: true });
    }
    if (
      db
        .prepare(
          "SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running','waiting-worker') AND (kind IN ('acquire','download') OR json_extract(payload,'$.priority')='online')",
        )
        .get().n >= 200
    )
      throw fail(429, "在线任务已达到 200 项，请等待部分任务完成");
    res.json({
      id: addJob("acquire", {
        title,
        artist,
        enqueue: true,
        name: clean(req.body.name) || "家人",
      }),
    });
  });
  app.get("/api/online", member, async (req, res) => {
    if (!get("onlineEnabled", true))
      throw fail(
        403,
        "在线搜索已手动关闭，请到“设置与任务 → 在线资源”重新启用。",
      );
    const query = clean(req.query.q);
    if (query.length < 2) throw fail(400, "至少输入两个字");
    res.json(
      await onlineSearch(
        /伴奏|karaoke|instrumental/i.test(query) ? query : `${query} 伴奏 KTV`,
        req.query.provider === "bilibili" ? "bilibili" : "youtube",
      ),
    );
  });
  app.post("/api/online", member, async (req, res) => {
    if (!get("onlineEnabled", true))
      throw fail(
        403,
        "在线搜索已手动关闭，请到“设置与任务 → 在线资源”重新启用。",
      );
    if (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running','waiting-worker') AND (kind IN ('acquire','download') OR json_extract(payload,'$.priority')='online')",
        )
        .get().n >= 200
    )
      throw fail(429, "在线任务已达到 200 项，请等待部分任务完成");
    const payload = {
      url: canonicalVideo(req.body.url),
      quality: videoQuality(req.body.quality),
      title: clean(req.body.title) || "在线歌曲",
      artist: clean(req.body.artist) || "未知歌手",
      enqueue: !!req.body.enqueue,
      name: clean(req.body.name, 24) || "家人",
      isBacking: req.body.isBacking === true,
    };
    if (req.body.onlineSelection === true) {
      if (!clean(req.body.title) || !clean(req.body.artist))
        throw fail(400, "请填写歌名和歌手");
      if (get("ai", {}).enabled === false)
        throw fail(400, "请先启用 PC 整理与伴奏分离");
      payload.onlineSelection = true;
      payload.isBacking = false;
      payload.enqueue = false;
      if (req.body.previewId) {
        const selected = previews.lookup(req.body.previewId);
        if (
          selected.url !== payload.url ||
          selected.quality !== payload.quality
        )
          throw fail(400, "清晰度预览已变化，请重新预览");
        payload.expectedHeight =
          selected.downloadHeight || selected.previewHeight || 0;
        if (payload.expectedHeight)
          requireDownloadHeight(payload.expectedHeight, payload.quality);
      }
      if (req.body.clip) {
        const preview = previews.lookup(req.body.previewId);
        if (preview.url !== payload.url)
          throw fail(400, "标记区间不属于当前视频");
        payload.clip = clipRange(req.body.clip, preview.duration);
      }
    }
    res.json({ id: addJob("download", payload) });
  });
}
