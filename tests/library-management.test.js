import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { organizeBatch } from "../src/library/batch.js";

test("delete preview checks revisions, queue and real files; organize accepts known identity without lyrics", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-manage-"));
  const root = path.join(dir, "media");
  const service = createApp({
    dataDir: path.join(dir, "data"),
    roots: [root],
    adminToken: "test-password-123",
    worker: false,
    discovery: false,
  });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    service.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  const request = async (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/admin/` + route, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer test-password-123",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const folder = path.join(
    root,
    "好好唱播放资源",
    "歌曲",
    "自定歌手 - 自定歌曲",
  );
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, "画面.mp4");
  await writeFile(file, "fixture");
  await writeFile(path.join(root, "keep.mp4"), "keep");
  const { db, set } = service.store;
  db.prepare(
    "INSERT INTO songs(id,path,title,artist,created,needs_review) VALUES(?,?,?,?,?,?)",
  ).run("a", file, "自定歌曲", "自定歌手", Date.now(), 1);
  set("package:a", folder);
  const queued = await request("library/a/organize", { expectedRevision: 0 });
  assert.equal(queued.status, 200);
  const job = db.prepare("SELECT * FROM jobs WHERE kind='organize'").get();
  assert.equal(JSON.parse(job.payload).approved, true);
  const plan = await (await request("library/a/delete-preview")).json();
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.targets[0].directory, true);
  assert.equal(
    (await request("library/a/delete-files", { token: plan.token })).status,
    409,
  );
  db.prepare("DELETE FROM jobs").run();
  db.prepare("UPDATE songs SET title='修改' WHERE id='a'").run();
  assert.notEqual(
    (await request("library/a/delete-files", { token: plan.token })).status,
    200,
  );
  const fresh = await (await request("library/a/delete-preview")).json();
  db.prepare(
    "INSERT INTO queue(id,song_id,name,position) VALUES('q','a','x',0)",
  ).run();
  assert.notEqual(
    (await request("library/a/delete-files", { token: fresh.token })).status,
    200,
  );
  db.prepare("DELETE FROM queue").run();
  assert.equal(
    (await request("library/a/delete-files", { token: fresh.token })).status,
    200,
  );
  await assert.rejects(stat(folder), { code: "ENOENT" });
  assert.ok(await stat(path.join(root, "keep.mp4")));
  assert.equal(
    db.prepare("SELECT id FROM songs WHERE id='a'").get(),
    undefined,
  );
  const inbox = path.join(dir, "data", "downloads");
  for (let i = 0; i < 105; i++) {
    const queuedFile = path.join(inbox, `歌手 - 歌曲${i}.mp4`);
    await writeFile(queuedFile, "fixture");
    if (i < 104)
      db.prepare(
        "INSERT INTO jobs(id,kind,payload,status,created) VALUES(?,?,?,?,?)",
      ).run(
        "import" + i,
        "import",
        JSON.stringify({ file: queuedFile }),
        "queued",
        Date.now(),
      );
  }
  const items = await (await request("inbox")).json();
  assert.equal(
    items.length,
    105,
    "queued imports remain visible before review",
  );
  assert.equal(items.filter((item) => item.processing).length, 104);
  const idle = items.find((item) => !item.processing);
  const inboxPreview = await (
    await request("inbox/delete-preview", { file: idle.file })
  ).json();
  assert.equal(
    (
      await request("inbox/delete-files", {
        file: idle.file,
        token: inboxPreview.token,
      })
    ).status,
    200,
  );
  await assert.rejects(stat(idle.file), { code: "ENOENT" });
  const bulkSongs = Array.from({ length: 105 }, (_, i) => ({
    id: "bulk" + i,
    title: "歌" + i,
    artist: "歌手",
    tier: "pending",
    metadataRevision: 0,
  }));
  for (const song of bulkSongs)
    db.prepare(
      "INSERT INTO songs(id,path,title,artist,created) VALUES(?,?,?,?,?)",
    ).run(
      song.id,
      path.join(root, song.id + ".mp4"),
      song.title,
      song.artist,
      Date.now(),
    );
  let bulkRequests = 0;
  const bulkResults = await organizeBatch(
    bulkSongs,
    [],
    async (route, body) => {
      bulkRequests++;
      const response = await request(route.replace("/admin/", ""), body);
      assert.equal(response.status, 200);
      return response.json();
    },
  );
  assert.equal(
    bulkRequests,
    6,
    "105 songs use six requests, below the request limiter",
  );
  assert.equal(
    bulkResults.filter((item) => item.status === "success").length,
    105,
  );
  const repeated = await (
    await request("organize-batch", {
      items: [
        { id: "bulk0", kind: "song", expectedRevision: 0 },
        { id: "missing", kind: "song", expectedRevision: 0 },
      ],
    })
  ).json();
  assert.deepEqual(
    repeated.results.map((item) => item.status),
    ["skipped", "failed"],
  );
});

test("batch skips duplicate review songs, missing identity and standard songs while continuing failures", async () => {
  const calls = [];
  const results = await organizeBatch(
    [
      { id: "a", title: "歌", artist: "歌手", tier: "pending" },
      { id: "b", title: "歌", artist: "未知歌手", tier: "pending" },
      { id: "c", title: "歌", artist: "歌手", tier: "standard" },
      { id: "d", title: "歌", artist: "歌手", tier: "pending" },
    ],
    [
      {
        id: "review",
        songId: "a",
        title: "歌",
        artist: "歌手",
        kind: "organize",
      },
    ],
    async (route, body) => {
      calls.push(route);
      return {
        results: body.items.map((item) => ({
          id: item.id,
          status: item.kind === "review" ? "failed" : "success",
          message: "结果",
        })),
      };
    },
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(
    results.map((r) => r.status),
    ["failed", "review", "success"],
  );
});
