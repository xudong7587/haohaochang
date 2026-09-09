import { randomUUID } from "node:crypto";
import { inspectPackage } from "./resource-health.js";
import { createSourceCandidate } from "../shared/source-candidate.js";
import { previewSourceCandidate } from "./sources.js";
import {
  resourceManifest,
  canEnqueue,
  resourceNames,
} from "./resource-manifest.js";
import { assertSongIdle, currentSong, checkRevision } from "./song-writes.js";
import { saveSongMetadata } from "./song-metadata.js";
import path from "node:path";
import { stat } from "node:fs/promises";
import {
  libraryTier,
  packageDir,
  present,
  savePackageInfo,
} from "./song-package.js";
import { sourceMetadata, canonicalVideo } from "./sources.js";
import {
  catalogSeed,
  identifyTitle,
  identifyVideo,
} from "../shared/catalog.js";
import { findLyrics } from "./lyrics-source.js";
import { searchText, safeMedia } from "./media-utils.js";
import { filesUnder, importKey, metadata } from "./library.js";
import { enrichSong } from "./enrichment.js";
export function libraryApi({
  app,
  admin,
  member,
  store,
  cache,
  downloads,
  addJob,
  emit,
}) {
  const { db, get, set } = store;
  const previews = new Map();
  const assertIdle = (id) => assertSongIdle(store, id);
  app.post("/api/admin/library/:id/organize", admin, (req, res) => {
    const song = db
      .prepare("SELECT * FROM songs WHERE id=?")
      .get(req.params.id);
    if (!song) throw new Error("歌曲不存在");
    assertIdle(song.id);
    checkRevision(song, req.body.expectedRevision, false);
    if (db.prepare("SELECT id FROM queue WHERE song_id=?").get(song.id))
      throw new Error("请先移出播放队列");
    const known =
      song.title?.trim() && song.artist?.trim() && song.artist !== "未知歌手";
    res.json({
      id: addJob("organize", {
        id: song.id,
        approved: !!known,
        ...(known
          ? {
              metadata: {
                title: song.title,
                artist: song.artist,
                lyrics: song.lyrics || "",
                needs_review: 0,
              },
            }
          : {}),
      }),
    });
  });
  app.post("/api/admin/refresh-metadata", admin, async (req, res) => {
    const song = req.body.id
      ? db.prepare("SELECT * FROM songs WHERE id=?").get(req.body.id)
      : null;
    const title = String(req.body.title || song?.title || "").trim(),
      artist = String(req.body.artist || song?.artist || "").trim();
    let result;
    if (req.body.url) {
      const source = await sourceMetadata(
        req.body.url,
        get("favorites", {}).cookie,
      );
      result = {
        ...identifyVideo(source),
        sourceTitle: source.title,
        duration: source.duration,
      };
    } else result = identifyTitle(title + " - " + artist);
    if (result.needs_review && get("enrichment", {}).enabled)
      result = await enrichSong(get("enrichment"), {
        title,
        artist,
        sourceUrl: req.body.url || "",
      });
    res.json({
      ...result,
      note: result.needs_review
        ? "无法可靠确认，请手动核对歌名和歌手"
        : "已匹配歌名与歌手，保存后生效",
    });
  });
  app.get("/api/admin/library", admin, async (req, res) => {
    const rows = db
      .prepare("SELECT * FROM songs ORDER BY created DESC")
      .all()
      .filter((s) => !!get("hidden:" + s.id) === (req.query.hidden === "true"));
    const result = await Promise.all(
      rows.map(async (row) => {
        if (get("package-ready:" + row.id) && get("package:" + row.id))
          await inspectPackage(store, row, get("package:" + row.id));
        const s = currentSong(store, row.id),
          manifest = resourceManifest(store, s, cache);
        return {
          ...s,
          tier: manifest.tier,
          manifest,
          missing: manifest.missing,
          lyricsSource: get("lyrics-match:" + s.id, null),
          sourceUrl:
            get("video-source:" + s.id)?.url ||
            get("source:" + s.id)?.canonicalUrl ||
            get("source:" + s.id)?.url ||
            "",
          folder: get("package:" + s.id, "尚未生成新格式"),
        };
      }),
    );
    res.json(result);
  });
  app.get("/api/catalog", member, (req, res) => {
    const q = String(req.query.q || "").toLowerCase();
    const entries = [...catalogSeed, ...get("catalog", [])];
    const unique = [
      ...new Map(entries.map((s) => [s.artist + "\0" + s.title, s])).values(),
    ];
    res.json(
      unique
        .filter((s) => searchText(s.title, s.artist).includes(q))
        .slice(0, 300)
        .map((s) => ({
          ...s,
          localId:
            db
              .prepare("SELECT * FROM songs WHERE title=? AND artist=?")
              .all(s.title, s.artist)
              .find((song) => canEnqueue(store, song, cache))?.id || null,
        })),
    );
  });
  app.post("/api/admin/catalog", admin, (req, res) => {
    const rows = req.body.songs;
    if (
      !Array.isArray(rows) ||
      rows.length > 1000 ||
      rows.some(
        (s) =>
          typeof s.title !== "string" ||
          typeof s.artist !== "string" ||
          !s.title.trim() ||
          !s.artist.trim(),
      )
    )
      throw new Error(
        "请导入包含 title、artist 的 JSON 数组，每批最多 1000 首",
      );
    set("catalog", [
      ...get("catalog", []),
      ...rows.map((s) => ({
        title: s.title.trim().slice(0, 120),
        artist: s.artist.trim().slice(0, 120),
      })),
    ]);
    res.json({ ok: true });
  });
  app.post("/api/admin/source-info", admin, async (req, res) => {
    let candidate = await previewSourceCandidate(
      req.body.url,
      get("favorites", {}).cookie,
    );
    if (candidate.identity.needs_review && get("enrichment", {}).enabled) {
      const parsed = await enrichSong(get("enrichment"), {
        title: candidate.externalTitle,
        sourceUrl: candidate.canonicalUrl,
      });
      candidate = createSourceCandidate(
        {
          ...candidate,
          reviewReasons: [],
          evidence: [...candidate.evidence, ...(parsed.evidence || [])],
        },
        parsed,
      );
    }
    const candidateId = randomUUID();
    previews.set(candidateId, { candidate, created: Date.now() });
    if (previews.size > 200) previews.delete(previews.keys().next().value);
    res.json({
      ...candidate.identity,
      videoTitle: candidate.externalTitle,
      duration: candidate.duration,
      url: candidate.canonicalUrl,
      candidate,
      candidateId,
    });
  });
  app.get("/api/admin/inbox", admin, async (req, res) => {
    const handled = db
      .prepare(
        "SELECT id,payload,status,stage FROM jobs WHERE kind='import' AND status IN ('review','running','queued','waiting-worker')",
      )
      .all()
      .map((j) => ({ ...j, payload: JSON.parse(j.payload) }));
    const rows = [];
    for (const file of await filesUnder(downloads)) {
      try {
        const info = await stat(file);
        const job = handled.find((j) => j.payload.file === file);
        if (get(importKey(file, info)) || job?.status === "review") continue;
        rows.push({
          id: importKey(file, info),
          file,
          inbox: true,
          ...(await metadata(file, [downloads])),
          ...(job?.payload.metadata || {}),
          processing: !!job,
          status: job?.status || "import",
          jobId: job?.id,
          note: job
            ? {
                queued: "已加入整理队列",
                running: "正在整理，完成后自动更新",
                "waiting-worker": "等待 PC 上线后继续",
              }[job.status]
            : "下载工作区 · 等待信息完整和文件稳定",
          lyrics: "",
        });
      } catch (error) {
        rows.push({
          id: file,
          file,
          inbox: true,
          title: path.basename(file),
          artist: "未知歌手",
          note: "读取失败：" + error.message,
        });
      }
    }
    res.json(rows);
  });
  app.post("/api/admin/inbox", admin, async (req, res) => {
    const file = await safeMedia(String(req.body.file || ""), [downloads]),
      info = await stat(file);
    const existing = db
      .prepare(
        "SELECT id,payload,status FROM jobs WHERE kind='import' AND status IN ('queued','running','review','waiting-worker')",
      )
      .all()
      .find((j) => JSON.parse(j.payload).file === file);
    if (existing) {
      if (existing.status === "review")
        throw new Error("媒体已进入待核对，请刷新后从待核对项目继续");
      return res.json({ id: existing.id, existing: true });
    }
    const title = String(req.body.title || "")
        .trim()
        .slice(0, 120),
      artist = String(req.body.artist || "")
        .trim()
        .slice(0, 120);
    if (!title || !artist || artist === "未知歌手")
      throw new Error("请填写歌名和歌手");
    const replacementUrl = req.body.sourceUrl
      ? canonicalVideo(req.body.sourceUrl)
      : undefined;
    res.json({
      id: addJob("import", {
        file,
        signature: info.size + ":" + info.mtimeMs,
        replacementUrl,
        approved: true,
        metadata: {
          title,
          artist,
          lyrics: replacementUrl
            ? ""
            : String(req.body.lyrics || "").slice(0, 25000),
          tags: [],
          needs_review: 0,
          metadata_source: "手动",
        },
      }),
    });
  });
  app.post("/api/admin/inbox-link", admin, async (req, res) => {
    const url = canonicalVideo(req.body.url);
    let candidate;
    if (req.body.candidateId) {
      const preview = previews.get(req.body.candidateId);
      if (!preview || Date.now() - preview.created > 3600000)
        throw new Error("链接预览已过期，请重新解析");
      candidate = preview.candidate;
      if (candidate.canonicalUrl !== url)
        throw new Error("链接与已预览候选不一致，请重新解析");
    } else
      candidate = await previewSourceCandidate(
        url,
        get("favorites", {}).cookie,
      );
    res.json({
      id: addJob("download", {
        url,
        title: candidate.externalTitle,
        candidate,
        enqueue: false,
      }),
    });
  });
  app.post("/api/admin/migrate-packages", admin, (req, res) => {
    const rows = db
      .prepare("SELECT id FROM songs WHERE status='ready'")
      .all()
      .filter(
        (s) =>
          !get("package-ready:" + s.id) &&
          !db.prepare("SELECT id FROM queue WHERE song_id=?").get(s.id),
      );
    for (const row of rows) addJob("prepare", { id: row.id });
    res.json({ count: rows.length });
  });
  app.post("/api/admin/find-lyrics", admin, async (req, res) =>
    res.json(
      await findLyrics(
        req.body.title,
        req.body.artist,
        Number(req.body.duration) || 0,
      ),
    ),
  );
  app.get("/api/lyrics-style", member, (req, res) =>
    res.json(
      get("lyricsStyle", {
        font: "sans-serif",
        size: 48,
        color: "#ffd66e",
        offset: 0,
      }),
    ),
  );
  app.post("/api/admin/lyrics-style", admin, (req, res) => {
    const v = req.body;
    const value = {
      font: String(v.font || "sans-serif")
        .replace(/[^\p{L}\p{N}\s,_-]/gu, "")
        .slice(0, 120),
      size: Math.max(24, Math.min(90, Number(v.size) || 48)),
      color: /^#[a-f0-9]{6}$/i.test(v.color) ? v.color : "#ffd66e",
      offset: Math.max(-10, Math.min(10, Number(v.offset) || 0)),
    };
    set("lyricsStyle", value);
    res.json(value);
  });
  app.get("/api/playback-assets/:id", member, async (req, res) => {
    const song = db
      .prepare("SELECT * FROM songs WHERE id=?")
      .get(req.params.id);
    if (!song) throw new Error("歌曲不存在");
    if (get("package-ready:" + song.id) && get("package:" + song.id))
      await inspectPackage(store, song, get("package:" + song.id));
    res.json(resourceManifest(store, currentSong(store, song.id), cache));
  });
  app.get("/api/assets/:id/:kind", member, async (req, res) => {
    const names = {
      video: "画面.mp4",
      vocal: "原唱.m4a",
      backing: "伴奏.m4a",
      lyrics: "歌词.lrc",
    };
    const song = db
      .prepare("SELECT * FROM songs WHERE id=?")
      .get(req.params.id);
    if (!song || !names[req.params.kind]) throw new Error("资源不存在");
    const revision =
      req.query.r === undefined ? song.resourceRevision : Number(req.query.r);
    const dir =
      revision === song.resourceRevision
        ? get("package:" + song.id)
        : get("package-version:" + song.id + ":" + revision);
    if (!dir) throw Object.assign(new Error("资源版本不存在"), { status: 404 });
    res.sendFile(
      await safeMedia(path.join(dir, names[req.params.kind]), [cache]),
    );
  });
  app.post("/api/admin/library/:id/save", admin, async (req, res) => {
    const song = db
      .prepare("SELECT * FROM songs WHERE id=?")
      .get(req.params.id);
    if (!song) throw new Error("歌曲不存在");
    assertIdle(song.id);
    if (db.prepare("SELECT id FROM queue WHERE song_id=?").get(song.id))
      throw new Error("请先将歌曲移出播放队列");
    const title = String(req.body.title || "")
        .trim()
        .slice(0, 120),
      artist = String(req.body.artist || "")
        .trim()
        .slice(0, 120),
      lyrics = String(req.body.lyrics || "").slice(0, 25000);
    if (!title || !artist) throw new Error("请填写歌名和歌手");
    const updated = await saveSongMetadata(
      store,
      song.id,
      {
        title,
        artist,
        lyrics,
        lyricsSource: req.body.lyricsSource || {
          source: "手动 LRC",
          offsetUnit: "milliseconds",
        },
        expectedRevision: req.body.expectedRevision,
        metadata_source: "手动",
        needs_review: 0,
      },
      cache,
    );
    if (req.body.prepare) addJob("organize", { id: song.id });
    emit("library", {});
    res.json({ ok: true, metadataRevision: updated.metadataRevision });
  });
  app.post("/api/admin/library/:id/source", admin, (req, res) => {
    const song = db
      .prepare("SELECT * FROM songs WHERE id=?")
      .get(req.params.id);
    if (!song) throw new Error("歌曲不存在");
    assertIdle(song.id);
    const url = canonicalVideo(req.body.url);
    if (db.prepare("SELECT id FROM queue WHERE song_id=?").get(song.id))
      throw new Error("请先移出播放队列");
    checkRevision(song, req.body.expectedRevision);
    res.json({
      id: addJob("attach-video", {
        id: song.id,
        url,
        confirmed: req.body.confirmed === true,
        offset: Number(req.body.offset) || 0,
      }),
    });
  });
  app.post("/api/admin/library/:id/restore", admin, (req, res) => {
    currentSong(store, req.params.id);
    set("hidden:" + req.params.id, false);
    emit("library", {});
    res.json({ ok: true });
  });
  app.delete("/api/admin/library/:id", admin, (req, res) => {
    if (db.prepare("SELECT id FROM queue WHERE song_id=?").get(req.params.id))
      throw new Error("请先移出播放队列");
    assertIdle(req.params.id);
    set("hidden:" + req.params.id, true);
    emit("library", {});
    res.json({ ok: true, note: "已从曲库隐藏，原始媒体保留，可恢复" });
  });
}
