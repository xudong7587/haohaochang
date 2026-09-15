import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { openStore } from "../server/db.js";
import { run, prepareSong } from "../server/media.js";
import { separateSong } from "../server/separation.js";
import { separateRecording } from "../server/separation/recording.js";
import { providerConfig } from "../server/separation/config.js";
import { runProviderJob } from "../server/separation/protocol.js";
import { validateResult } from "../server/separation/validation.js";
process.env.FFMPEG = ffmpeg;
process.env.FFPROBE = ffprobe.path;

test("NPU-only configuration is allowed and survives edits to cloud/PC fields", () => {
  const config = providerConfig({
    enabled: true,
    autoDiscover: false,
    npuEnabled: true,
    npuEndpoint: "http://localhost:8001",
    npuApiKey: "npu-secret",
  });
  const next = providerConfig(
    { ...config, endpoint: "https://example.com", model: "htdemucs" },
    config,
  );
  assert.equal(next.npuEnabled, true);
  assert.equal(next.npuApiKey, "npu-secret");
  assert.throws(() =>
    providerConfig({ ...config, npuEndpoint: "file:///tmp/socket" }),
  );
});

for (const replacement of [false, true]) {
  for (const scenario of [
    "pc",
    "npu",
    "cloud",
    "unqualified",
    "bad-pc-audio",
  ]) {
    test(`${replacement ? "replacement" : "new song"} priority and fallback: ${scenario}`, async (t) => {
      const f = await fixture(t);
      const calls = [];
      for (const kind of ["pc", "npu", "cloud"]) {
        f.remote.get(`/${kind}/health`, (req, res) => {
          if (kind === "pc" && !["pc", "bad-pc-audio"].includes(scenario))
            return res.sendStatus(503);
          res.json({
            protocol: "ktv-separation-v1",
            backend: kind === "npu" ? "openvino-npu" : "demucs",
            ready: scenario !== "unqualified",
            models: ["htdemucs"],
          });
        });
        f.remote.post(`/${kind}/separate`, (req, res) => {
          calls.push(kind);
          if (kind === "npu" && scenario === "cloud")
            return res.json({ status: "failed", error: "NPU runtime failed" });
          res.json({
            status: "done",
            instrumental_url:
              kind === "pc" && scenario === "bad-pc-audio"
                ? "/bad"
                : "/artifact",
          });
        });
      }
      f.remote.get("/bad", (req, res) => res.send("corrupt audio"));
      f.store.set("ai", {
        enabled: true,
        pcEndpoint: f.config.endpoint + "/pc",
        npuEnabled: true,
        npuEndpoint: f.config.endpoint + "/npu",
        endpoint: f.config.endpoint + "/cloud",
        model: "htdemucs",
      });
      if (replacement)
        await separateRecording(f.store, f.song, f.vocal, f.cache);
      else await separateSong(f.store, f.song, f.cache);
      assert.deepEqual(
        calls,
        {
          pc: ["pc"],
          npu: ["npu"],
          cloud: ["npu", "cloud"],
          unqualified: ["cloud"],
          "bad-pc-audio": ["pc", "npu"],
        }[scenario],
      );
    });
  }
}

for (const replacement of [false, true]) {
  for (const scenario of [
    "pc",
    "npu",
    "cpu",
    "bad-cpu",
    "disabled-cpu",
    "busy-pc",
  ]) {
    test(`${replacement ? "replacement" : "new song"} embedded fallback: ${scenario}`, async (t) => {
      const f = await fixture(t),
        calls = [];
      const keys = [
        "KTV_EMBEDDED_SEPARATION",
        "KTV_EMBEDDED_CPU_ENDPOINT",
        "KTV_EMBEDDED_NPU_ENDPOINT",
      ];
      const old = keys.map((key) => process.env[key]);
      Object.assign(process.env, {
        KTV_EMBEDDED_SEPARATION: "1",
        KTV_EMBEDDED_CPU_ENDPOINT: f.config.endpoint + "/cpu",
        KTV_EMBEDDED_NPU_ENDPOINT: f.config.endpoint + "/npu",
      });
      t.after(() =>
        keys.forEach((key, i) => {
          if (old[i] === undefined) delete process.env[key];
          else process.env[key] = old[i];
        }),
      );
      for (const kind of ["pc", "npu", "cpu", "cloud"]) {
        f.remote.get(`/${kind}/health`, (req, res) => {
          if (kind === "pc" && !["pc", "busy-pc"].includes(scenario))
            return res.sendStatus(503);
          res.json({
            protocol: "ktv-separation-v1",
            backend: kind === "npu" ? "openvino-npu" : "demucs",
            device: "cpu",
            ready: ["pc", "npu", "busy-pc"].includes(scenario),
            busy: kind === "pc" && scenario === "busy-pc",
            models: ["htdemucs"],
          });
        });
        f.remote.post(`/${kind}/separate`, (req, res) => {
          calls.push(kind);
          res.json({
            status: "done",
            instrumental_url:
              kind === "cpu" && scenario === "bad-cpu"
                ? "/corrupt"
                : "/artifact",
          });
        });
      }
      f.remote.get("/corrupt", (req, res) => res.send("invalid audio"));
      f.store.set("ai", {
        enabled: true,
        pcEndpoint: f.config.endpoint + "/pc",
        cpuEnabled: scenario !== "disabled-cpu",
        endpoint: f.config.endpoint + "/cloud",
        model: "htdemucs",
      });
      if (replacement)
        await separateRecording(f.store, f.song, f.vocal, f.cache);
      else await separateSong(f.store, f.song, f.cache);
      assert.deepEqual(
        calls,
        {
          pc: ["pc"],
          npu: ["npu"],
          cpu: ["cpu"],
          "bad-cpu": ["cpu", "cloud"],
          "disabled-cpu": ["cloud"],
          "busy-pc": ["npu"],
        }[scenario],
      );
    });
  }
}

