import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { run } from "../server/process.js";
import { probe } from "../server/media-utils.js";
import { clipOnPc } from "../server/clipping.js";
import { openStore } from "../server/db.js";
import { withTaskSignal } from "../server/task-cancellation.js";
process.env.FFMPEG = ffmpeg;
process.env.FFPROBE = ffprobe.path;

test("NAS clipping keeps tracks/rate, handles absent, offline and busy PC, cache identity and cancellation", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-nas-clip-"));
  const store = openStore(path.join(dir, "db"));
  const input = path.join(dir, "input.mp4");
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=24:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    input,
  ]);
  const app = express();
  // FastAPI parses the uploaded form before the worker reports a busy queue.
  app.use(express.raw({ type: () => true, limit: "5mb" }));
  app.get("/health", (_q, r) =>
    r.json({ protocol: "ktv-separation-v1", capabilities: ["video-clip-v1"] }),
  );
  app.post("/clip", (_q, r) => r.status(503).end());
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const payload = { clip: { start: 1.25, end: 2.75 } };
  const file = await clipOnPc(store, { id: "local" }, payload, input, dir);
  const info = await probe(file);
  assert.equal(info.audio.length, 2);
  assert.equal(info.height, 90);
  assert.equal(info.videoFps, 24);
  assert.ok(Math.abs(info.duration - 1.5) < 0.15);
  const before = (await stat(file)).mtimeMs;
  assert.equal(
    await clipOnPc(store, { id: "local" }, payload, input, dir),
    file,
  );
  assert.equal((await stat(file)).mtimeMs, before);
  const different = await clipOnPc(
    store,
    { id: "local" },
    { clip: { start: 3.25, end: 4 } },
    input,
    dir,
    true,
  );
  assert.notEqual(different, file);
  assert.equal((await probe(different)).audio.length, 0);
  assert.ok(Math.abs((await probe(different)).duration - 0.75) < 0.15);
  await writeFile(different, "partial output");
  assert.equal(
    await clipOnPc(
      store,
      { id: "local" },
      { clip: { start: 3.25, end: 4 } },
      input,
      dir,
      true,
    ),
    different,
  );
  assert.ok((await probe(different)).hasVideo);
  for (const endpoint of [
    "http://127.0.0.1:1",
    `http://127.0.0.1:${server.address().port}`,
  ]) {
    store.set("ai", { pcEndpoint: endpoint });
    const result = await clipOnPc(
      store,
      { id: endpoint.endsWith(":1") ? "offline" : "busy" },
      payload,
      input,
      dir,
      true,
    );
    assert.ok(Math.abs((await probe(result)).duration - 1.5) < 0.15);
  }
  const controller = new AbortController();
  controller.abort(new Error("cancel test"));
  await assert.rejects(
    withTaskSignal(controller.signal, () =>
      clipOnPc(store, { id: "cancel" }, payload, input, dir),
    ),
    /cancel test/,
  );
  assert.ok(
    !(await readdir(path.join(dir, ".ktv-online", "clips"))).includes("cancel"),
  );
  assert.ok(
    !(await readdir(path.dirname(file))).some((f) => f.endsWith(".tmp")),
  );
});

test("NAS HDR clipping explicitly converts to BT.709 without changing dimensions", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-hdr-clip-"));
  const store = openStore(path.join(dir, "db"));
  t.after(async () => {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const input = path.join(dir, "hdr.mp4");
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=24:d=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p10le",
    "-color_primaries",
    "bt2020",
    "-color_trc",
    "smpte2084",
    "-colorspace",
    "bt2020nc",
    input,
  ]);
  const file = await clipOnPc(
    store,
    { id: "hdr" },
    { clip: { start: 0.25, end: 1.5 } },
    input,
    dir,
    true,
  );
  const info = await probe(file);
  assert.equal(info.colorTransfer, "bt709");
  assert.equal(info.height, 90);
  assert.equal(info.videoFps, 24);
  assert.ok(Math.abs(info.duration - 1.25) < 0.15);
});

test("upgrade resumes downloads blocked on PC while leaving separation waiting", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-clip-upgrade-"));
  let store = openStore(dir);
  t.after(async () => {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  for (const [id, kind, payload] of [
    ["download", "download", { onlineSelection: true }],
    ["prepare", "prepare", {}],
  ])
    store.db
      .prepare(
        "INSERT INTO jobs (id,kind,payload,status,created,error) VALUES (?,?,?,'waiting-worker',?,'PC offline')",
      )
      .run(id, kind, JSON.stringify(payload), Date.now());
  store.db.close();
  store = openStore(dir);
  assert.equal(
    store.db.prepare("SELECT status FROM jobs WHERE id='download'").get()
      .status,
    "queued",
  );
  assert.equal(
    store.db.prepare("SELECT status FROM jobs WHERE id='prepare'").get().status,
    "waiting-worker",
  );
});
