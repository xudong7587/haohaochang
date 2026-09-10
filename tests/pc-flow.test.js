import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import express from "express";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { openStore } from "../server/db.js";
import { run } from "../server/process.js";
import { probe } from "../server/media-utils.js";
import { canonicalVideo } from "../server/sources.js";
import { download } from "../server/job-handlers/download.js";
import { importJob } from "../server/job-handlers/import.js";
import { upgradeHd } from "../server/job-handlers/upgrade-hd.js";
import { withSongWrite } from "../server/song-writes.js";
process.env.FFMPEG = ffmpeg;
process.env.FFPROBE = ffprobe.path;

test("online DASH video and audio are trimmed separately before audio-only separation; full selection retains full duration", async (t) => {
  const originalFetch = globalThis.fetch;
  let videoBytes,
    audioBytes,
    sourceHeight = 720;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.hostname === "127.0.0.1") return originalFetch(input, options);
    if (url.hostname === "lrclib.net") return new Response("[]");
    if (url.hostname === "cdn.bilivideo.com")
      return new Response(url.pathname === "/video" ? videoBytes : audioBytes);
    if (url.hostname !== "api.bilibili.com")
      throw new Error("Unexpected external test request");
    const data = url.pathname.endsWith("/view")
      ? { cid: 123, bvid: "BV1BZbSzZEGT", duration: 4 }
      : url.pathname.endsWith("/nav")
        ? {
            isLogin: true,
            wbi_img: {
              img_url:
                "https://i0.hdslb.com/7cd084941338484aae1ad9425b84077c.png",
              sub_url:
                "https://i0.hdslb.com/4932caff0ff746eab6f01bf08b70ac45.png",
            },
          }
        : {
            timelength: 4000,
            dash: {
              video: [
                {
                  height: sourceHeight,
                  codecs: "avc1",
                  baseUrl: "https://cdn.bilivideo.com/video",
                },
              ],
              audio: [
                { codecs: "mp4a", baseUrl: "https://cdn.bilivideo.com/audio" },
              ],
            },
          };
    return new Response(JSON.stringify({ code: 0, data }));
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-pc-pipeline-"));
  const store = openStore(path.join(dir, "db")),
    downloads = path.join(dir, "downloads"),
    cache = path.join(dir, "cache"),
    media = path.join(dir, "media");
  const sources = path.join(downloads, ".ktv-online", "sources");
  await Promise.all([
    mkdir(sources, { recursive: true }),
    mkdir(cache),
    mkdir(media),
  ]);
  const url = "https://www.bilibili.com/video/BV1BZbSzZEGT";
  const original = path.join(
    sources,
    createHash("sha256")
      .update(canonicalVideo(url))
      .digest("hex")
      .slice(0, 24) + ".mp4",
  );
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=1280x720:r=24:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    original,
  ]);
  const originalBytes = await readFile(original),
    events = [];
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-i",
    original,
    "-an",
    "-c:v",
    "copy",
    path.join(dir, "dash-video.mp4"),
  ]);
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-i",
    original,
    "-vn",
    "-c:a",
    "copy",
    path.join(dir, "dash-audio.m4a"),
  ]);
  videoBytes = await readFile(path.join(dir, "dash-video.mp4"));
  audioBytes = await readFile(path.join(dir, "dash-audio.m4a"));
  const remote = express();
  remote.use(express.raw({ type: () => true, limit: "5mb" }));
  remote.get("/health", (_q, r) =>
    r.json({ protocol: "ktv-separation-v1", capabilities: ["video-clip-v1"] }),
  );
  let clipFails = false,
    expectedDuration = 1.5;
  remote.post("/clip", async (q, r) => {
    if (clipFails) return r.status(500).end();
    const form = await new Response(q.body, {
      headers: { "content-type": q.headers["content-type"] },
    }).formData();
    assert.equal(Number(form.get("start")), 1.25);
    assert.equal(Number(form.get("end")), 2.75);
    assert.equal(form.get("video_only"), "true");
    await writeFile(
      path.join(dir, "worker-input.mp4"),
      Buffer.from(await form.get("file").arrayBuffer()),
    );
    assert.equal(
      (await probe(path.join(dir, "worker-input.mp4"))).audio.length,
      0,
    );
    await run(ffmpeg, [
      "-y",
      "-v",
      "error",
      "-ss",
      "1.25",
      "-i",
      path.join(dir, "worker-input.mp4"),
      "-t",
      "1.5",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      path.join(dir, "worker-clip.mp4"),
    ]);
    events.push("clip");
    r.json({ status: "done", video_url: "/clipped" });
  });
  remote.get("/clipped", (_q, r) =>
    r.sendFile(path.join(dir, "worker-clip.mp4")),
  );
  remote.post("/separate", async (q, r) => {
    const form = await new Response(q.body, {
      headers: { "content-type": q.headers["content-type"] },
    }).formData();
    const audio = path.join(dir, "received.m4a");
    await writeFile(audio, Buffer.from(await form.get("file").arrayBuffer()));
    const info = await probe(audio);
    assert.equal(info.hasVideo, false);
    assert.ok(
      Math.abs(info.duration - expectedDuration) < 0.15,
      `received duration ${info.duration}`,
    );
    await run(ffmpeg, [
      "-y",
      "-v",
      "error",
      "-i",
      audio,
      path.join(dir, "backing.wav"),
    ]);
    events.push("separate");
    r.json({ status: "done", instrumental_url: "/backing" });
  });
  remote.get("/backing", (_q, r) => r.sendFile(path.join(dir, "backing.wav")));
  const server = remote.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  store.set("ai", {
    enabled: true,
    pcEndpoint: `http://127.0.0.1:${server.address().port}`,
  });
  const imports = [];
  const context = {
    store,
    db: store.db,
    get: store.get,
    set: store.set,
    dir,
    roots: [media],
    downloads,
    cache,
    emit: () => {},
    enqueue: () => assert.fail("must not enqueue"),
    addJob: (kind, payload) => imports.push({ kind, payload }),
  };
  const payload = {
    url,
    title: "合成流程测试",
    artist: "测试歌手",
    onlineSelection: true,
    clip: { start: 1.25, end: 2.75 },
  };
  clipFails = true;
  await assert.rejects(
    download({ id: "fail", kind: "download" }, payload, context),
    (e) => e.code === "WAITING_WORKER",
  );
  assert.equal(imports.length, 0);
  assert.equal(events.length, 0);
  clipFails = false;
  for (const [id, clip, duration] of [
    ["marked", payload.clip, 1.5],
    ["full", null, 4],
  ]) {
    expectedDuration = duration;
    await download(
      { id, kind: "download" },
      { ...payload, title: id, clip },
      context,
    );
    const staged = imports.at(-1);
    assert.equal(staged.kind, "import");
    assert.ok(
      Math.abs((await probe(staged.payload.file)).duration - duration) < 0.15,
    );
    staged.payload.metadata.lyrics = id === "full" ? "" : "[00:00.00]测试歌词";
    store.db
      .prepare(
        "INSERT INTO jobs(id,kind,payload,status,created) VALUES (?,?,?,?,?)",
      )
      .run(id, "import", JSON.stringify(staged.payload), "running", Date.now());
    await importJob({ id, kind: "import" }, staged.payload, context);
    const song = store.db.prepare("SELECT * FROM songs WHERE title=?").get(id);
    assert.equal(song.mode, "separated");
    assert.equal(song.status, "ready");
    assert.equal(song.needs_video, 0);
    assert.equal(
      (await probe(path.join(store.get("package:" + song.id), "画面.mp4")))
        .height,
      720,
    );
    if (id === "full") assert.equal(song.lyrics, "");
    assert.ok(Math.abs(song.duration - duration) < 0.15);
  }
  assert.deepEqual(events, ["clip", "separate", "separate"]);
  const existing = store.db
    .prepare("SELECT * FROM songs WHERE title='full'")
    .get();
  const oldPackage = store.get("package:" + existing.id);
  const preservedAudio = await readFile(path.join(oldPackage, "原唱.m4a"));
  const preservedBacking = await readFile(path.join(oldPackage, "伴奏.m4a"));
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=s=1920x1080:r=24:d=4",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    path.join(dir, "hd-video.mp4"),
  ]);
  videoBytes = await readFile(path.join(dir, "hd-video.mp4"));
  sourceHeight = 1080;
  await withSongWrite(store, existing.id, () =>
    upgradeHd({ id: "upgrade" }, { id: existing.id }, context),
  );
  const newPackage = store.get("package:" + existing.id);
  assert.equal((await probe(path.join(newPackage, "画面.mp4"))).height, 1080);
  assert.deepEqual(
    await readFile(path.join(newPackage, "原唱.m4a")),
    preservedAudio,
  );
  assert.deepEqual(
    await readFile(path.join(newPackage, "伴奏.m4a")),
    preservedBacking,
  );
  assert.deepEqual(events, ["clip", "separate", "separate"]);
  assert.deepEqual(await readFile(original), originalBytes);
});
