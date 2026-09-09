import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createApp } from "../server/app.js";

test("PC and cloud settings preserve each other and test only their selected endpoint", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-connections-"));
  const service = createApp({
    dataDir: path.join(dir, "db"),
    roots: [path.join(dir, "media")],
    adminToken: "test-password-123",
    worker: false,
    discovery: false,
  });
  const remote = express(),
    calls = [];
  remote.get("/:kind/health", (q, r) => {
    calls.push(q.params.kind);
    assert.equal(
      q.headers.authorization,
      "Bearer " + q.params.kind + "-secret",
    );
    r.json({ protocol: "ktv-separation-v1" });
  });
  const worker = remote.listen(0, "127.0.0.1"),
    nas = service.app.listen(0, "127.0.0.1");
  await Promise.all([
    new Promise((r) => worker.once("listening", r)),
    new Promise((r) => nas.once("listening", r)),
  ]);
  t.after(async () => {
    service.close();
    worker.closeAllConnections();
    nas.closeAllConnections();
    await Promise.all([
      new Promise((r) => worker.close(r)),
      new Promise((r) => nas.close(r)),
    ]);
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${worker.address().port}`;
  service.store.set("ai", {
    enabled: true,
    autoDiscover: true,
    pcEndpoint: base + "/pc",
    pcApiKey: "pc-secret",
    pcModel: "htdemucs",
    endpoint: base + "/cloud",
    apiKey: "cloud-secret",
    model: "test",
  });
  const post = (p, body) =>
    fetch(`http://127.0.0.1:${nas.address().port}/api/admin/ai/` + p, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-password-123",
      },
      body: JSON.stringify(body),
    });
  assert.equal((await post("cloud/test", {})).status, 200);
  assert.equal(
    (await post("pc/test", { pcEndpoint: "http://stale.invalid" })).status,
    200,
  );
  assert.deepEqual(calls, ["cloud", "pc"]);
  assert.equal(
    (
      await post("cloud", {
        endpoint: base + "/cloud",
        model: "new",
        pcEndpoint: "http://stale.invalid",
        pcApiKey: "wrong",
        autoDiscover: false,
      })
    ).status,
    200,
  );
  assert.equal(service.store.get("ai").pcEndpoint, base + "/pc");
  assert.equal(service.store.get("ai").pcApiKey, "pc-secret");
  assert.equal(
    (
      await post("pc", {
        autoDiscover: false,
        pcEndpoint: base + "/pc",
        pcModel: "new-pc",
        endpoint: "http://stale.invalid",
        apiKey: "wrong",
      })
    ).status,
    200,
  );
  assert.equal(service.store.get("ai").endpoint, base + "/cloud");
  assert.equal(service.store.get("ai").apiKey, "cloud-secret");
  const noCloud = await post("cloud/test", { endpoint: "", model: "" });
  assert.equal(noCloud.status, 400);
  assert.match((await noCloud.json()).error, /未配置备用 AI/);
  assert.deepEqual(calls, ["cloud", "pc"]);
  const auth = express();
  auth.get("/health", (_q, r) => r.status(401).end());
  const denied = auth.listen(0, "127.0.0.1");
  await new Promise((r) => denied.once("listening", r));
  try {
    const r = await post("pc/test", {
      autoDiscover: false,
      pcEndpoint: `http://127.0.0.1:${denied.address().port}`,
    });
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /密钥不正确/);
  } finally {
    denied.closeAllConnections();
    await new Promise((r) => denied.close(r));
  }
});
