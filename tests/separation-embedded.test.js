import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { startEmbeddedSeparation } from "../server/separation/embedded.js";
import { providerCandidates } from "../server/separation/providers.js";
import { createApp } from "../server/app.js";

function environment(t, patch) {
  const old = Object.fromEntries(
    Object.keys(patch).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, patch);
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
}

for (const npu of [false, true])
  test(`embedded startup, private binding, cache inheritance and shutdown: NPU=${npu}`, async () => {
    const calls = [],
      children = [],
      killed = [];
    const env = {
      KTV_EMBEDDED_SEPARATION: "1",
      DATA_DIR: path.resolve("test-results/embedded-fixture"),
    };
    const service = await startEmbeddedSeparation({
      env,
      platform: "linux",
      log: () => {},
      sleep: async () => {},
      exists: (file) => file !== "/dev/accel/accel0" || npu,
      fetchHealth: async (url, options) => {
        assert.equal(url, "http://127.0.0.1:18002/health");
        assert.equal(
          options.headers.Authorization,
          "Bearer " + env.KTV_EMBEDDED_KEY,
        );
        return { ok: true };
      },
      spawnProcess: (command, args, options) => {
        calls.push({ command, args, options });
        const child = new EventEmitter();
        child.pid = 900000 + children.length;
        children.push(child);
        return child;
      },
      killGroup: (pid, signal) => {
        killed.push([pid, signal]);
        children.find((c) => c.pid === -pid).emit("close", 0);
      },
    });
    assert.equal(calls.length, npu ? 2 : 1);
    assert.match(env.KTV_EMBEDDED_KEY, /^[a-f0-9]{64}$/);
    for (const call of calls) {
      assert.equal(call.command, "nice");
      assert.deepEqual(call.args.slice(0, 3), [
        "-n",
        "10",
        "/opt/separator/bin/python",
      ]);
      assert.equal(call.args[call.args.indexOf("--host") + 1], "127.0.0.1");
      assert.equal(call.options.env.SEPARATION_CONCURRENCY, "1");
      assert.equal(
        call.options.env.TORCH_HOME,
        path.join(env.DATA_DIR, "separator", "models"),
      );
      assert.equal(
        call.options.env.NPU_CACHE_DIR,
        path.join(env.DATA_DIR, "npu", "npu-cache"),
      );
      assert.equal(call.options.env.SEPARATION_TIMEOUT_SECONDS, "21600");
      assert.ok(call.options.env.SEPARATION_DATA_DIR.includes("separation"));
    }
    await service.stop();
    assert.equal(killed.length, calls.length);
    assert.ok(killed.every(([, signal]) => signal === "SIGTERM"));
  });

test("normal source runtime never starts an embedded child", async () => {
  const service = await startEmbeddedSeparation({
    env: {},
    spawnProcess: () => {
      throw Error("unexpected process");
    },
  });
  await service.stop();
});

test("unified switches preserve PC credentials and saved tasks; status never exposes credentials", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-embedded-settings-"));
  const remote = express();
  remote.get("/:kind/health", (req, res) => {
    assert.equal(
      req.get("authorization"),
      req.params.kind === "pc" ? "Bearer saved-pc-key" : "Bearer local-key",
    );
    res.json({
      protocol: "ktv-separation-v1",
      backend: req.params.kind === "npu" ? "openvino-npu" : "demucs",
      device: "cpu",
      ready: true,
      models: ["htdemucs"],
      pending: 0,
    });
  });
  const worker = remote.listen(0, "127.0.0.1");
  await new Promise((resolve) => worker.once("listening", resolve));
  const base = `http://127.0.0.1:${worker.address().port}`;
  environment(t, {
    KTV_EMBEDDED_SEPARATION: "1",
    KTV_EMBEDDED_KEY: "local-key",
    KTV_EMBEDDED_CPU_ENDPOINT: base + "/cpu",
    KTV_EMBEDDED_NPU_ENDPOINT: base + "/npu",
  });
  const service = createApp({
    dataDir: path.join(dir, "data"),
    downloads: path.join(dir, "downloads"),
    roots: [path.join(dir, "media")],
    adminToken: "embedded-admin-fixture",
    worker: false,
    discovery: false,
    watch: false,
  });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await service.close();
    server.closeAllConnections();
    worker.closeAllConnections();
    await Promise.all([
      new Promise((r) => server.close(r)),
      new Promise((r) => worker.close(r)),
    ]);
    await rm(dir, { recursive: true, force: true });
  });
  const old = {
    enabled: true,
    autoDiscover: false,
    pcEndpoint: base + "/pc",
    pcApiKey: "saved-pc-key",
    pcModel: "htdemucs_ft",
    npuEndpoint: "http://retired-npu:8001",
    npuApiKey: "retired-key",
    npuEnabled: true,
    customProperty: "retained",
  };
  service.store.set("ai", old);
  service.store.set("separation:existing:checkpoint", {
    requestId: "saved-task",
  });
  const url = `http://127.0.0.1:${server.address().port}/api/admin/separation`;
  assert.equal((await fetch(url)).status, 401);
  const headers = {
    Authorization: "Bearer embedded-admin-fixture",
    "Content-Type": "application/json",
  };
  const status = await (await fetch(url, { headers })).json();
  assert.ok(status.providers.every((p) => p.ready));
  assert.equal(
    status.providers.find((p) => p.kind === "npu").source,
    "内置服务",
  );
  assert.doesNotMatch(
    JSON.stringify(status),
    /saved-pc-key|local-key|retired|http:/,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          cpuEnabled: false,
          pcEnabled: false,
          pcApiKey: "overwrite-attempt",
        }),
      })
    ).status,
    200,
  );
  assert.deepEqual(service.store.get("ai"), {
    ...old,
    cpuEnabled: false,
    pcEnabled: false,
  });
  assert.deepEqual(service.store.get("separation:existing:checkpoint"), {
    requestId: "saved-task",
  });
  assert.equal(
    (await fetch(url, { method: "POST", headers, body: '{"enabled":"false"}' }))
      .status,
    400,
  );
  assert.deepEqual(
    providerCandidates(service.store.get("ai")).map((c) =>
      c.npu ? "npu" : c.cpu ? "cpu" : "pc",
    ),
    ["npu"],
  );
});
