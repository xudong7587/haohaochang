import { withSongWrite } from "../song-writes.js";
import { saveSongMetadata } from "../song-metadata.js";
import { replaceVideo } from "../video-replacement.js";
import { normalizeTags } from "../../shared/tags.js";
import { metadata } from "../library.js";
import path from "node:path";
import { probe, safeMedia } from "../media.js";

import { fail, clean } from "../http-utils.js";

export function legacyLibraryApi({
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
  app.post("/api/admin/import-settings", admin, (req, res) => {
    set("autoImport", req.body.enabled === true);
    res.json({ ok: true });
  });
  app.get("/api/admin/organize", admin, async (req, res) => {
    const rows = db
      .prepare(
        "SELECT id,path,title,artist,metadataRevision,metadata_source,tags,tags_manual FROM songs ORDER BY created DESC LIMIT 500",
      )
      .all();
    const results = [];
    for (const song of rows) {
      try {
        const meta = await metadata(song.path, [
          ...roots,
          downloads,
          path.join(dir, "downloads"),
        ]);
        results.push({
          id: song.id,
          expectedRevision: song.metadataRevision,
          oldTitle: song.title,
          oldArtist: song.artist,
          ...meta,
          tags: song.tags_manual ? JSON.parse(song.tags) : meta.tags,
          poster: !!meta.poster,
        });
      } catch (e) {
        results.push({
          id: song.id,
          expectedRevision: song.metadataRevision,
          oldTitle: song.title,
          oldArtist: song.artist,
          title: song.title,
          artist: song.artist,
          error: e.message,
        });
      }
    }
    res.json(results);
  });
  app.post("/api/admin/organize", admin, async (req, res) => {
    const rows = req.body.songs;
    if (!Array.isArray(rows) || rows.length > 500)
      throw fail(400, "每次最多整理 500 首");
    const results = [];
    for (const row of rows) {
      try {
        const song = await saveSongMetadata(
          store,
          row.id,
          {
            title: clean(row.title),
            artist: clean(row.artist),
            expectedRevision: row.expectedRevision,
            tags: JSON.stringify(normalizeTags(row.tags)),
            tags_manual: 1,
            metadata_source: "手动",
            needs_review: clean(row.artist) === "未知歌手" ? 1 : 0,
          },
          cache,
        );
        if (req.body.prepare) addJob("prepare", { id: row.id });
        results.push({
          id: row.id,
          ok: true,
          metadataRevision: song.metadataRevision,
        });
      } catch (e) {
        results.push({ id: row.id, ok: false, error: e.message, code: e.code });
      }
    }
    emit("library", {});
    res.json({
      ok: results.every((r) => r.ok),
      count: results.filter((r) => r.ok).length,
      results,
    });
  });
  app.post("/api/admin/scan", admin, (req, res) =>
    res.json({ id: addJob("scan", {}) }),
  );
  app.post("/api/admin/jobs/:id/retry", admin, (req, res) => {
    const job = db.prepare("SELECT * FROM jobs WHERE id=?").get(req.params.id);
    if (!job || !["failed", "waiting-worker"].includes(job.status))
      throw fail(409, "仅失败或等待 PC 的任务可重试");
    db.prepare("UPDATE jobs SET status='queued',error='' WHERE id=?").run(
      job.id,
    );
    setImmediate(work);
    res.json({ ok: true });
  });
  app.post("/api/admin/songs/:id/probe", admin, async (req, res) => {
    const song = db
      .prepare("SELECT * FROM songs WHERE id=?")
      .get(req.params.id);
    if (!song) throw fail(404, "歌曲不存在");
    const info = await probe(
      await safeMedia(song.path, [
        ...roots,
        downloads,
        path.join(dir, "downloads"),
      ]),
    );
    res.json(info);
  });
  app.put("/api/admin/songs/:id/lyrics", admin, async (req, res) => {
    const song = await saveSongMetadata(
      store,
      req.params.id,
      {
        lyrics: clean(req.body.lyrics, 25000),
        expectedRevision: req.body.expectedRevision,
      },
      cache,
    );
    emit("library", {});
    emit();
    res.json({ ok: true, metadataRevision: song.metadataRevision });
  });
  app.post("/api/admin/songs/:id/replace", admin, async (req, res) => {
    const song = db
      .prepare("SELECT * FROM songs WHERE id=?")
      .get(req.params.id);
    if (!song) throw fail(404, "歌曲不存在");
    await withSongWrite(
      store,
      song.id,
      async () => {
        if (db.prepare("SELECT id FROM queue WHERE song_id=?").get(song.id))
          throw fail(409, "请先移出播放队列");
        const file = await safeMedia(clean(req.body.path, 1000), roots);
        await replaceVideo(store, song, file, "local", cache, {
          confirmed: req.body.confirmed === true,
          offset: req.body.offset,
        });
      },
      {
        expectedRevision: req.body.expectedRevision,
        required: true,
        idle: true,
      },
    );
    res.json({ ok: true });
  });
  app.patch("/api/admin/songs/:id", admin, async (req, res) => {
    const song = db
      .prepare("SELECT * FROM songs WHERE id=?")
      .get(req.params.id);
    if (!song) throw fail(404, "歌曲不存在");
    if (
      db.prepare("SELECT id FROM queue WHERE song_id=?").get(song.id) ||
      db
        .prepare(
          "SELECT payload FROM jobs WHERE kind='prepare' AND status IN ('queued','running')",
        )
        .all()
        .some((j) => JSON.parse(j.payload).id === song.id)
    )
      throw fail(409, "歌曲正在排队或处理中，请结束后再编辑");
    const title = clean(req.body.title),
      artist = clean(req.body.artist),
      mode = req.body.mode;
    const backing = Number(req.body.backing),
      vocal = Number(req.body.vocal);
    if (
      !title ||
      !artist ||
      !["original", "instrumental", "tracks", "channels", "separated"].includes(
        mode,
      ) ||
      (mode === "separated" && song.mode !== "separated") ||
      ![backing, vocal].every((n) => Number.isInteger(n) && n >= 0 && n < 32) ||
      (mode === "channels" && (backing > 1 || vocal > 1 || backing === vocal))
    )
      throw fail(400, "请检查歌曲名称和音轨配置");
    const changed =
      song.mode !== mode || song.backing !== backing || song.vocal !== vocal;
    const updated = await saveSongMetadata(
      store,
      song.id,
      {
        title,
        artist,
        mode,
        backing,
        vocal,
        lyrics: req.body.lyrics,
        status: changed ? "new" : song.status,
        metadata_source: "手动",
        needs_review: artist === "未知歌手" ? 1 : 0,
        expectedRevision: req.body.expectedRevision,
      },
      cache,
    );
    emit("library", {});
    res.json({ ok: true, metadataRevision: updated.metadataRevision });
  });
  app.post("/api/admin/songs/:id/prepare", admin, (req, res) => {
    if (!db.prepare("SELECT id FROM songs WHERE id=?").get(req.params.id))
      throw fail(404, "歌曲不存在");
    if (db.prepare("SELECT id FROM queue WHERE song_id=?").get(req.params.id))
      throw fail(409, "请先从队列移除歌曲");
    res.json({ id: addJob("prepare", { id: req.params.id }) });
  });
}
