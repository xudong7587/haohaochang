import { assertSongIdle, currentSong, checkRevision } from "../song-writes.js";
import { normalizeTags } from "../../shared/tags.js";
import { metadata } from "../library.js";
import { randomUUID } from "node:crypto";
import { canonicalVideo } from "../media.js";

import { fail, equal, clean } from "../http-utils.js";

export function reviewsApi({
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
  const reviewList = () =>
    db
      .prepare(
        "SELECT id,kind,payload,error,created FROM jobs WHERE status='review' ORDER BY created",
      )
      .all()
      .map((j) => {
        const p = JSON.parse(j.payload);
        return {
          id: j.id,
          kind: j.kind,
          songId: p.id || p.existingId,
          expectedRevision:
            p.id || p.existingId
              ? currentSong(store, p.id || p.existingId).metadataRevision
              : undefined,
          candidatePath: p.candidatePath || "",
          candidate: p.candidate,
          file: p.file,
          ...(p.localIntake && !p.id
            ? { intakeStage: "staged", tier: "audio" }
            : {}),
          localIntakeAvailable:
            j.kind === "import" &&
            !p.localIntake &&
            !p.id &&
            !p.existingId &&
            !p.candidate &&
            !p.sourceUrl &&
            !p.url &&
            !p.onlineSelection &&
            !p.replacementUrl,
          title: p.metadata?.title || p.title || "",
          artist: p.metadata?.artist || p.artist || "",
          tags: p.metadata?.tags || [],
          lyrics: p.metadata?.lyrics || "",
          lyricsSource: p.metadata?.lyricsSource,
          note: j.error,
          sourceUrl: p.candidate?.canonicalUrl || p.sourceUrl || p.url || "",
          created: j.created,
        };
      });
  function resolveReview(req, res) {
    const job = db
      .prepare("SELECT * FROM jobs WHERE id=? AND status='review'")
      .get(req.params.id);
    if (!job) throw fail(409, "该任务已处理或不存在");
    const payload = JSON.parse(job.payload),
      songId = payload.id || payload.existingId;
    if (songId) {
      assertSongIdle(store, songId);
      checkRevision(currentSong(store, songId), req.body.expectedRevision);
    }
    if (job.kind === "find-video") {
      const action = req.body.dismissed
        ? "reject"
        : req.body.action || "confirm";
      if (!["confirm", "reject", "research"].includes(action))
        throw fail(400, "请选择确认、拒绝或重新搜索");
      if (action === "confirm" && req.body.confirmed !== true)
        throw fail(400, "请先确认录音版本与偏移");
      const sourceUrl = req.body.sourceUrl
        ? canonicalVideo(req.body.sourceUrl)
        : undefined;
      const changed =
        sourceUrl &&
        sourceUrl !== (payload.candidate?.canonicalUrl || payload.sourceUrl);
      const next = {
        ...payload,
        action,
        confirmed: action === "confirm",
        approved: false,
        offset: Number(req.body.offset) || 0,
        expectedRevision: currentSong(store, songId).metadataRevision,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(changed ? { candidate: undefined, candidatePath: undefined } : {}),
      };
      if (action === "research") {
        delete next.candidate;
        delete next.candidatePath;
        delete next.sourceUrl;
        delete next.url;
      }
      db.prepare(
        "UPDATE jobs SET status='queued',payload=?,error='' WHERE id=?",
      ).run(JSON.stringify(next), job.id);
    } else {
      const title = clean(req.body.title),
        artist = clean(req.body.artist);
      if (!title || !artist || artist === "未知歌手")
        throw fail(400, "请填写歌手和歌名");
      const next = {
        ...payload,
        ...(songId
          ? { expectedRevision: currentSong(store, songId).metadataRevision }
          : {}),
        replacementUrl:
          job.kind === "import" &&
          req.body.sourceUrl &&
          req.body.sourceUrl !== payload.sourceUrl
            ? canonicalVideo(req.body.sourceUrl)
            : payload.replacementUrl,
        sourceUrl: req.body.sourceUrl
          ? canonicalVideo(req.body.sourceUrl)
          : payload.sourceUrl,
        approved: true,
        metadata: {
          ...payload.metadata,
          lyrics: String(
            req.body.lyrics ?? payload.metadata?.lyrics ?? "",
          ).slice(0, 25000),
          lyricsSource: req.body.lyricsSource || payload.metadata?.lyricsSource,
          title,
          artist,
          tags: normalizeTags(req.body.tags),
          needs_review: 0,
          metadata_source: "手动",
        },
      };
      db.prepare(
        "UPDATE jobs SET status='queued',payload=?,error='' WHERE id=?",
      ).run(JSON.stringify(next), job.id);
    }
    // An explicit review decision is a new intent. Crash retries keep phase
    // checkpoints, while changed user input must execute those phases again.
    db.prepare("DELETE FROM settings WHERE key LIKE ? ESCAPE '!'").run(
      "publication:" + job.id.replace(/[%_!]/g, "!$&") + ":%",
    );
    setImmediate(work);
    emit("library", {});
    res.json({ ok: true });
  }
  app.get("/api/admin/reviews", admin, (req, res) => res.json(reviewList()));
  app.post("/api/admin/reviews/:id", admin, resolveReview);
  app.get("/api/admin/integration", admin, (req, res) => {
    if (!get("integrationToken"))
      set("integrationToken", randomUUID() + randomUUID());
    res.json({ token: get("integrationToken") });
  });
  const integration = (req, res, next) =>
    get("integrationToken") &&
    equal(
      req.get("authorization")?.replace(/^Bearer /, ""),
      get("integrationToken"),
    )
      ? next()
      : next(fail(401, "管理集成凭证无效"));
  app.get("/api/integrations/reviews", integration, (req, res) =>
    res.json(reviewList()),
  );
  app.post("/api/integrations/reviews/:id", integration, resolveReview);
  return resolveReview;
}
