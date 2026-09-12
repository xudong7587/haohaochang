import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import {
  parseLyrics,
  lyricFrame,
  clampLyricsOffset,
} from "../shared/lyrics.js";

test("KTV countdown and lyric frame follow seeking and offsets without replacing the first lyric", () => {
  const lines = parseLyrics("[00:10]第一句\n[00:15]第二句\n[00:20]第三句");
  assert.deepEqual(
    [0, 6, 7, 8, 9, 10].map((time) => lyricFrame(lines, time, 25).countdown),
    [4, 4, 3, 2, 1, 0],
  );
  assert.equal(lyricFrame(lines, 0, 25).line.text, "第一句");
  assert.equal(lyricFrame(lines, 0, 25).next.text, "第二句");
  assert.equal(lyricFrame(lines, 16, 25).index, 1);
  assert.equal(lyricFrame(lines, 5, 25).index, -1);
  assert.equal(clampLyricsOffset(100000), 100000);
  assert.equal(clampLyricsOffset(-100000), -100000);
});

test("song-specific lyric offset updates are shared, persistent beyond thirty seconds and reject stale queue entries", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-lyric-offset-"));
  const service = createApp({
    dataDir: path.join(dir, "data"),
    roots: [path.join(dir, "media")],
    adminToken: "isolated-test-password",
    worker: false,
  });
  const { store } = service;
  store.db
    .prepare(
      "INSERT INTO songs (id,path,title,artist,lyrics,created) VALUES (?,?,?,?,?,?)",
    )
    .run(
      "first",
      path.join(dir, "first.wav"),
      "测试曲",
      "测试歌手",
      "[00:10]第一句",
      Date.now(),
    );
  store.db
    .prepare("INSERT INTO queue VALUES (?,?,?,?)")
    .run("entry-first", "first", "测试", 1);
  const before = store.db
    .prepare("SELECT metadataRevision,resourceRevision FROM songs WHERE id=?")
    .get("first");
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    service.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  const call = (body) =>
    fetch("http://127.0.0.1:" + server.address().port + "/api/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + store.get("roomToken"),
      },
      body: JSON.stringify({
        action: "lyrics-offset",
        entryId: "entry-first",
        ...body,
      }),
    });
  let response = await call({ deltaMs: 100 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).playback.lyricsOffsetMs, 100);
  response = await call({ deltaMs: -100 });
  assert.equal((await response.json()).playback.lyricsOffsetMs, 0);
  assert.equal((await call({ deltaMs: 100, entryId: "stale" })).status, 409);
  assert.equal((await call({ deltaMs: 10001 })).status, 400);
  for (const deltaMs of [500, -500, 3000, -3000, 10000, -10000]) {
    response = await call({ deltaMs });
    assert.equal(response.status, 200);
  }
  store.set("lyrics-offset:first", 29900);
  response = await call({ deltaMs: 1000 });
  assert.equal((await response.json()).playback.lyricsOffsetMs, 30900);
  response = await call({ reset: true });
  assert.equal((await response.json()).playback.lyricsOffsetMs, 0);
  assert.deepEqual(
    store.db
      .prepare("SELECT metadataRevision,resourceRevision FROM songs WHERE id=?")
      .get("first"),
    before,
  );
});
