import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
test("read-only media preview allows lyric search without enabling save or task mutations", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-preview-lyrics-"));
  await mkdir(path.join(dir, "media"));
  await writeFile(path.join(dir, "fixture.lrc"), "[00:01]测试歌词");
  await writeFile(
    path.join(dir, "index.json"),
    JSON.stringify([
      {
        title: "测试歌曲",
        artist: "测试歌手",
        duration: 100,
        file: "fixture.lrc",
      },
    ]),
  );
  const prior = process.env.KTV_LYRICS_INDEX;
  process.env.KTV_LYRICS_INDEX = path.join(dir, "index.json");
  const service = createApp({
    dataDir: path.join(dir, "data"),
    roots: [path.join(dir, "media")],
    downloads: path.join(dir, "downloads"),
    readOnlyMedia: true,
    adminToken: "preview-lyrics-fixture",
    worker: false,
    discovery: false,
  });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await service.close();
    if (prior === undefined) delete process.env.KTV_LYRICS_INDEX;
    else process.env.KTV_LYRICS_INDEX = prior;
    await rm(dir, { recursive: true, force: true });
  });
  const post = (url, body) =>
    fetch(base + "/api" + url, {
      method: "POST",
      headers: {
        Authorization: "Bearer preview-lyrics-fixture",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const search = await post("/admin/find-lyrics", {
    title: "测试歌曲",
    artist: "测试歌手",
    duration: 500,
  });
  assert.equal(search.status, 200);
  assert.match((await search.json()).warning, /两分钟/);
  assert.equal((await post("/admin/library/fixture/save", {})).status, 403);
  assert.equal(
    (await post("/requests", { title: "测试歌曲", artist: "测试歌手" })).status,
    403,
  );
  assert.equal(
    service.store.db.prepare("SELECT COUNT(*) n FROM jobs").get().n,
    0,
  );
});
