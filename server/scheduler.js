import { needsPoster } from "./song-poster.js";
import { randomUUID, createHash } from "node:crypto";
import { runJob } from "./jobs.js";
import { cleanImportedDownloads } from "./download-cleanup.js";
import { cleanSongVersions } from "./resource-cleanup.js";
import { songIdFor, currentSong, withSongWrite } from "./song-writes.js";
import { resourceManifest } from "./resource-manifest.js";
export function createScheduler(
  dependencies,
  { enabled = true, execute = runJob, onIdle = () => {} } = {},
) {
  const { db, get, set, store, cache, emit, enqueue } = dependencies;
  let running = 0,
    stopped = false;
  let resolveStop;
  const stoppedPromise = new Promise((resolve) => {
    resolveStop = resolve;
  });
  function finishStop() {
    onIdle();
    resolveStop();
  }
  function addJob(kind, payload) {
    function promote(existing) {
      if (payload.priority === "mobile" || payload.enqueue) {
        const p = JSON.parse(existing.payload);
        db.prepare("UPDATE jobs SET payload=? WHERE id=?").run(
          JSON.stringify({
            ...p,
            ...(payload.priority === "mobile"
              ? { priority: "mobile", requestId: p.requestId || existing.id }
              : {}),
            ...(payload.enqueue ? { enqueue: true, name: payload.name } : {}),
          }),
          existing.id,
        );
        emit();
        setImmediate(work);
      }
      return existing.id;
    }
    if (kind === "acquire") {
      const existing = db
        .prepare(
          "SELECT id,payload FROM jobs WHERE kind='acquire' AND status IN ('queued','running','review')",
        )
        .all()
        .find((j) => {
          const p = JSON.parse(j.payload);
          return p.title === payload.title && p.artist === payload.artist;
        });
      if (existing) return promote(existing);
    }
    if (["download", "favorite-download"].includes(kind)) {
      const duplicate = db
        .prepare(
          "SELECT id,payload FROM jobs WHERE kind IN ('download','favorite-download') AND status IN ('queued','running','waiting-worker')",
        )
        .all()
        .find((j) => {
          const p = JSON.parse(j.payload);
          return (
            p.url === payload.url &&
            (p.quality || "legacy") === (payload.quality || "legacy") &&
            JSON.stringify(p.clip || null) ===
              JSON.stringify(payload.clip || null) &&
            (p.title || "") === (payload.title || "") &&
            (p.artist || "") === (payload.artist || "")
          );
        });
      if (duplicate) {
        return promote(duplicate);
      }
    }
    if (kind === "prepare") {
      const duplicate = db
        .prepare(
          "SELECT id,payload FROM jobs WHERE kind='prepare' AND status IN ('queued','running')",
        )
        .all()
        .find((j) => JSON.parse(j.payload).id === payload.id);
      if (duplicate) {
        if (!payload.ambientOnly)
          db.prepare("UPDATE jobs SET payload=? WHERE id=?").run(
            JSON.stringify({
              ...JSON.parse(duplicate.payload),
              ambientOnly: false,
            }),
            duplicate.id,
          );
        if (payload.enqueue) {
          const merged = {
            ...JSON.parse(duplicate.payload),
            enqueue: true,
            name: payload.name,
            ambientOnly: false,
          };
          db.prepare("UPDATE jobs SET payload=? WHERE id=?").run(
            JSON.stringify(merged),
            duplicate.id,
          );
        }
        return duplicate.id;
      }
    }
    const operationKey = String(
      payload.idempotencyKey ||
        createHash("sha256")
          .update(kind + "\n" + JSON.stringify(payload))
          .digest("hex"),
    ).slice(0, 200);
    const existing = db
      .prepare("SELECT id,payload,status FROM jobs WHERE kind=?")
      .all(kind)
      .find(
        (j) =>
          JSON.parse(j.payload).operationKey === operationKey &&
          (payload.idempotencyKey ||
            ["queued", "running", "waiting-worker"].includes(j.status)),
      );
    if (existing) return existing.id;
    const songId = songIdFor(payload);
    if (songId)
      payload = {
        ...payload,
        expectedRevision:
          payload.expectedRevision ??
          currentSong(store, songId).metadataRevision,
      };
    const id = randomUUID();
    payload = {
      ...payload,
      operationKey,
      jobId: id,
      stagingId: id,
      ...(payload.priority === "mobile"
        ? { requestId: payload.requestId || id }
        : {}),
    };
    db.prepare(
      "INSERT INTO jobs (id,kind,payload,status,created) VALUES (?,?,?,?,?)",
    ).run(id, kind, JSON.stringify(payload), "queued", Date.now());
    emit();
    setImmediate(work);
    return id;
  }
  async function work() {
    if (running >= 4 || stopped || enabled === false) return;
    const jobSong = (j) => songIdFor(JSON.parse(j.payload));
    const activeSongs = new Set(
      db
        .prepare("SELECT payload FROM jobs WHERE status='running'")
        .all()
        .map(jobSong)
        .filter(Boolean),
    );
    const job = db
      .prepare(
        "SELECT * FROM jobs WHERE status='queued' ORDER BY CASE WHEN json_extract(payload,'$.priority')='mobile' THEN -1 WHEN kind IN ('acquire','download') OR json_extract(payload,'$.priority')='online' THEN 0 WHEN kind='resource-cleanup' THEN 1 WHEN kind='poster' THEN 3 ELSE 2 END, created",
      )
      .all()
      .find(
        (j) =>
          (!jobSong(j) || !activeSongs.has(jobSong(j))) &&
          (running < 3 ||
            ["acquire", "download"].includes(j.kind) ||
            ["online", "mobile"].includes(JSON.parse(j.payload).priority)),
      );
    if (!job) return;
    running++;
    setImmediate(work);
    db.prepare(
      "UPDATE jobs SET status='running',started=?,finished=NULL WHERE id=?",
    ).run(Date.now(), job.id);
    emit("tasks", {});
    const payload = JSON.parse(job.payload);
    try {
      const report = (stage) => {
        db.prepare("UPDATE jobs SET stage=? WHERE id=?").run(stage, job.id);
        emit("tasks", {});
      };
      report(job.kind);
      const priority =
        payload.priority ||
        (["acquire", "download"].includes(job.kind) ? "online" : undefined);
      const context = {
        ...dependencies,
        addJob: (kind, child) => {
          const fresh = JSON.parse(
            db.prepare("SELECT payload FROM jobs WHERE id=?").get(job.id)
              .payload,
          );
          const nextPriority = fresh.priority || priority;
          return addJob(kind, {
            ...child,
            ...(nextPriority ? { priority: nextPriority } : {}),
            ...(fresh.requestId ? { requestId: fresh.requestId } : {}),
            ...(nextPriority === "mobile" && fresh.enqueue
              ? { enqueue: true, name: fresh.name }
              : {}),
          });
        },
        enqueue,
        report,
      };
      const songId = songIdFor(payload);
      const outcome = songId
        ? await withSongWrite(
            store,
            songId,
            () => execute(job, payload, context),
            {
              expectedRevision: payload.expectedRevision,
              jobId: job.id,
              wait: true,
            },
          )
        : await execute(job, payload, context);
      if (outcome === "review") return;
      db.prepare(
        "UPDATE jobs SET status='done',stage='done',error='' WHERE id=?",
      ).run(job.id);
      const finishedPayload = JSON.parse(
        db.prepare("SELECT payload FROM jobs WHERE id=?").get(job.id).payload,
      );
      if (finishedPayload.id) {
        if (
          [
            "import",
            "organize",
            "prepare",
            "standardize",
            "attach-video",
            "find-video",
            "upgrade-hd",
            "refresh-video",
          ].includes(job.kind)
        ) {
          const song = db
            .prepare("SELECT * FROM songs WHERE id=?")
            .get(finishedPayload.id);
          if (needsPoster(store, song)) addJob("poster", { id: song.id });
        }
        try {
          await cleanSongVersions(store, finishedPayload.id, cache, {
            legacyCache: dependencies.legacyCache,
            isPlaying: dependencies.isPlaying,
          });
        } catch (error) {
          store.set("resource-cleanup", {
            error: error.message,
            checkedAt: Date.now(),
          });
        }
        try {
          await cleanImportedDownloads(store, dependencies.downloads, {
            id: finishedPayload.id,
          });
        } catch (error) {
          store.set("download-cleanup", {
            error: error.message,
            checkedAt: Date.now(),
          });
        }
      }
    } catch (e) {
      if (e.code === "WAITING_WORKER") {
        db.prepare(
          "UPDATE jobs SET status='waiting-worker',stage='waiting-worker',error=? WHERE id=?",
        ).run(e.message, job.id);
        return;
      }
      const fresh = JSON.parse(
        db.prepare("SELECT payload FROM jobs WHERE id=?").get(job.id).payload,
      );
      if (job.kind === "download" && fresh.priority === "mobile") {
        const fallbackJob = addJob("acquire", {
          title: fresh.title,
          artist: fresh.artist,
          priority: "mobile",
          enqueue: true,
          name: fresh.name,
          requestId: fresh.requestId || job.id,
        });
        db.prepare(
          "UPDATE jobs SET status='done',stage='audio-fallback',payload=?,error='' WHERE id=?",
        ).run(JSON.stringify({ ...fresh, fallbackJob }), job.id);
        return;
      }
      db.prepare("UPDATE jobs SET status='failed',error=? WHERE id=?").run(
        e.message.slice(-1800),
        job.id,
      );
      if (
        job.kind === "prepare" &&
        !resourceManifest(store, currentSong(store, payload.id), cache).playable
      )
        db.prepare("UPDATE songs SET status='error',error=? WHERE id=?").run(
          e.message.slice(-1800),
          payload.id,
        );
    } finally {
      db.prepare("UPDATE jobs SET finished=? WHERE id=?").run(
        Date.now(),
        job.id,
      );
      running--;
      emit("library", {});
      emit();
      if (stopped && !running) finishStop();
      else setImmediate(work);
    }
  }
  return {
    addJob,
    work,
    stop() {
      if (stopped) return stoppedPromise;
      stopped = true;
      if (!running) finishStop();
      return stoppedPromise;
    },
  };
}
