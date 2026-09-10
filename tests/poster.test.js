import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import ffmpeg from "ffmpeg-static";
import { openStore } from "../server/db.js";
import { run } from "../server/process.js";
import { scrapePoster, needsPoster } from "../server/song-poster.js";
import {
  findPoster,
  downloadPoster,
  matchAlbumTrack,
} from "../server/poster-source.js";
import { createApp } from "../server/app.js";
import { queueMissingPosters } from "../server/poster-backfill.js";
process.env.FFMPEG = ffmpeg;
test("automatic backfill caps batches, skips busy/hidden songs and observes retry cooldown", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-poster-backfill-"));
  const store = openStore(dir);
  t.after(async () => {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  for (let n = 0; n < 9; n++) {
    store.db
      .prepare(
        "INSERT INTO songs(id,path,title,status,created,artist) VALUES(?,?,?,?,?,'测试')",
      )
      .run(String(n), `unused-${n}`, "合成歌", "ready", n);
    store.set("package-ready:" + n, true);
  }
  store.set("hidden:0", true);
  store.set("poster-attempt:1", { at: Date.now(), status: "missing" });
  store.db
    .prepare(
      "INSERT INTO jobs(id,kind,payload,status,created) VALUES(?,?,?,?,?)",
    )
    .run("busy", "organize", '{"id":"2"}', "running", 0);
  const queued = [];
  const addJob = (kind, payload) => {
    queued.push(payload.id);
    store.db
      .prepare(
        "INSERT INTO jobs(id,kind,payload,status,created) VALUES(?,?,?,?,?)",
      )
      .run("poster-" + payload.id, kind, JSON.stringify(payload), "queued", 0);
  };
  assert.equal(queueMissingPosters({ store, addJob }), 4);
  assert.deepEqual(queued, ["3", "4", "5", "6"]);
  assert.equal(queueMissingPosters({ store, addJob }), 0);
  store.db.prepare("UPDATE jobs SET status='done' WHERE kind='poster'").run();
  for (const id of queued)
    store.set("poster-attempt:" + id, { at: Date.now(), status: "missing" });
  store.set("poster-attempt:1", {
    at: Date.now() - 25 * 3600000,
    status: "missing",
  });
  assert.equal(queueMissingPosters({ store, addJob }), 3);
  assert.deepEqual(queued.slice(4), ["1", "7", "8"]);
});
test("album matching and Bilibili cover priority reject incorrect sources", async () => {
  const song = { title: "晴天", artist: "周杰伦", duration: 270 };
  assert.ok(
    matchAlbumTrack(
      { trackName: "晴天", artistName: "周杰倫", trackTimeMillis: 269000 },
      song,
    ),
  );
  assert.ok(
    !matchAlbumTrack({ trackName: "晴天", artistName: "其他歌手" }, song),
  );
  const result = await findPoster(song, {
    source: {
      url: "https://www.bilibili.com/video/BV1gF4m1K7Aa",
      cover: "https://i0.hdslb.com/a.jpg",
    },
    fetcher: () => {
      throw Error("unexpected lookup");
    },
  });
  assert.equal(result.provider, "bilibili");
  await assert.rejects(
    downloadPoster("https://i0.hdslb.com/a.jpg", {
      fetcher: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/private" },
        }),
    }),
    /受支持/,
  );
  await assert.rejects(
    downloadPoster("https://i0.hdslb.com/a.jpg", {
      fetcher: async () => new Response("<html>bad</html>"),
    }),
    /有效/,
  );
});
test("poster publication normalizes JPEG, preserves playable resources and retains old cover on failed download", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-poster-")),
    cache = path.join(dir, "media");
  await mkdir(cache);
  const store = openStore(path.join(dir, "db"));
  t.after(async () => {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const id = "a".repeat(24);
  store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,status,created) VALUES(?,?,?,?,?,?)",
    )
    .run(
      id,
      path.join(cache, "song.m4a"),
      "晴天",
      "周杰伦",
      "ready",
      Date.now(),
    );
  store.set("package-ready:" + id, true);
  const input = path.join(dir, "source.png");
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=purple:s=64x64",
    "-frames:v",
    "1",
    input,
  ]);
  const options = {
    find: async () => ({
      provider: "test",
      source: "测试专辑",
      album: "测试",
      imageUrl: "https://i0.hdslb.com/a.jpg",
    }),
    download: async () => readFile(input),
  };
  await scrapePoster(store, id, cache, options);
  const before = store.db.prepare("SELECT * FROM songs WHERE id=?").get(id),
    bytes = await readFile(before.poster);
  assert.equal(path.basename(before.poster), "封面.jpg");
  assert.equal(bytes[0], 255);
  assert.equal(bytes[1], 216);
  assert.equal(before.status, "ready");
  assert.equal(before.resourceRevision, 0);
  assert.equal(needsPoster(store, before), false);
  await assert.rejects(
    scrapePoster(store, id, cache, {
      ...options,
      force: true,
      download: async () => {
        throw Error("network unavailable");
      },
    }),
    /network unavailable/,
  );
  assert.deepEqual(await readFile(before.poster), bytes);
  assert.equal(
    store.db.prepare("SELECT poster FROM songs WHERE id=?").get(id).poster,
    before.poster,
  );
});
test("preview mode blocks media mutations and disables scheduling", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-preview-"));
  const service = createApp({
    dataDir: path.join(dir, "db"),
    roots: [path.join(dir, "media")],
    adminToken: "poster-test-password",
    readOnlyMedia: true,
  });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    service.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + "/api/admin/poster-batch", {
    method: "POST",
    headers: {
      authorization: "Bearer poster-test-password",
      "content-type": "application/json",
    },
    body: JSON.stringify({ items: [{ id: "a".repeat(24) }] }),
  });
  assert.equal(response.status, 403);
  assert.equal(
    service.store.db.prepare("SELECT count(*) AS n FROM jobs").get().n,
    0,
  );
});