test("saved CPU task resumes before newly connected PC and uploads only once", async (t) => {
  const f = await fixture(t),
    calls = [];
  const old = process.env.KTV_EMBEDDED_SEPARATION,
    oldCpu = process.env.KTV_EMBEDDED_CPU_ENDPOINT;
  process.env.KTV_EMBEDDED_SEPARATION = "1";
  process.env.KTV_EMBEDDED_CPU_ENDPOINT = f.config.endpoint;
  t.after(() => {
    if (old === undefined) delete process.env.KTV_EMBEDDED_SEPARATION;
    else process.env.KTV_EMBEDDED_SEPARATION = old;
    if (oldCpu === undefined) delete process.env.KTV_EMBEDDED_CPU_ENDPOINT;
    else process.env.KTV_EMBEDDED_CPU_ENDPOINT = oldCpu;
  });
  let polls = 0;
  f.remote.get("/health", (req, res) =>
    res.json({
      protocol: "ktv-separation-v1",
      backend: "demucs",
      device: "cpu",
      models: ["htdemucs"],
    }),
  );
  f.remote.post("/separate", (req, res) => {
    calls.push("cpu");
    res.json({ id: "cpu_existing", status: "running" });
  });
  f.remote.get("/jobs/cpu_existing", (req, res) => {
    if (++polls === 1) return res.sendStatus(503);
    res.json({ status: "done", instrumental_url: "/artifact" });
  });
  f.remote.get("/pc/health", (req, res) => {
    calls.push("pc");
    res.json({ protocol: "ktv-separation-v1" });
  });
  f.remote.post("/pc/separate", (req, res) => {
    calls.push("pc-request");
    res.sendStatus(503);
  });
  await assert.rejects(
    runProviderJob(f.store, f.song, f.vocal, f.cache, {
      endpoint: f.config.endpoint + "/pc",
      model: "htdemucs",
      pc: true,
    }),
    /503/,
  );
  const cpu = { endpoint: f.config.endpoint, model: "htdemucs", cpu: true };
  await assert.rejects(
    runProviderJob(f.store, f.song, f.vocal, f.cache, cpu),
    /503/,
  );
  f.reopen().set("ai", {
    enabled: true,
    npuEnabled: false,
    pcEndpoint: f.config.endpoint + "/pc",
  });
  await separateSong(f.store, f.song, f.cache);
  assert.deepEqual(calls, ["pc-request", "cpu"]);
});

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-separation-"));
  const cache = path.join(dir, "cache");
  await mkdir(cache);
  let store = openStore(path.join(dir, "db"));
  const source = path.join(dir, "source.wav");
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    source,
  ]);
  store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,created) VALUES (?,?,?,?,?)",
    )
    .run("song", source, "测试", "测试", Date.now());
  await prepareSong(store, "song", [dir], cache);
  const song = store.db.prepare("SELECT * FROM songs WHERE id=?").get("song");
  const vocal = path.join(store.get("package:song"), "原唱.m4a");
  const remote = express();
  remote.use(express.raw({ type: () => true, limit: "5mb" }));
  remote.get("/artifact", (req, res) => res.sendFile(source));
  const server = remote.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const config = {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    model: "test",
  };
  t.after(async () => {
    server.close();
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    cache,
    source,
    vocal,
    song,
    remote,
    config,
    get store() {
      return store;
    },
    reopen() {
      store.db.close();
      store = openStore(path.join(dir, "db"));
      return store;
    },
  };
}

test("NAS restart resumes saved remote job without another upload", async (t) => {
  const f = await fixture(t);
  let submits = 0,
    polls = 0;
  f.remote.post("/separate", (req, res) => {
    submits++;
    res.json({ id: "resume_job", status: "queued" });
  });
  f.remote.get("/jobs/resume_job", (req, res) => {
    polls++;
    if (polls === 1) return res.sendStatus(503);
    res.json({ status: "done", instrumental_url: "/artifact" });
  });
  await assert.rejects(
    runProviderJob(f.store, f.song, f.vocal, f.cache, f.config),
    /503/,
  );
  const result = await runProviderJob(
    f.reopen(),
    f.song,
    f.vocal,
    f.cache,
    f.config,
  );
  assert.equal(submits, 1);
  assert.equal(polls, 2);
  await validateResult(f.vocal, result.file);
});

