import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { openStore } from "../server/db.js";
import { prepareSong, run, probe } from "../server/media.js";
import { refreshVideo } from "../server/job-handlers/refresh-video.js";
import { recordingSource } from "../server/recording-source.js";
import { videoRefreshMode } from "../shared/video-refresh.js";
import { createApp } from "../server/app.js";
process.env.FFMPEG = ffmpeg;
process.env.FFPROBE = ffprobe.path;
const url = "https://www.bilibili.com/video/BV1xx411c7mD/";
const other = "https://www.bilibili.com/video/BV1yy411c7mD/";

test("only proven same untrimmed Bili part permits picture-only replacement", () => {
  const source = { url, untrimmed: true };
  assert.equal(
    videoRefreshMode(source, url + "?p=1&share_source=copy", null).mode,
    "video-only",
  );
  for (const [old, next, clip] of [
    [source, other],
    [source, url + "?p=2"],
    [null, url],
    [{ url }, url],
    [source, url, { start: 0, end: 10 }],
  ])
    assert.equal(videoRefreshMode(old, next, clip).mode, "recording");
  const values = new Map();
  const store = { get: (key) => values.get(key) };
  const song = {
    id: "a",
    evidence: JSON.stringify([{ kind: "user-selection", url, clip: null }]),
  };
  assert.equal(recordingSource(store, song).untrimmed, true);
  values.set("video-source:a", { url, keepAudio: true });
  assert.equal(recordingSource(store, song).untrimmed, false);
  values.set("video-source:a", {
    url,
    keepAudio: true,
    recordingMatched: true,
  });
  assert.equal(recordingSource(store, song).untrimmed, true);
  song.evidence = JSON.stringify([{ kind: "user-selection", url }]);
  assert.equal(recordingSource(store, song).untrimmed, false);
});

test("refresh API authenticates, rejects stale revisions and queue conflicts, and never trusts client provenance", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-refresh-api-"));
  const service = createApp({
    dataDir: path.join(root, "db"),
    roots: [path.join(root, "media")],
    adminToken: "isolated-refresh-password",
    worker: false,
    discovery: false,
  });
  const { store } = service;
  store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,created) VALUES('song',?,'Song','Artist',0)",
    )
    .run(path.join(root, "source.m4a"));
  store.set("ai", { enabled: true });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await service.close();
    await rm(root, { recursive: true, force: true });
  });
  const call = (body, token = "isolated-refresh-password") =>
    fetch(
      `http://127.0.0.1:${server.address().port}/api/admin/library/song/refresh-video`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ url, expectedRevision: 0, ...body }),
      },
    );
  assert.equal((await call({}, "invalid")).status, 401);
  assert.equal((await call({ expectedRevision: 3 })).status, 409);
  assert.equal((await call({ clip: { start: 0, end: 10 } })).status, 400);
  store.db.prepare("INSERT INTO queue VALUES('entry','song','test',0)").run();
  assert.equal((await call({})).status, 409);
  store.db.prepare("DELETE FROM queue").run();
  const response = await call({
    untrimmed: true,
    mode: "video-only",
    recordingSource: { url, untrimmed: true },
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mode, "recording");
  const task = store.db
    .prepare("SELECT kind,payload FROM jobs WHERE id=?")
    .get(result.id);
  assert.equal(task.kind, "refresh-video");
  assert.equal(JSON.parse(task.payload).clip, null);
  assert.equal(JSON.parse(task.payload).mode, undefined);
});

test("refresh stages an entire recording, preserves old media on failure and persists lyric timing for picture-only refresh", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-refresh-"));
  const cache = path.join(root, "cache");
  await mkdir(cache);
  let store = openStore(path.join(root, "db"));
  t.after(async () => {
    store.db.close();
    await rm(root, { recursive: true, force: true });
  });
  async function media(name, color, frequency) {
    const file = path.join(root, name + ".mp4");
    await run(ffmpeg, [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=64x64:r=60:d=1`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:duration=1`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency * 2}:duration=1`,
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
      "-shortest",
      file,
    ]);
    return file;
  }
  const old = await media("old", "red", 440),
    fresh = await media("fresh", "blue", 660);
  const audio = path.join(root, "audio.m4a");
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-i",
    fresh,
    "-map",
    "0:a:0",
    "-c:a",
    "copy",
    audio,
  ]);
  store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,mode,backing,vocal,lyrics,created) VALUES('song',?,'Song','Artist','tracks',0,1,'[00:00]旧歌词',0)",
    )
    .run(old);
  await prepareSong(store, "song", [root], cache);
  store.set("ai", { enabled: true });
  store.set("recording-source:song", { url, clip: null });
  store.set("lyrics-offset:song", -750);
  const current = () =>
    store.db.prepare("SELECT * FROM songs WHERE id='song'").get();
  const dir = () => store.get("package:song");
  const oldDir = dir(),
    original = await readFile(path.join(dir(), "原唱.m4a")),
    backing = await readFile(path.join(dir(), "伴奏.m4a"));
  let splits = 0,
    fail = false,
    intervene = null;
  const context = {
    store,
    cache,
    downloads: root,
    downloadRecording: async () => ({ videoFile: fresh, file: audio }),
    separateRecording: async () => {
      splits++;
      if (fail) throw new Error("test separation failure");
      intervene?.();
      return { file: audio, checkpointKey: "separation:test" };
    },
    findRecordingLyrics: async () => ({ lyrics: "[00:00]新歌词" }),
  };
  await refreshVideo({ id: "same" }, { id: "song", url, clip: null }, context);
  assert.equal(splits, 0);
  assert.notEqual(dir(), oldDir);
  assert.deepEqual(await readFile(path.join(dir(), "原唱.m4a")), original);
  assert.deepEqual(await readFile(path.join(dir(), "伴奏.m4a")), backing);
  assert.equal(store.get("lyrics-offset:song"), -750);
  const sameDir = dir();
  fail = true;
  await assert.rejects(
    refreshVideo({ id: "failed" }, { id: "song", url: other }, context),
    /test separation failure/,
  );
  assert.equal(dir(), sameDir);
  assert.equal(current().lyrics, "[00:00]旧歌词");
  assert.equal(store.get("lyrics-offset:song"), -750);
  fail = false;
  intervene = () =>
    store.db.prepare("UPDATE songs SET title='Edited' WHERE id='song'").run();
  await assert.rejects(
    refreshVideo({ id: "conflict" }, { id: "song", url: other }, context),
    /发布前歌曲已更新/,
  );
  assert.equal(dir(), sameDir);
  intervene = null;
  await refreshVideo({ id: "success" }, { id: "song", url: other }, context);
  assert.notEqual(dir(), sameDir);
  assert.notDeepEqual(await readFile(path.join(dir(), "原唱.m4a")), original);
  assert.notDeepEqual(await readFile(path.join(dir(), "伴奏.m4a")), backing);
  assert.equal(current().lyrics, "[00:00]新歌词");
  assert.equal(store.get("lyrics-offset:song"), 0);
  assert.equal((await probe(path.join(dir(), "画面.mp4"))).videoFps, 60);
  assert.equal(recordingSource(store, current()).url, other.replace(/\/$/, ""));
  assert.deepEqual(await readFile(path.join(oldDir, "原唱.m4a")), original);
  store.db.close();
  store = openStore(path.join(root, "db"));
  assert.equal(store.get("lyrics-offset:song"), 0);
  assert.equal(recordingSource(store, current()).untrimmed, true);
});
