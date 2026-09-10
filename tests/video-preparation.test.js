import { prepareVideoOnPc } from "../server/video-preparation.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { openStore } from "../server/db.js";
import { prepareSong, probe } from "../server/media.js";
import { run } from "../server/process.js";

process.env.FFMPEG = ffmpeg;
process.env.FFPROBE = ffprobe.path;
test("original video bypasses conversion; explicit PC conversion checkpoints and rejects invalid results", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-video-pc-")),
    cache = path.join(root, "cache"),
    source = path.join(root, "source.webm"),
    result = path.join(root, "prepared.mp4");
  await mkdir(cache);
  const store = openStore(path.join(root, "db"));
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
    "-c:v",
    "libvpx-vp9",
    "-deadline",
    "realtime",
    "-c:a",
    "libopus",
    source,
  ]);
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-i",
    source,
    "-an",
    "-c:v",
    "libx264",
    result,
  ]);
  store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,created) VALUES('song',?,'Song','Artist',0)",
    )
    .run(source);
  let uploads = 0,
    invalid = false;
  const server = createServer(async (req, res) => {
    if (req.url === "/health")
      return res.end(
        JSON.stringify({
          protocol: "ktv-separation-v1",
          capabilities: ["video-prepare-v1"],
        }),
      );
    if (req.url === "/clip") {
      let body = "";
      for await (const chunk of req) body += chunk.toString("latin1");
      assert.match(body, /name="video_only"\r\n\r\ntrue/);
      assert.match(body, /name="start"\r\n\r\n0/);
      assert.ok(
        store.db
          .prepare(
            "SELECT value FROM settings WHERE key LIKE 'separation:song:%'",
          )
          .get(),
        "checkpoint must be durable before publishing any resources",
      );
      uploads++;
      return res.end(
        JSON.stringify({
          id: "video-result",
          status: "done",
          video_url: "/result",
        }),
      );
    }
    if (req.url === "/result")
      return res.end(await readFile(invalid ? source : result));
    res.statusCode = 404;
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    store.db.close();
    await rm(root, { recursive: true, force: true });
  });
  store.set("ai", { pcEndpoint: `http://127.0.0.1:${server.address().port}` });
  await prepareSong(store, "song", [root], cache);
  assert.equal(uploads, 0);
  const directory = store.get("package:song"),
    original = await readFile(path.join(directory, "原唱.m4a"));
  const video = await probe(path.join(directory, "画面.mp4"));
  assert.equal(video.videoCodec, "vp9");
  assert.equal(video.audio.length, 0);
  assert.ok((await probe(source)).audio.length);
  store.set("package-fingerprint:song", null);
  const staging = path.join(root, "staging");
  await mkdir(staging);
  const song = store.db.prepare("SELECT * FROM songs WHERE id='song'").get();
  const prepared = await prepareVideoOnPc(store, song, source, staging);
  assert.equal(uploads, 1);
  assert.equal((await probe(prepared.file)).videoCodec, "h264");
  store.set(prepared.checkpointKey, null);
  invalid = true;
  await assert.rejects(
    prepareVideoOnPc(store, song, source, staging),
    /PC 画面校验失败/,
  );
  assert.equal(store.get("package:song"), directory);
  assert.deepEqual(await readFile(path.join(directory, "原唱.m4a")), original);
});
