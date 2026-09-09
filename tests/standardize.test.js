import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { createApp } from "../server/app.js";
import { resourceRoot } from "../server/assets.js";
import { run } from "../server/process.js";
import { resourceManifest } from "../server/resource-manifest.js";
import { runJob } from "../server/jobs.js";
import { withSongWrite } from "../server/song-writes.js";
import { standardizeBatch } from "../src/library/batch.js";

process.env.FFMPEG = ffmpeg;
process.env.FFPROBE = ffprobe.path;
test("standard-library migration is scoped, preserves original tracks, and is idempotent for current packages", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-standardize-")),
    media = path.join(root, "media");
  await mkdir(media);
  const cache = resourceRoot(media),
    source = path.join(media, "dual.mp4");
  const service = createApp({
    dataDir: path.join(root, "db"),
    roots: [media],
    downloads: path.join(root, "downloads"),
    adminToken: "standardize-password",
    worker: false,
  });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    service.close();
    await rm(root, { recursive: true, force: true });
  });
  const { store } = service;
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=24:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=1",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-map",
    "2:a",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    source,
  ]);
  store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,status,mode,vocal,backing,created) VALUES('song',?,'Song','Artist','ready','tracks',0,1,0)",
    )
    .run(source);
  await copyFile(source, path.join(cache, "song-vocal.mp4"));
  await copyFile(source, path.join(cache, "song-backing.mp4"));
  const song = () =>
    store.db.prepare("SELECT * FROM songs WHERE id='song'").get();
  assert.equal(resourceManifest(store, song(), cache).tier, "standard");
  async function submit() {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/admin/standardize-batch`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer standardize-password",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [{ id: "song", expectedRevision: song().metadataRevision }],
        }),
      },
    );
    assert.equal(response.status, 200);
    return (await response.json()).results[0];
  }
  store.db.prepare("INSERT INTO queue VALUES('q','song','listener',0)").run();
  assert.equal((await submit()).status, "skipped");
  store.db.prepare("DELETE FROM queue").run();
  async function execute() {
    const response = await submit();
    assert.equal(response.status, "success");
    const job = store.db
        .prepare("SELECT * FROM jobs WHERE id=?")
        .get(response.jobId),
      payload = JSON.parse(job.payload);
    store.db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(job.id);
    await withSongWrite(
      store,
      "song",
      () =>
        runJob(job, payload, {
          store,
          cache,
          legacyCache: cache,
          roots: [media],
          downloads: path.join(root, "downloads"),
          report: () => {},
        }),
      { jobId: job.id },
    );
    store.db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(job.id);
  }
  await execute();
  const first = song(),
    directory = store.get("package:song");
  assert.equal(resourceManifest(store, first, cache).version, 2);
  assert.equal(resourceManifest(store, first, cache).tier, "standard");
  assert.equal(first.mode, "tracks");
  const vocals = await readFile(path.join(directory, "原唱.m4a")),
    backing = await readFile(path.join(directory, "伴奏.m4a"));
  assert.notDeepEqual(vocals, backing);
  await execute();
  assert.equal(song().resourceRevision, first.resourceRevision);
  assert.equal(store.get("package:song"), directory);
  assert.deepEqual(await readFile(path.join(directory, "原唱.m4a")), vocals);
});

test("standardize batch only submits standard songs in bounded groups and reports every result", async () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    id: String(i),
    tier: "standard",
    metadataRevision: i,
  }));
  rows.push({ id: "pending", tier: "pending" });
  const calls = [];
  const result = await standardizeBatch(rows, async (url, body) => {
    calls.push(body.items);
    assert.equal(url, "/admin/standardize-batch");
    return {
      results: body.items.map((item) => ({ id: item.id, status: "success" })),
    };
  });
  assert.deepEqual(
    calls.map((items) => items.length),
    [20, 5],
  );
  assert.equal(result.length, 25);
  assert.equal(calls[1][4].expectedRevision, 24);
});
