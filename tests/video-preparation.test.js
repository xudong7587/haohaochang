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
test("non-H264 picture goes to PC, checkpoints persist before publication, and bad results preserve the current package", async (t) => {
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
  assert.equal(uploads, 1);
  const directory = store.get("package:song"),
    original = await readFile(path.join(directory, "原唱.m4a"));
  const video = await probe(path.join(directory, "画面.mp4"));
  assert.equal(video.videoCodec, "h264");
  assert.equal(video.audio.length, 0);
  assert.ok((await probe(source)).audio.length);
  store.set("package-fingerprint:song", null);
  invalid = true;
  await assert.rejects(
    prepareSong(store, "song", [root], cache),
    /PC 画面结果/,
  );
  assert.equal(store.get("package:song"), directory);
  assert.deepEqual(await readFile(path.join(directory, "原唱.m4a")), original);
});
