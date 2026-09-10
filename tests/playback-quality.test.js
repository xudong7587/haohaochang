import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { createApp } from "../server/app.js";
import { liveEvents } from "../server/live-events.js";
import { bilibiliProvider } from "../server/providers/bilibili.js";
import { previewSessions } from "../server/online-preview.js";
import {
  videoFormat,
  videoQuality,
  previewDownloadHeight,
} from "../shared/video-quality.js";
import { createMediaDownloader } from "../server/sources.js";
import { run } from "../server/process.js";
import { encodeResource, encodePicture } from "../server/song-package.js";
import { openStore } from "../server/db.js";
import { taskProgress } from "../server/task-progress.js";
import { taskStatus } from "../server/task-status.js";

process.env.FFMPEG = ffmpeg;
process.env.FFPROBE = ffprobe.path;

test("background bursts cannot consume playback, lyric or media budgets; write protection remains", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-busy-room-"));
  const service = createApp({
    dataDir: path.join(dir, "data"),
    roots: [path.join(dir, "media")],
    adminToken: "isolated-password",
    worker: false,
    discovery: false,
  });
  const { store } = service;
  store.db
    .prepare(
      "INSERT INTO songs (id,path,title,artist,created) VALUES (?,?,?,?,?)",
    )
    .run(
      "song",
      path.join(dir, "unused.mp4"),
      "合成歌",
      "合成歌手",
      Date.now(),
    );
  store.db
    .prepare("INSERT INTO queue VALUES (?,?,?,?)")
    .run("entry", "song", "test", 1);
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    service.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  const call = (route, method = "GET", body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api${route}`, {
      method,
      headers: {
        Authorization: "Bearer isolated-password",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  for (let n = 0; n < 160; n++) {
    const result = await call("/admin");
    assert.equal(result.status, 200);
    await result.json();
  }
  for (let n = 0; n < 130; n++) {
    const result = await call("/assets/missing/video");
    assert.equal(result.status, 400);
    await result.json();
  }
  for (const deltaMs of [500, -500, 3000, -3000, 10000, -10000]) {
    const result = await call("/control", "POST", {
      action: "lyrics-offset",
      entryId: "entry",
      deltaMs,
    });
    assert.equal(result.status, 200);
    await result.json();
  }
  for (let n = 0; n < 120; n++) {
    const result = await call("/admin/settings", "POST", {});
    assert.equal(result.status, 200);
    await result.json();
  }
  const limited = await call("/admin/settings", "POST", {});
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  const pause = await call("/control", "POST", {
    action: "pause",
    entryId: "entry",
  });
  assert.equal(pause.status, 200);
  assert.equal((await pause.json()).playback.paused, true);
  const lease = await call("/player/heartbeat", "POST", {
    id: "test-player",
  });
  assert.equal(lease.status, 200);
  await lease.text();
});

test("job notifications are bounded and state remains immediate, slow SSE clients are disconnected", async () => {
  const messages = [];
  let destroyed = false;
  const clients = new Set([
    { writableLength: 0, write: (message) => messages.push(message) },
    {
      writableLength: 300000,
      destroy: () => {
        destroyed = true;
      },
    },
  ]);
  const events = liveEvents(clients, () => ({ paused: true }), 20);
  try {
    for (let n = 0; n < 200; n++) {
      events.emit("library", {});
      events.emit("tasks", {});
    }
    events.emit();
    assert.equal(messages.length, 1);
    assert.match(messages[0], /paused/);
    assert.ok(destroyed);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(messages.length, 3);
    events.emit("tasks", {});
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(messages.length, 4);
  } finally {
    events.close();
  }
});

test("Bilibili requests premium formats, displays actual compatible preview and carries selection", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return {
      ok: true,
      json: async () =>
        url.pathname.endsWith("/view")
          ? { code: 0, data: { cid: 123, bvid: "BVtest", duration: 200 } }
          : {
              code: 0,
              data: {
                timelength: 200000,
                dash: {
                  video: [
                    {
                      height: 360,
                      bandwidth: 100,
                      codecs: "avc1",
                      baseUrl: "360",
                    },
                    {
                      height: 1080,
                      bandwidth: 200,
                      codecs: "avc1",
                      baseUrl: "1080",
                    },
                    {
                      height: 1080,
                      bandwidth: 300,
                      codecs: "avc1",
                      baseUrl: "1080-premium",
                    },
                    {
                      height: 2160,
                      bandwidth: 400,
                      codecs: "hev1",
                      baseUrl: "4k",
                    },
                  ],
                  audio: [{ codecs: "mp4a", baseUrl: "audio" }],
                },
              },
            },
    };
  };
  const highest = await bilibiliProvider.preview(
    "https://www.bilibili.com/video/BVtest",
    "SESSDATA=fixture",
    fetcher,
  );
  assert.equal(highest.video, "360");
  assert.equal(highest.previewHeight, 360);
  assert.equal(highest.downloadHeight, 2160);
  assert.equal(previewDownloadHeight(highest, "highest"), 2160);
  assert.equal(previewDownloadHeight(highest, "1080"), 1080);
  assert.equal(previewDownloadHeight(highest, "360"), 360);
  assert.deepEqual(
    highest.qualities.map((q) => q.value),
    ["highest", "2160", "1080", "360"],
  );
  assert.equal(calls[1].url.searchParams.get("fourk"), "1");
  assert.equal(calls[1].url.searchParams.get("qn"), "127");
  assert.equal(calls[1].options.headers.Cookie, "SESSDATA=fixture");
  const low = await bilibiliProvider.preview(
    "https://www.bilibili.com/video/BVtest",
    "",
    fetcher,
    "360",
  );
  assert.equal(low.video, "360");
  assert.equal(videoFormat("highest"), "bv*+ba/b");
  assert.match(videoFormat("2160"), /2160/);
  assert.throws(() => videoQuality("1080]+evil"));
  let resolves = 0;
  const sessions = previewSessions({
    resolve: async (_url, _cookie, _dir, quality) => {
      resolves++;
      return {
        duration: 200,
        quality,
        video: { url: "https://test.bilivideo.com/private" },
      };
    },
  });
  const a = await sessions.create("url", "cookie", "dir", { quality: "360" });
  assert.equal(
    (await sessions.create("url", "cookie", "dir", { quality: "360" })).id,
    a.id,
  );
  assert.notEqual(
    (await sessions.create("url", "cookie", "dir", { quality: "highest" })).id,
    a.id,
  );
  assert.notEqual(
    (await sessions.create("url", "new-cookie", "dir", { quality: "360" })).id,
    a.id,
  );
  assert.equal(resolves, 3);
  assert.equal(a.quality, "360");
  assert.ok(!JSON.stringify(a).includes("private"));
});

test("download caches separate quality and account, reuse identical selections, reject audio-only HD", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-quality-cache-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, "source.mp4");
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=s=128x72:d=0.2",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=0.2",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    source,
  ]);
  const qualities = [];
  const downloader = createMediaDownloader({
    video: async (_url, staging, _cookie, quality) => {
      qualities.push(quality);
      const file = path.join(staging, "out.mp4");
      await copyFile(source, file);
      return { file };
    },
  });
  const url = "https://www.bilibili.com/video/BV1234567890";
  const output = path.join(dir, "downloads");
  const low = await downloader(url, output, undefined, false, "360");
  const high = await downloader(url, output, undefined, false, "highest");
  assert.notEqual(low.file, high.file);
  assert.equal(
    (await downloader(url, output, undefined, false, "highest")).file,
    high.file,
  );
  const cookie = path.join(dir, "cookies.txt");
  await writeFile(cookie, "fixture-account");
  assert.notEqual(
    (await downloader(url, output, cookie, false, "highest")).file,
    high.file,
  );
  assert.deepEqual(qualities, ["360", "highest", "highest"]);
  const audio = path.join(dir, "audio.m4a");
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-i",
    source,
    "-vn",
    "-c:a",
    "copy",
    audio,
  ]);
  const invalid = createMediaDownloader({
    video: async (_url, staging) => {
      const file = path.join(staging, "audio.m4a");
      await copyFile(audio, file);
      return { file };
    },
  });
  await assert.rejects(
    invalid(url, path.join(dir, "invalid"), undefined, false, "1080"),
    /未返回视频/,
  );
});

test("real NAS encode keeps 1440p, reports encode and validation progress without persistent writes", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-hd-progress-"));
  const store = openStore(path.join(dir, "db"));
  t.after(async () => {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const source = path.join(dir, "1440.mp4"),
    out = path.join(dir, "out");
  await mkdir(out);
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=s=2560x1440:r=5:d=0.4",
    "-c:v",
    "libx264",
    source,
  ]);
  await encodePicture(store, { id: "fixture" }, source, out, { force: true });
  const streams = JSON.parse(
    await run(ffprobe.path, [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      path.join(out, "画面.mp4"),
    ]),
  ).streams;
  assert.equal(streams[0].height, 1440);
  assert.equal(streams[0].width, 2560);
  const progress = [];
  await encodeResource(
    ["-i", source, "-an", "-c:v", "copy"],
    path.join(dir, "progress.mp4"),
    { duration: 0.4, report: (p) => progress.push(p) },
  );
  assert.ok(progress.some((p) => p.phase === "转换" && p.percent === 100));
  assert.ok(progress.some((p) => p.phase === "校验" && p.percent === 100));
  store.db
    .prepare(
      "INSERT INTO jobs (id,kind,payload,status,created) VALUES (?,?,?,?,?)",
    )
    .run("job", "import", "{}", "running", Date.now());
  taskProgress(store, "job", { label: "画面转换", percent: 30 });
  assert.equal(taskStatus(store)[0].media_progress.percent, 30);
  taskProgress(store, "job", null);
  assert.equal(taskStatus(store)[0].media_progress, null);
});
