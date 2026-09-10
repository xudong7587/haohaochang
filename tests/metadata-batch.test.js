import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createApp } from "../server/app.js";
test("metadata batch preserves current lyrics, reports stale revisions, and continues without per-song HTTP writes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-metadata-batch-"));
  const service = createApp({
    dataDir: path.join(root, "db"),
    roots: [path.join(root, "media")],
    worker: false,
    discovery: false,
    adminToken: "isolated-password",
  });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    service.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
  });
  const { store } = service;
  for (const id of ["one", "stale", "last"])
    store.db
      .prepare(
        "INSERT INTO songs(id,path,title,artist,lyrics,created) VALUES(?,?,?,?,?,?)",
      )
      .run(
        id,
        path.join(root, id + ".mp4"),
        "晴天",
        "周杰伦",
        "[00:01]保留当前歌词",
        Date.now(),
      );
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/admin/refresh-metadata-batch`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer isolated-password",
      },
      body: JSON.stringify({
        items: [
          { id: "one", expectedRevision: 0 },
          { id: "stale", expectedRevision: 999 },
          { id: "missing", expectedRevision: 0 },
          { id: "last", expectedRevision: 0 },
        ],
      }),
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(
    body.results.map((r) => r.status),
    ["success", "conflict", "failed", "success"],
  );
  for (const id of ["one", "stale", "last"])
    assert.equal(
      store.db.prepare("SELECT lyrics FROM songs WHERE id=?").get(id).lyrics,
      "[00:01]保留当前歌词",
    );
});
