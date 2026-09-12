import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { searchText } from "../server/media-utils.js";
import { matchesInitials } from "../shared/initials.js";
import { normalizeLyricsStyle } from "../shared/lyrics-style.js";

test("pinyin initials are prefixes and lyric defaults survive legacy settings", () => {
  assert.equal(matchesInitials("周杰伦", "ZJL"), true);
  assert.equal(matchesInitials("青花瓷", "QH"), true);
  assert.equal(matchesInitials("青花瓷", "HC"), false);
  assert.equal(normalizeLyricsStyle({ size: 60 }).y, 67);
  assert.deepEqual(
    normalizeLyricsStyle({ size: 500, x: -1, y: 100, color: "invalid" }),
    { font: "sans-serif", size: 90, x: 10, y: 80, color: "#ffd66e", offset: 0 },
  );
  assert.equal(normalizeLyricsStyle(null).x, 50);
});

test("initials filter before result limit, queue priority preserves songs and artwork, lyrics style persists", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-browsing-"));
  const service = createApp({
    dataDir: path.join(dir, "data"),
    roots: [path.join(dir, "media")],
    adminToken: "isolated-admin-password",
    worker: false,
  });
  const { store } = service;
  const insert = store.db.prepare(
    "INSERT INTO songs (id,path,title,artist,search,poster,created) VALUES (?,?,?,?,?,?,?)",
  );
  for (let i = 0; i < 305; i++)
    insert.run(
      "f" + i,
      path.join(dir, "f" + i + ".mp4"),
      "测试歌曲" + i,
      "测试歌手",
      searchText("测试歌曲" + i, "测试歌手"),
      "",
      1000 + i,
    );
  insert.run(
    "qing",
    path.join(dir, "qing.mp4"),
    "青花瓷",
    "周杰伦",
    searchText("青花瓷", "周杰伦"),
    "qing.jpg",
    1,
  );
  store.set("poster-source:qing", { hash: "cover-v2" });
  store.db
    .prepare("INSERT INTO queue VALUES (?,?,?,?)")
    .run("entry-a", "f0", "测试", 0);
  store.db
    .prepare("INSERT INTO queue VALUES (?,?,?,?)")
    .run("entry-b", "qing", "测试", 1);
  store.db
    .prepare("INSERT INTO queue VALUES (?,?,?,?)")
    .run("entry-c", "f1", "测试", 2);
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    service.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  const call = (url, body, admin = false) =>
    fetch("http://127.0.0.1:" + server.address().port + "/api" + url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization:
          "Bearer " +
          (admin ? "isolated-admin-password" : store.get("roomToken")),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  assert.deepEqual(
    (await (await call("/songs?initials=QHC")).json()).map((s) => s.id),
    ["qing"],
  );
  assert.deepEqual(
    (await (await call("/artists?initials=ZJ")).json()).map((s) => s.artist),
    ["周杰伦"],
  );
  let response = await call("/queue/entry-b/first", {});
  assert.equal(response.status, 200);
  let state = await response.json();
  assert.deepEqual(
    state.queue.map((s) => s.id),
    ["entry-b", "entry-a", "entry-c"],
  );
  assert.equal(state.queue[0].hasPoster, 1);
  assert.equal(state.queue[0].posterVersion, "cover-v2");
  assert.equal(state.playback.paused, false);
  assert.equal((await call("/queue/missing/first", {})).status, 404);
  const revision = state.playback.revision;
  state = await (await call("/queue/entry-b/first", {})).json();
  assert.equal(state.playback.revision, revision);
  response = await call(
    "/admin/lyrics-style",
    { size: 64, x: 42, y: 72, color: "#abcdef", font: "sans-serif" },
    true,
  );
  assert.equal(response.status, 200);
  const style = await (await call("/lyrics-style")).json();
  assert.equal(style.size, 64);
  assert.equal(style.x, 42);
  assert.equal(style.y, 72);
});
