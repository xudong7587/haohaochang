import { randomUUID, createHash } from "node:crypto";
import { runJob } from "./jobs.js";
import { songIdFor, currentSong, withSongWrite } from "./song-writes.js";
import { resourceManifest } from "./resource-manifest.js";
export function createScheduler(
  dependencies,
  { enabled = true, execute = runJob, onIdle = () => {} } = {},
) {
  const { db, get, set, store, cache, emit, enqueue } = dependencies;
  let running = 0,
    stopped = false;
  function addJob(kind, payload) {
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
      if (existing) return existing.id;
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
            JSON.stringify(p.clip || null) ===
              JSON.stringify(payload.clip || null) &&
            (p.title || "") === (payload.title || "") &&
            (p.artist || "") === (payload.artist || "")
          );
        });
      if (duplicate) {
        if (payload.enqueue)
          db.prepare("UPDATE jobs SET payload=? WHERE id=?").run(
            JSON.stringify({
              ...JSON.parse(duplicate.payload),
              enqueue: true,
              name: payload.name,
            }),
            duplicate.id,
          );
        return duplicate.id;
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
    payload = { ...payload, operationKey, jobId: id, stagingId: id };
    db.prepare(
      "INSERT INTO jobs (id,kind,payload,status,created) VALUES (?,?,?,?,?)",
    ).run(id, kind, JSON.stringify(payload), "queued", Date.now());
    emit();
    setImmediate(work);
    return id;
  }
  async function work() {
    if (running >= 2 || stopped || enabled === false) return;
    const jobSong = (j) => songIdFor(JSON.parse(j.payload));
    const activeSongs = new Set(
      db
        .prepare("SELECT payload FROM jobs WHERE status='running'")
        .all()
        .map(jobSong)
        .filter(Boolean),
    );
    const job = db
      .prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created")
      .all()
      .find((j) => !jobSong(j) || !activeSongs.has(jobSong(j)));
    if (!job) return;
    running++;
    setImmediate(work);
    db.prepare(
      "UPDATE jobs SET status='running',started=?,finished=NULL WHERE id=?",
    ).run(Date.now(), job.id);
    emit("library", {});
    const payload = JSON.parse(job.payload);
    try {
      const report = (stage) => {
        db.prepare("UPDATE jobs SET stage=? WHERE id=?").run(stage, job.id);
        emit("library", {});
      };
      report(job.kind);
      const context = { ...dependencies, addJob, enqueue, report };
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
    } catch (e) {
      if (e.code === "WAITING_WORKER") {
        db.prepare(
          "UPDATE jobs SET status='waiting-worker',stage='waiting-worker',error=? WHERE id=?",
        ).run(e.message, job.id);
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
      if (stopped && !running) onIdle();
      else setImmediate(work);
    }
  }
  return {
    addJob,
    work,
    stop() {
      stopped = true;
      if (!running) onIdle();
    },
  };
}
