import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import ffmpeg from "ffmpeg-static";
import { run } from "../server/process.js";
import { openStore } from "../server/db.js";
import { createApp } from "../server/app.js";
import { supplementLyrics } from "../server/lyrics-batch.js";
process.env.FFMPEG = ffmpeg;

function insert(store, id, lyrics = "") {
  store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,lyrics,status,created) VALUES(?,?,?,?,?,'ready',0)",
    )
    .run(id, `unused-${id}`, `歌曲${id}`, "测试歌手", lyrics);
}
test("lyrics batch requires admin, spans the library, skips existing/hidden/queued/busy, and avoids duplicates", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-lyrics-batch-"));
  const service = createApp({
    dataDir: path.join(dir, "db"),
    roots: [path.join(dir, "media")],
    adminToken: "lyrics-test-password",
    worker: false,
  });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  const { store } = service;
  for (const id of ["a", "b", "hidden", "playing", "busy", "unknown"])
    insert(store, id);
  insert(store, "existing", "手动歌词也保留");
  store.set("hidden:hidden", true);
  store.db
    .prepare("UPDATE songs SET artist='未知歌手' WHERE id='unknown'")
    .run();
  store.db
    .prepare(
      "INSERT INTO queue(id,song_id,position,name) VALUES('q','playing',0,'测试')",
    )
    .run();
  store.db
    .prepare(
      "INSERT INTO jobs(id,kind,payload,status,created) VALUES('busy-job','organize','{\"id\":\"busy\"}','queued',0)",
    )
    .run();
  const url = `http://127.0.0.1:${server.address().port}/api/admin/lyrics-batch`;
  const post = (body, authenticated = true) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authenticated
          ? { authorization: "Bearer lyrics-test-password" }
          : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await post({ all: true }, false)).status, 401);
  const response = await post({ all: true });
  assert.equal(response.status, 200);
  const results = (await response.json()).results;
  assert.deepEqual(
    results.filter((r) => r.status === "success").map((r) => r.id),
    ["a", "b"],
  );
  assert.equal(results.find((r) => r.id === "unknown").status, "review");
  assert.equal(results.filter((r) => r.status === "skipped").length, 2);
  assert.ok(!results.some((r) => ["hidden", "existing"].includes(r.id)));
  await post({ all: true });
  assert.equal(
    store.db.prepare("SELECT count(*) n FROM jobs WHERE kind='lyrics'").get().n,
    2,
  );
  const selected = (
    await (
      await post({
        items: [
          { id: "existing", expectedRevision: 0 },
          { id: "b", expectedRevision: 999 },
        ],
      })
    ).json()
  ).results;
  assert.equal(selected[0].status, "skipped");
  assert.equal(selected[1].status, "conflict");
  assert.equal((await post({ items: [] })).ok, false);
});

test("lyrics supplementation saves source and LRC while retaining audio bytes and existing lyrics", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-lyrics-save-"));
  const store = openStore(path.join(dir, "db"));
  t.after(async () => {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  insert(store, "song");
  const previous = path.join(dir, "package");
  await mkdir(previous);
  const audio = path.join(previous, "原唱.m4a");
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.2",
    "-c:a",
    "aac",
    audio,
  ]);
  await writeFile(path.join(previous, "伴奏.m4a"), await readFile(audio));
  const bytes = await readFile(audio);
  store.set("package:song", previous);
  store.set("package-ready:song", true);
  const match = {
    lyrics: "[00:01]测试歌词",
    provider: "local-lrc",
    source: "本地 LRC",
    status: "candidate",
  };
  let calls = 0;
  const context = {
    store,
    cache: path.join(dir, "cache"),
    report() {},
    findLyrics: async () => {
      calls++;
      return match;
    },
  };
  await supplementLyrics({}, { id: "song", expectedRevision: 0 }, context);
  const song = store.db.prepare("SELECT * FROM songs WHERE id='song'").get();
  assert.equal(song.lyrics, match.lyrics);
  assert.deepEqual(store.get("lyrics-match:song"), match);
  const current = store.get("package:song");
  assert.equal(
    await readFile(path.join(current, "歌词.lrc"), "utf8"),
    match.lyrics,
  );
  for (const name of ["原唱.m4a", "伴奏.m4a"])
    assert.deepEqual(await readFile(path.join(current, name)), bytes);
  await supplementLyrics(
    {},
    { id: "song", expectedRevision: song.metadataRevision },
    context,
  );
  assert.equal(calls, 1);
});

test("failed or stale lyric lookup preserves resources and refuses songs that enter the queue", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-lyrics-conflict-"));
  const store = openStore(dir);
  t.after(async () => {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  insert(store, "song");
  const context = {
    store,
    cache: dir,
    report() {},
    findLyrics: async () => {
      throw new Error("来源不可用");
    },
  };
  const payload = { id: "song", expectedRevision: 0 };
  await assert.rejects(supplementLyrics({}, payload, context), /来源不可用/);
  assert.equal(store.get("package:song"), undefined);
  context.findLyrics = async () => {
    store.db
      .prepare(
        "UPDATE songs SET lyrics='用户新歌词',metadataRevision=1 WHERE id='song'",
      )
      .run();
    return { lyrics: "[00:01]搜索候选" };
  };
  await assert.rejects(supplementLyrics({}, payload, context), /资料已更新/);
  assert.equal(
    store.db.prepare("SELECT lyrics FROM songs WHERE id='song'").get().lyrics,
    "用户新歌词",
  );
  store.db
    .prepare("UPDATE songs SET lyrics='',metadataRevision=0 WHERE id='song'")
    .run();
  payload.expectedRevision = store.db
    .prepare("SELECT metadataRevision FROM songs WHERE id='song'")
    .get().metadataRevision;
  context.findLyrics = async () => {
    store.db
      .prepare(
        "INSERT INTO queue(id,song_id,position,name) VALUES('q','song',0,'测试')",
      )
      .run();
    return { lyrics: "[00:01]搜索候选" };
  };
  await assert.rejects(supplementLyrics({}, payload, context), /移出播放队列/);
  assert.equal(
    store.db.prepare("SELECT lyrics FROM songs WHERE id='song'").get().lyrics,
    "",
  );
});
