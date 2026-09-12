import { taskSignal } from "./task-cancellation.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { setPriority, constants } from "node:os";
export function run(
  binary,
  args,
  timeout = 120000,
  maxOutput = 8 * 1024 * 1024,
  onOutput,
) {
  return new Promise((resolve, reject) => {
    const task = taskSignal();
    task?.throwIfAborted();
    const media = /^ffmpeg(?:\.exe)?$/i.test(path.basename(binary));
    if (media) {
      // Bound both decoder and encoder pools on the NAS; demucs runs on PC.
      args = [
        "-threads",
        "2",
        "-filter_threads",
        "1",
        "-filter_complex_threads",
        "1",
        ...args,
      ];
      args = [...args.slice(0, -1), "-threads", "2", args.at(-1)];
    }
    const child = spawn(binary, args, {
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (media && child.pid) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {}
    }
    let out = "",
      err = "",
      failure;
    const kill = () => {
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {}
      }
      child.kill("SIGKILL");
    };
    const abort = () => {
      failure = task.reason;
      kill();
    };
    task?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      failure = new Error("处理超时，请稍后重试");
      kill();
    }, timeout);
    child.stdout.on("data", (d) => {
      if (task?.aborted) return;
      out += d;
      try {
        onOutput?.(d.toString());
      } catch (error) {
        failure = error;
        kill();
        return;
      }
      if (out.length > maxOutput) {
        failure = new Error("工具输出过大");
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (d) => {
      err = (err + d).slice(-4000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      task?.removeEventListener("abort", abort);
      reject(
        new Error(
          e.code === "ENOENT"
            ? `${binary} 未安装；请使用 Docker 运行完整媒体功能`
            : e.message,
        ),
      );
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      task?.removeEventListener("abort", abort);
      code === 0 && !failure
        ? resolve(out)
        : reject(
            failure ||
              new Error(err || `${binary} 处理失败 (${signal || code})`),
          );
    });
  });
}
