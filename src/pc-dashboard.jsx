import { TaskList } from "./task-list.jsx";
import { TaskActions } from "./task-actions.jsx";
import React, { useEffect, useState } from "react";
import { PCSettings } from "./settings.jsx";
import { PcUpdate } from "./pc-update.jsx";
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
          // Retain the last useful progress while a poll is temporarily unavailable.
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
      {error && <p role="alert">{error}</p>}
      <PcUpdate
        worker={worker}
        token={token}
        onChange={() => setReload((v) => v + 1)}
      />
      <section className="settings-card">
        <h2>整理任务中心</h2>
        <p>
          NAS 负责完整入库，PC 显示本机执行步骤。PC 同时处理上限：
          {worker?.concurrency || 1} 首。
        </p>
        <TaskList
          label="整理任务"
          jobs={[
            ...(data?.tasks || []).map((j) => ({
              ...j,
              id: "nas-" + j.id,
              sourceId: j.id,
              origin: "NAS",
            })),
            ...(worker?.jobs || []).map((j) => ({
              ...j,
              id: "pc-" + j.id,
              origin: "PC",
            })),
          ]}
          actions={(job) =>
            job.origin === "NAS" && (
              <TaskActions
                job={{ ...job, id: job.sourceId }}
                refresh={() => setReload((value) => value + 1)}
                request={async (url, body, method) => {
                  const response = await fetch("/api" + url, {
                    method,
                    headers: {
                      Authorization: "Bearer " + token,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify(body),
                  });
                  const result = await response.json();
                  if (!response.ok)
                    throw new Error(result.error || "任务操作失败，请重试");
                  return result;
                }}
              />
            )
          }
        />
      </section>
      {worker && (
        <>
          {" "}
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
              <strong>
                {worker.gpu
                  ? (worker.gpu.busiest ?? worker.gpu.utilization ?? "—") + "%"
                  : "—"}
              </strong>
              <small>{worker.gpu_name}</small>
              {worker.gpu && (
                <small>
                  计算 {worker.gpu.utilization ?? "—"}% · 编码{" "}
                  {worker.gpu.encoder ?? "—"}% · 解码{" "}
                  {worker.gpu.decoder ?? "—"}%
                </small>
              )}
            </div>
          </div>
        </>
      )}{" "}
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
      <details className="settings-card">
        <summary>PC 连接设置</summary>
        <PCSettings onSaved={() => setReload((v) => v + 1)} />
      </details>
    </Wrapper>
  );
}