test("uncertain POST retry retains idempotency key; explicit failed result starts fresh request", async (t) => {
  const f = await fixture(t);
  const keys = [];
  f.remote.post("/separate", (req, res) => {
    keys.push(req.get("idempotency-key"));
    if (keys.length === 1) return res.sendStatus(503);
    if (keys.length === 2)
      return res.json({
        id: "failed_job",
        status: "failed",
        error: "Service restarted; retry from NAS",
      });
    res.json({ status: "done", instrumental_url: "/artifact" });
  });
  await assert.rejects(
    runProviderJob(f.store, f.song, f.vocal, f.cache, f.config),
    /503/,
  );
  await assert.rejects(
    runProviderJob(f.reopen(), f.song, f.vocal, f.cache, f.config),
    /Service restarted/,
  );
  await runProviderJob(f.store, f.song, f.vocal, f.cache, f.config);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});

test("invalid output is rejected before old accompaniment changes and staging is cleaned", async (t) => {
  const f = await fixture(t);
  const short = path.join(f.dir, "short.wav");
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=0.2",
    short,
  ]);
  f.remote.post("/separate", (req, res) =>
    res.json({ status: "done", instrumental_url: "/short" }),
  );
  f.remote.get("/short", (req, res) => res.sendFile(short));
  const backing = path.join(f.store.get("package:song"), "伴奏.m4a");
  await writeFile(backing, "previous accompaniment");
  f.store.set("ai", { enabled: true, ...f.config });
  await assert.rejects(separateSong(f.store, f.song, f.cache), /时长不匹配/);
  assert.equal(await readFile(backing, "utf8"), "previous accompaniment");
  assert.deepEqual(await readdir(path.join(f.cache, "separation-tasks")), []);
  assert.equal(
    f.store.db.prepare("SELECT mode FROM songs WHERE id=?").get("song").mode,
    "original",
  );
  const broken = path.join(f.dir, "broken.wav");
  await writeFile(broken, "not audio");
  await assert.rejects(validateResult(f.vocal, broken));
  const dual = path.join(f.dir, "dual.mka");
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-i",
    f.source,
    "-map",
    "0:a",
    "-map",
    "0:a",
    "-c:a",
    "copy",
    dual,
  ]);
  await assert.rejects(validateResult(f.vocal, dual), /一条有效音轨/);
});

test("busy PC chooses cloud, but a PC checkpoint resumes its own job while busy", async (t) => {
  const f = await fixture(t);
  let pcSubmits = 0,
    cloudSubmits = 0,
    polls = 0;
  f.remote.get("/pc/health", (req, res) =>
    res.json({ protocol: "ktv-separation-v1", busy: true, pending: 1 }),
  );
  f.remote.post("/pc/separate", (req, res) => {
    pcSubmits++;
    res.json({ status: "queued", id: "pc_job" });
  });
  f.remote.get("/pc/jobs/pc_job", (req, res) => {
    polls++;
    if (polls === 1) return res.sendStatus(503);
    res.json({ status: "done", instrumental_url: "/artifact" });
  });
  f.remote.post("/separate", (req, res) => {
    cloudSubmits++;
    res.json({ status: "done", instrumental_url: "/artifact" });
  });
  f.store.set("ai", {
    enabled: true,
    ...f.config,
    pcEndpoint: f.config.endpoint + "/pc",
    pcModel: "test",
  });
  await separateSong(f.store, f.song, f.cache);
  assert.equal(pcSubmits, 0);
  assert.equal(cloudSubmits, 1);
  const pc = { ...f.config, endpoint: f.config.endpoint + "/pc" };
  await assert.rejects(
    runProviderJob(f.store, f.song, f.vocal, f.cache, pc),
    /503/,
  );
  await separateSong(f.store, f.song, f.cache);
  assert.equal(pcSubmits, 1);
  assert.equal(cloudSubmits, 1);
  assert.equal(polls, 2);
});

test("missing accompaniment regenerates despite a stale separated database flag", async (t) => {
  const f = await fixture(t);
  let uploads = 0;
  f.remote.post("/separate", (req, res) => {
    uploads++;
    res.json({ status: "done", instrumental_url: "/artifact" });
  });
  f.store.set("ai", { enabled: true, ...f.config });
  await separateSong(f.store, { ...f.song, mode: "separated" }, f.cache);
  assert.equal(uploads, 1);
  assert.ok(
    (await readFile(path.join(f.store.get("package:song"), "伴奏.m4a")))
      .length > 1000,
  );
});
