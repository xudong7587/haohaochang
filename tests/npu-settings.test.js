import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";

test("enabling NPU enables separation, preserves PC settings, and never exposes saved keys", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-npu-settings-"));
  const service = createApp({
    dataDir: path.join(dir, "data"),
    roots: [path.join(dir, "media")],
    downloads: path.join(dir, "downloads"),
    adminToken: "npu-settings-fixture",
    worker: false,
    discovery: false,
    watch: false,
  });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await service.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  service.store.set("ai", {
    enabled: false,
    autoDiscover: true,
    pcEndpoint: "http://127.0.0.1:19999",
    pcApiKey: "pc-fixture",
  });
  const base = `http://127.0.0.1:${server.address().port}/api/admin/ai`;
  assert.equal(
    (
      await fetch(base + "/npu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    401,
  );
  const result = await fetch(base + "/npu", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer npu-settings-fixture",
    },
    body: JSON.stringify({
      npuEnabled: true,
      npuEndpoint: "http://127.0.0.1:19998",
      npuApiKey: "npu-fixture",
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(service.store.get("ai").enabled, true);
  assert.equal(service.store.get("ai").pcApiKey, "pc-fixture");
  const visible = await (
    await fetch(base, {
      headers: { Authorization: "Bearer npu-settings-fixture" },
    })
  ).json();
  assert.equal(visible.npuEnabled, true);
  assert.equal(visible.hasNpuKey, true);
  assert.equal(visible.npuApiKey, undefined);
  assert.equal(visible.pcApiKey, undefined);
});
