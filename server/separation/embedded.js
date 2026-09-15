import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Both workers are private child processes in the main NAS container. Models
// load in per-job subprocesses, so idle HTTP workers do not retain model RAM.
export async function startEmbeddedSeparation({
  env = process.env,
  spawnProcess = spawn,
  exists = existsSync,
  fetchHealth = fetch,
  sleep = delay,
  log = console.warn,
  platform = process.platform,
  killGroup = process.kill,
} = {}) {
  if (env.KTV_EMBEDDED_SEPARATION !== "1") return { stop: async () => {} };
  env.KTV_EMBEDDED_KEY ||= randomBytes(32).toString("hex");
  const directory = env.KTV_SEPARATOR_DIR || "/opt/haohaochang-separator";
  const python = env.KTV_SEPARATOR_PYTHON || "/opt/separator/bin/python";
  const data = path.resolve(env.DATA_DIR || "/data");
  const models = exists(path.join(data, "separator", "models"))
    ? path.join(data, "separator", "models")
    : path.join(data, "models");
  const npuCache = exists(path.join(data, "npu", "npu-cache"))
    ? path.join(data, "npu", "npu-cache")
    : path.join(data, "npu-cache");
  let stopped = false;
  const workers = new Set(),
    timers = new Set();
  function launch(backend, port) {
    if (stopped) return;
    const args = [
      "-m",
      "uvicorn",
      "app:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--no-access-log",
    ];
    const child = spawnProcess(
      platform === "win32" ? python : "nice",
      platform === "win32" ? args : ["-n", "10", python, ...args],
      {
        cwd: directory,
        detached: platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "inherit", "inherit"],
        env: {
          ...env,
          SEPARATION_API_KEY: env.KTV_EMBEDDED_KEY,
          SEPARATION_BACKEND: backend,
          SEPARATION_DEVICE: backend === "openvino-npu" ? "NPU" : "cpu",
          SEPARATION_DATA_DIR: path.join(data, "separation", backend),
          TORCH_HOME: models,
          NPU_CACHE_DIR: npuCache,
          NPU_MODEL_PATH: "/opt/models/htdemucs_fwd.xml",
          SEPARATION_CONCURRENCY: "1",
          SEPARATION_TIMEOUT_SECONDS: "21600",
          SEPARATION_SEGMENT: "4",
          OMP_NUM_THREADS: "2",
          MKL_NUM_THREADS: "2",
          OPENBLAS_NUM_THREADS: "2",
          KTV_EMBEDDED_WORKER: "1",
          PYTHONUNBUFFERED: "1",
          PYTHONUTF8: "1",
        },
      },
    );
    workers.add(child);
    child.on("error", (error) =>
      log(`内置 ${backend} 分离服务启动失败：${error.code || error.message}`),
    );
    child.once("close", () => {
      workers.delete(child);
      if (!stopped) {
        log(`内置 ${backend} 分离服务退出，稍后重启；任务断点保留`);
        const timer = setTimeout(() => {
          timers.delete(timer);
          launch(backend, port);
        }, 5000);
        timer.unref?.();
        timers.add(timer);
      }
    });
  }
  const stop = async () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    const active = [...workers];
    const kill = (child, signal) => {
      if (!workers.has(child)) return;
      try {
        if (platform !== "win32" && child.pid) killGroup(-child.pid, signal);
        else child.kill(signal);
      } catch {}
    };
    for (const child of active) kill(child, "SIGTERM");
    const timeout = setTimeout(() => {
      for (const child of active) kill(child, "SIGKILL");
    }, 5000);
    timeout.unref?.();
    await Promise.all(
      active.map((child) =>
        workers.has(child)
          ? new Promise((resolve) => child.once("close", resolve))
          : undefined,
      ),
    );
    clearTimeout(timeout);
  };
  if (!exists(python) || !exists(path.join(directory, "app.py"))) {
    log("内置分离运行环境缺失，请使用完整好好唱 NAS 镜像");
    return { stop };
  }
  launch("demucs", 18002);
  if (exists("/dev/accel/accel0") && exists("/opt/models/htdemucs_fwd.xml"))
    launch("openvino-npu", 18001);
  // Avoid consuming queued songs before the lightweight local API is ready.
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetchHealth("http://127.0.0.1:18002/health", {
        headers: { Authorization: "Bearer " + env.KTV_EMBEDDED_KEY },
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return { stop };
    } catch {}
    await sleep(250);
  }
  log("内置 CPU 分离服务仍在启动；可在自动整理设置检查状态");
  return { stop };
}
