import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openStore } from "../server/db.js";
import { createScheduler } from "../server/scheduler.js";
import { createApp } from "../server/app.js";
import { candidates } from "../server/acquisition.js";
const until = async (fn) => {
  const end = Date.now() + 5000;
  while (!fn()) {
    assert.ok(Date.now() < end, "timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
test("mobile requests outrank queued admin work and promote duplicate requests with priority inherited by children", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-mobile-priority-"));
  const store = openStore(dir);
  let release;
  const gate = new Promise((r) => (release = r)),
    started = [];
  const scheduler = createScheduler(
    { ...store, store, emit: () => {}, enqueue: () => {} },
    {
      execute: async (job, p, c) => {
        started.push({ id: job.id, ...p });
        await gate;
        if (job.kind === "download")
          c.addJob("child", { title: p.title + " child" });
      },
    },
  );
  t.after(async () => {
    release();
    await scheduler.stop();
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  for (let n = 0; n < 6; n++)
    scheduler.addJob("download", {
      title: "admin" + n,
      url: "https://example.test/" + n,
    });
  const mobile = scheduler.addJob("download", {
    title: "mobile",
    url: "https://example.test/m",
    priority: "mobile",
    enqueue: true,
  });
  const original = scheduler.addJob("acquire", {
    title: "shared",
    artist: "test",
  });
  assert.equal(
    scheduler.addJob("acquire", {
      title: "shared",
      artist: "test",
      priority: "mobile",
      enqueue: true,
      name: "phone",
    }),
    original,
  );
  await until(() => started.length === 4);
  assert.equal(started[0].id, mobile);
  assert.equal(started[1].id, original);
  assert.equal(started[1].enqueue, true);
  release();
  await until(
    () =>
      store.db
        .prepare(
          "SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')",
        )
        .get().n === 0,
  );
  const child = store.db
    .prepare("SELECT payload FROM jobs WHERE kind='child'")
    .all()
    .map((r) => JSON.parse(r.payload))
    .find((p) => p.title === "mobile child");
  assert.equal(child.priority, "mobile");
  assert.equal(child.requestId, mobile);
});
test("failed mobile video becomes an audio request; waiting for the PC does not duplicate the work", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-mobile-fallback-"));
  const store = openStore(dir);
  const scheduler = createScheduler(
    { ...store, store, emit: () => {}, enqueue: () => {} },
    {
      execute: async (job, p) => {
        if (job.kind === "download")
          throw Object.assign(
            new Error("fixture download unavailable"),
            p.title === "waiting" ? { code: "WAITING_WORKER" } : {},
          );
      },
    },
  );
  t.after(async () => {
    await scheduler.stop();
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  scheduler.addJob("download", {
    title: "failed",
    artist: "test",
    priority: "mobile",
    enqueue: true,
  });
  scheduler.addJob("download", {
    title: "waiting",
    artist: "test",
    priority: "mobile",
    url: "https://example.test/wait",
  });
  await until(
    () =>
      store.db
        .prepare(
          "SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')",
        )
        .get().n === 0,
  );
  const rows = store.db
    .prepare("SELECT * FROM jobs WHERE kind='acquire'")
    .all();
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].payload).title, "failed");
});
test("audio candidates keep Bilibili first and retain another provider when its download is unavailable", async () => {
  const calls = [];
  const found = await candidates(
    "测试歌曲",
    "测试歌手",
    false,
    async (q, p) => {
      calls.push(p);
      return [{ title: "测试歌手 测试歌曲", url: p }];
    },
  );
  assert.deepEqual(calls, ["bilibili", "youtube"]);
  assert.deepEqual(
    found.map((r) => r.url),
    calls,
  );
});
test("phone APIs authenticate, enqueue mobile selections and return progress without private payloads", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-mobile-api-"));
  await mkdir(path.join(dir, "media"));
  const service = createApp({
    dataDir: path.join(dir, "data"),
    roots: [path.join(dir, "media")],
    downloads: path.join(dir, "downloads"),
    adminToken: "test-mobile-admin-key",
    worker: false,
    discovery: false,
  });
  service.store.set("ai", { enabled: true });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (url, body, authorized = true) =>
    fetch(base + "/api" + url, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(authorized
          ? { Authorization: "Bearer test-mobile-admin-key" }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await call("/requests/status", null, false)).status, 401);
  const response = await call("/online", {
    url: "https://www.bilibili.com/video/BV1gF4m1K7Aa",
    title: "测试歌曲",
    artist: "测试歌手",
    onlineSelection: true,
    client: "mobile",
    quality: "highest",
  });
  assert.equal(response.status, 200);
  const job = await response.json();
  const payload = JSON.parse(
    service.store.db.prepare("SELECT payload FROM jobs WHERE id=?").get(job.id)
      .payload,
  );
  assert.equal(payload.priority, "mobile");
  assert.equal(payload.enqueue, true);
  service.store.db
    .prepare("UPDATE jobs SET error=? WHERE id=?")
    .run("SECRET /private/path", job.id);
  const rows = await (await call("/requests/status")).json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "测试歌曲");
  assert.ok(!JSON.stringify(rows).includes("SECRET"));
  assert.ok(!JSON.stringify(rows).includes("url"));
});
