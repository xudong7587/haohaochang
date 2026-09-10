import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { createApp } from "../server/app.js";

test("admin can retry or delete failed tasks without deleting song resources or active jobs", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-job-actions-"));
  const mediaFile = path.join(dir, "kept.mp4");
  await writeFile(mediaFile, "existing media");
  const service = createApp({
    dataDir: path.join(dir, "db"),
    roots: [dir],
    adminToken: "task-test-password",
    worker: false,
    discovery: false,
  });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  const { db } = service.store;
  db.prepare(
    "INSERT INTO songs(id,path,title,artist,created) VALUES('song',?,'测试歌','歌手',0)",
  ).run(mediaFile);
  for (const [id, status] of [
    ["retry", "failed"],
    ["delete", "failed"],
    ["active", "running"],
  ])
    db.prepare(
      "INSERT INTO jobs(id,kind,payload,status,stage,started,finished,created) VALUES(?,'prepare','{\"id\":\"song\"}',?,'old-error',1,2,0)",
    ).run(id, status);
  const request = (id, action, auth = true) =>
    fetch(
      `http://127.0.0.1:${server.address().port}/api/admin/jobs/${id}${action === "retry" ? "/retry" : ""}`,
      {
        method: action === "retry" ? "POST" : "DELETE",
        headers: auth ? { authorization: "Bearer task-test-password" } : {},
      },
    );
  assert.equal((await request("delete", "delete", false)).status, 401);
  assert.equal((await request("retry", "retry")).status, 200);
  const retried = db.prepare("SELECT * FROM jobs WHERE id='retry'").get();
  assert.equal(retried.status, "queued");
  assert.equal(retried.started, null);
  assert.equal(retried.finished, null);
  assert.equal((await request("retry", "retry")).status, 409);
  assert.equal((await request("active", "delete")).status, 409);
  assert.equal((await request("retry", "delete")).status, 409);
  assert.equal((await request("delete", "delete")).status, 200);
  assert.equal(
    db.prepare("SELECT id FROM jobs WHERE id='delete'").get(),
    undefined,
  );
  assert.equal((await request("delete", "delete")).status, 404);
  assert.equal(await readFile(mediaFile, "utf8"), "existing media");
  assert.ok(db.prepare("SELECT id FROM songs WHERE id='song'").get());
});
