import React, { useState } from "react";
const labels = {
  idle: "尚未检查新版",
  checking: "正在检查新版",
  available: "有新版本可安装",
  current: "已是最新版本",
  downloading: "正在下载更新",
  waiting: "等待当前任务完成",
  installing: "正在安装",
  restarting: "正在重新启动",
  complete: "更新完成",
  failed: "更新失败",
  cancelled: "已取消更新",
};
export function PcUpdate({ worker, token, onChange }) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const update = worker?.update;
  async function action(name) {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/pc/update/" + name, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version: update?.latest }),
      });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || "更新失败");
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="settings-card">
      <h2>
        PC 应用更新 <small>{worker?.version && "v" + worker.version}</small>
      </h2>
      <p role="status">
        {update
          ? labels[update.phase] || update.phase
          : "首次启用需要手动安装带更新功能的整理器。"}
        {update?.latest && " · v" + update.latest}
        {update?.phase === "downloading" && " · " + update.progress + "%"}
      </p>
      {(error || update?.error) && <p role="alert">{error || update.error}</p>}
      <p>更新会等本机任务完成后重启，保留配置、模型和任务数据。</p>
      <button
        disabled={
          pending ||
          !worker ||
          [
            "checking",
            "downloading",
            "waiting",
            "installing",
            "restarting",
          ].includes(update?.phase)
        }
        onClick={() => action("check")}
      >
        {pending ? "处理中…" : "检查更新"}
      </button>
      {update?.phase === "available" && (
        <button
          disabled={pending}
          className="primary"
          onClick={() => action("install")}
        >
          安装新版
        </button>
      )}
      {["downloading", "waiting"].includes(update?.phase) && (
        <button disabled={pending} onClick={() => action("cancel")}>
          取消更新
        </button>
      )}
    </section>
  );
}
