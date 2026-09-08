import { spawn } from "node:child_process";
export function run(
  binary,
  args,
  timeout = 120000,
  maxOutput = 8 * 1024 * 1024,
) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "",
      failure;
    const timer = setTimeout(() => {
      failure = new Error("处理超时，请稍后重试");
      child.kill("SIGKILL");
    }, timeout);
    child.stdout.on("data", (d) => {
      out += d;
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
      reject(
        new Error(
          e.code === "ENOENT"
            ? `${binary} 未安装；请使用 Docker 运行完整媒体功能`
            : e.message,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 && !failure
        ? resolve(out)
        : reject(failure || new Error(err || `${binary} 处理失败 (${code})`));
    });
  });
}
