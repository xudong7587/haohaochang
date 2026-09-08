import { canonicalVideo, onlineSearch } from "../media.js";
import { canEnqueue } from "../resource-manifest.js";

import { fail, clean } from "../http-utils.js";

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
  app.post("/api/requests", member, (req, res) => {
    if (!get("onlineEnabled", false)) throw fail(403, "请先在后台启用在线资源");
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
          "SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')",
        )
        .get().n >= 20
    )
      throw fail(429, "后台任务已满");
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
    if (!get("onlineEnabled", false)) throw fail(403, "请先在后台启用在线资源");
    const query = clean(req.query.q);
    if (query.length < 2) throw fail(400, "至少输入两个字");
    res.json(
      await onlineSearch(
        /伴奏|karaoke|instrumental/i.test(query) ? query : `${query} 伴奏 KTV`,
        req.query.provider === "bilibili" ? "bilibili" : "youtube",
      ),
    );
  });
  app.post("/api/online", member, (req, res) => {
    if (!get("onlineEnabled", false)) throw fail(403, "请先在后台启用在线资源");
    if (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')",
        )
        .get().n >= 20
    )
      throw fail(429, "后台任务已满");
    const payload = {
      url: canonicalVideo(req.body.url),
      title: clean(req.body.title) || "在线歌曲",
      artist: clean(req.body.artist) || "未知歌手",
      enqueue: !!req.body.enqueue,
      name: clean(req.body.name, 24) || "家人",
      isBacking: req.body.isBacking === true,
    };
    res.json({ id: addJob("download", payload) });
  });
}
