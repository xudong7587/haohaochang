import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { configureLocalSeparation } from "../server/separation/local.js";
import { startEmbeddedSeparation } from "../server/separation/embedded.js";
import { providerCandidates, cpuConfig, npuConfig } from "../server/separation/providers.js";
import { createApp } from "../server/app.js";
import { providerConfig } from "../server/separation/config.js";

test("local worker key survives main restart and invalid key is never overwritten", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-local-key-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { KTV_LOCAL_SEPARATION: "1", DATA_DIR: dir };
  await configureLocalSeparation(env);
  const file = path.join(dir, "separation", "internal.key");
  const original = await readFile(file, "utf8");
  assert.match(env.KTV_LOCAL_KEY, /^[a-f0-9]{64}$/);
  const restart = { KTV_LOCAL_SEPARATION: "1", DATA_DIR: dir };
  await configureLocalSeparation(restart);
  assert.equal(restart.KTV_LOCAL_KEY, env.KTV_LOCAL_KEY);
  assert.equal(await readFile(file, "utf8"), original);
  await writeFile(file, "invalid fixture");
  await assert.rejects(configureLocalSeparation(restart), /密钥文件无效/);
  assert.equal(await readFile(file, "utf8"), "invalid fixture");
  const embedded = await startEmbeddedSeparation({
    env: { KTV_LOCAL_SEPARATION: "1", KTV_EMBEDDED_SEPARATION: "1" },
    spawnProcess: () => assert.fail("Compose mode must never start heavy child workers"),
  });
  await embedded.stop();
});

test("Compose connects with generated auth and preserves user switches and legacy settings", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-local-api-"));
  const env = { KTV_LOCAL_SEPARATION: "1", DATA_DIR: path.join(dir, "data") };
  await configureLocalSeparation(env);
  const remote = express();
  remote.get("/:kind/health", (req, res) => {
    if (req.get("authorization") !== "Bearer " + env.KTV_LOCAL_KEY)
      return res.sendStatus(401);
    res.json({ protocol: "ktv-separation-v1", backend: req.params.kind === "npu" ? "openvino-npu" : "demucs", device: "cpu", ready: true, models: ["htdemucs"] });
  });
  const worker = remote.listen(0, "127.0.0.1");
  await new Promise((r) => worker.once("listening", r));
  const endpoint = `http://127.0.0.1:${worker.address().port}`;
  Object.assign(env, { KTV_CPU_ENDPOINT: endpoint + "/cpu", KTV_NPU_ENDPOINT: endpoint + "/npu" });
  const oldEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const service = createApp({ dataDir: env.DATA_DIR, downloads: path.join(dir, "downloads"), roots: [path.join(dir, "media")], adminToken: "compose-admin-fixture", discovery: false, worker: false, watch: false });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await service.close();
    server.closeAllConnections(); worker.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => worker.close(r))]);
    for (const [key, value] of Object.entries(oldEnv))
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await rm(dir, { recursive: true, force: true });
  });
  assert.equal(service.store.get("ai").enabled, true);
  const saved = { enabled: false, pcEnabled: false, cpuEnabled: false, npuEnabled: true, pcApiKey: "saved-pc-key", npuEndpoint: "http://retired-service:8000", npuApiKey: "old-key" };
  service.store.set("ai", saved);
  assert.equal(cpuConfig(saved).enabled, false);
  assert.equal(npuConfig(saved).endpoint, endpoint + "/npu");
  assert.equal(npuConfig(saved).apiKey, env.KTV_LOCAL_KEY);
  assert.deepEqual(providerCandidates(saved).map((c) => c.npu ? "npu" : "cpu"), ["npu"]);
  const url = `http://127.0.0.1:${server.address().port}/api/admin/separation`;
  const headers = { Authorization: "Bearer compose-admin-fixture", "Content-Type": "application/json" };
  const status = await (await fetch(url, { headers })).json();
  assert.equal(status.config.managed, true);
  assert.equal(status.config.embedded, false);
  assert.equal(status.config.enabled, false);
  assert.equal(status.providers.find((p) => p.kind === "cpu").ready, true);
  assert.equal(status.providers.find((p) => p.kind === "npu").source, "本机分离容器");
  assert.ok(!JSON.stringify(status).includes(env.KTV_LOCAL_KEY));
  assert.doesNotMatch(JSON.stringify(status), /saved-pc-key|old-key|http:/);
  await fetch(url, { method: "POST", headers, body: JSON.stringify({ cpuEnabled: true, enabled: true }) });
  assert.deepEqual(service.store.get("ai"), { ...saved, cpuEnabled: true, enabled: true });
  delete process.env.KTV_NPU_ENDPOINT;
  assert.equal(npuConfig(saved).endpoint, "", "ARM Compose must not reuse a retired NPU address");
  const arm = providerConfig({ enabled: true, cpuEnabled: true }, saved);
  assert.equal(arm.npuEnabled, true, "Keep the saved switch when an ARM host has no NPU container");
  assert.deepEqual(providerCandidates(arm).map((c) => c.npu ? "npu" : "cpu"), ["cpu"]);
});
