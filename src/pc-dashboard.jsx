import React, { useEffect, useState } from "react";
import { statusNames } from "./view-constants.js";
import { PCSettings } from "./settings.jsx";
const stageNames = {
  clipping: "裁剪片段",
  downloading: "下载视频",
  decoding: "提取音频",
  separating: "去除人声",
  preparing: "准备播放资源",
  validating: "校验分离音轨",
  running: "处理中",
  done: "已完成",
  "waiting-worker": "等待 PC 上线",
};
export function PcDashboard({ embedded = false }) {
  const [token, setToken] = useState(
      sessionStorage.getItem("adminToken") || "",
    ),
    [password, setPassword] = useState(""),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    if (!embedded) document.title = "好好唱 · PC 整理状态";
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
  const Wrapper = embedded ? "div" : "main";
  return (
    <Wrapper className={`pc-dashboard ${embedded ? "pc-embedded" : ""}`}>
      <div className="section-heading">
        <div>
          <h1>PC 整理状态</h1>
          <p>下载 → 按需裁剪 → 提取音频 → 去除人声 → 入库</p>
        </div>
        {!embedded && <a href="/admin">返回管理页面</a>}
      </div>
      <section className="settings-card pc-connection">
        <strong>{data?.message || "正在读取状态…"}</strong>
        {data?.endpoint && <p>当前检测地址：{data.endpoint}</p>}
        <p>
          在电脑上运行 start.cmd 后即可离开；在此页面查看任务，无需打开 PC
          浏览器。
        </p>
        <button onClick={() => setReload((v) => v + 1)}>刷新状态</button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const response = await fetch("/api/admin/pc/logs", {
                headers: { Authorization: "Bearer " + token },
              });
              if (!response.ok)
                throw new Error("日志导出失败，请检查管理登录状态");
              const url = URL.createObjectURL(await response.blob());
              const link = document.createElement("a");
              link.href = url;
              link.download = `好好唱诊断-${new Date().toISOString().slice(0, 10)}.json`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          导出诊断日志
        </button>
      </section>
      {error && <p role="alert">{error}</p>}
      <PCSettings onSaved={() => setReload((v) => v + 1)} />
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
            <p>
              下方耗时仅指该 PC 任务（包含排队），完整入库还包括 NAS
              上传、资源生成与校验。
            </p>
            {worker.jobs.length ? (
              worker.jobs.map((j) => (
                <article className="pc-job" key={j.id}>
                  <strong>{j.title || "歌曲整理"}</strong>
                  <p>
                    {stageNames[j.stage] || statusNames[j.status] || "处理中"} ·
                    PC 任务耗时 {Math.floor((j.elapsed_seconds || 0) / 60)} 分{" "}
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
                {j.started
                  ? ` · ${j.finished ? "处理耗时" : "已处理"} ${Math.max(0, Math.round(((j.finished || Date.now()) - j.started) / 1000))} 秒`
                  : ""}
              </p>
              {j.error && <p className="error">{j.error}</p>}
            </article>
          ))
        ) : (
          <p>还没有整理任务。</p>
        )}
      </section>
    </Wrapper>
  );
}
