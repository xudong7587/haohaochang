import React, { useEffect, useState } from "react";
import { statusNames } from "./view-constants.js";
const stageNames = {
  clipping: "裁剪片段",
  downloading: "下载视频",
  decoding: "提取音频",
  separating: "去除人声",
  preparing: "准备播放资源",
  running: "处理中",
  done: "已完成",
  "waiting-worker": "等待 PC 上线",
};
export function PcDashboard() {
  const [token, setToken] = useState(
      sessionStorage.getItem("adminToken") || "",
    ),
    [password, setPassword] = useState(""),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    document.title = "好好唱 · PC 整理状态";
  }, []);
  useEffect(() => {
    if (!token) return;
    let live = true,
      timer;
    const abort = new AbortController();
    async function read() {
      try {
        const r = await fetch("/api/admin/pc/status", {
          headers: { Authorization: "Bearer " + token },
          signal: abort.signal,
        });
        if (r.status === 401) {
          if (live) {
            sessionStorage.removeItem("adminToken");
            setToken("");
            setError("请输入正确的 NAS 管理密码");
          }
          return;
        }
        if (!r.ok) throw new Error("NAS 状态暂时无法读取");
        const next = await r.json();
        if (live) {
          sessionStorage.setItem("adminToken", token);
          setData(next);
          setError("");
        }
      } catch (e) {
        if (live) {
          setError(e.message);
          setData(null);
        }
      } finally {
        if (live) {
          setBusy(false);
          timer = setTimeout(read, 5000);
        }
      }
    }
    read();
    return () => {
      live = false;
      abort.abort();
      clearTimeout(timer);
    };
  }, [token, reload]);
  if (!token)
    return (
      <main className="pc-login login-card">
        <h1>PC 整理状态</h1>
        <p>使用 NAS 管理密码登录。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setToken(password);
          }}
        >
          <label>
            管理密码
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            查看状态
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        <a href="/admin">返回管理页面</a>
      </main>
    );
  const worker = data?.worker;
  return (
    <main className="pc-dashboard">
      <div className="section-heading">
        <div>
          <h1>PC 整理状态</h1>
          <p>下载 → 按需裁剪 → 提取音频 → 去除人声 → 入库</p>
        </div>
        <a href="/admin">返回管理页面</a>
      </div>
      <section className="settings-card pc-connection">
        <strong>{data?.message || "正在读取状态…"}</strong>
        <p>
          在电脑上运行 start.cmd 后即可离开；在此页面查看任务，无需打开 PC
          浏览器。
        </p>
        <button onClick={() => setReload((v) => v + 1)}>刷新状态</button>
      </section>
      {error && <p role="alert">{error}</p>}
      {worker && (
        <>
          <div className="stats">
            <div>
              <span>CPU</span>
              <strong>{worker.cpu}%</strong>
            </div>
            <div>
              <span>内存</span>
              <strong>{worker.memory.used_gb} GB</strong>
              <small>共 {worker.memory.total_gb} GB</small>
            </div>
            <div>
              <span>{worker.device === "cuda" ? "GPU 加速" : "CPU 模式"}</span>
              <strong>{worker.gpu ? worker.gpu.utilization + "%" : "—"}</strong>
              <small>{worker.gpu_name}</small>
            </div>
          </div>
          <section className="settings-card">
            <h2>PC 当前任务</h2>
            {worker.jobs.length ? (
              worker.jobs.map((j) => (
                <article className="pc-job" key={j.id}>
                  <strong>{j.title || "歌曲整理"}</strong>
                  <p>
                    {stageNames[j.stage] || statusNames[j.status] || "处理中"} ·
                    已经过 {Math.floor((j.elapsed_seconds || 0) / 60)} 分{" "}
                    {(j.elapsed_seconds || 0) % 60} 秒
                  </p>
                  {j.error && <p className="error">{j.error}</p>}
                  {j.log && (
                    <details>
                      <summary>查看日志</summary>
                      <pre>{j.log}</pre>
                    </details>
                  )}
                </article>
              ))
            ) : (
              <p>还没有 PC 任务，在线选好视频后会自动开始。</p>
            )}
          </section>
        </>
      )}
      <section className="settings-card">
        <h2>NAS 整理队列</h2>
        {data?.tasks?.length ? (
          data.tasks.map((j) => (
            <article className="pc-job" key={j.id}>
              <strong>
                {j.title || "后台任务"}
                {j.artist ? " · " + j.artist : ""}
              </strong>
              <p>
                {statusNames[j.status] || j.status}
                {j.status === "running" && stageNames[j.stage]
                  ? " · " + stageNames[j.stage]
                  : ""}
              </p>
              {j.error && <p className="error">{j.error}</p>}
            </article>
          ))
        ) : (
          <p>还没有整理任务。</p>
        )}
      </section>
    </main>
  );
}
