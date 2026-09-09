import React, { useEffect, useState } from "react";
async function request(path, body) {
  const r = await fetch("/api/admin/ai" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + sessionStorage.getItem("adminToken"),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "请求失败");
  return data;
}
function ConnectionSettings({ kind, onSaved }) {
  const pc = kind === "pc";
  const [config, setConfig] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  useEffect(() => {
    let live = true;
    request("")
      .then((v) => {
        if (live) setConfig({ ...v, apiKey: "", pcApiKey: "" });
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const update = (key, value) => {
    setConfig((c) => ({
      ...c,
      [key]: value,
      ...(key === "pcEndpoint" || key === "pcApiKey"
        ? { autoDiscover: false }
        : {}),
    }));
    setResult("");
    setError("");
  };
  async function act(test) {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const r = await request("/" + kind + (test ? "/test" : ""), config);
      setResult(
        test
          ? "检测通过：" + r.endpoint
          : pc
            ? "PC 连接设置已保存"
            : "备用 AI 设置已保存",
      );
      if (!test) {
        setConfig((c) => ({
          ...c,
          hasPcKey: !!c.pcApiKey || c.hasPcKey,
          hasKey: !!c.apiKey || c.hasKey,
          pcApiKey: "",
          apiKey: "",
        }));
        onSaved?.();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!config)
    return (
      <section className="settings-card">
        <p role="status">{error || "正在读取连接设置…"}</p>
      </section>
    );
  return (
    <form
      className="settings-card"
      onSubmit={(e) => {
        e.preventDefault();
        act(false);
      }}
    >
      <h2>{pc ? "PC 连接设置" : "备用 AI 分离服务"}</h2>
      <p>
        {pc
          ? "PC 负责裁剪与去人声。连接状态和任务直接显示在本页。"
          : "独立配置与检测备用分离 API，检测不会访问 PC。仅使用 PC 时，这些字段可以留空。"}
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => update("enabled", e.target.checked)}
        />
        启用自动整理（PC 与备用 API 共用）
      </label>
      {pc ? (
        <>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={config.autoDiscover !== false}
              onChange={(e) => update("autoDiscover", e.target.checked)}
            />
            自动发现并连接 PC
          </label>
          <p>
            {config.autoDiscover !== false
              ? "使用 NAS 的 LAN host 配置自动配对。填写下方地址会切换到手动连接。"
              : "手动连接：填写 PC 的内网地址和密钥，然后保存。"}
          </p>
          <label>
            PC 地址
            <input
              value={config.pcEndpoint || ""}
              placeholder="http://192.168.11.155:8000"
              onChange={(e) => update("pcEndpoint", e.target.value)}
            />
          </label>
          <label>
            PC 模型
            <input
              value={config.pcModel || "htdemucs"}
              onChange={(e) => update("pcModel", e.target.value)}
            />
          </label>
          <label>
            PC 连接密钥
            <input
              type="password"
              autoComplete="new-password"
              value={config.pcApiKey || ""}
              placeholder={
                config.hasPcKey
                  ? "已保存，留空保留"
                  : "自动配对无需填写；手动连接使用 worker.json 中的 key"
              }
              onChange={(e) => update("pcApiKey", e.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            分离服务地址
            <input
              type="url"
              value={config.endpoint || ""}
              placeholder="https://separator.example.com"
              onChange={(e) => update("endpoint", e.target.value)}
            />
          </label>
          <label>
            分离模型
            <input
              value={config.model || ""}
              placeholder="例如 htdemucs"
              onChange={(e) => update("model", e.target.value)}
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              autoComplete="new-password"
              value={config.apiKey || ""}
              placeholder={
                config.hasKey ? "已保存，留空保留" : "可选，取决于服务"
              }
              onChange={(e) => update("apiKey", e.target.value)}
            />
          </label>
          <p>需要 ktv-separation-v1 音源分离接口，普通聊天模型 API 不适用。</p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {result && <p role="status">{result}</p>}
      <div className="modal-actions">
        <button type="button" disabled={busy} onClick={() => act(true)}>
          {busy ? "正在处理…" : pc ? "检测 PC 连接" : "检测备用 AI"}
        </button>
        <button className="primary" disabled={busy}>
          {pc ? "保存 PC 配置" : "保存备用 AI 配置"}
        </button>
      </div>
    </form>
  );
}
export function PCSettings(props) {
  return <ConnectionSettings kind="pc" {...props} />;
}
export function AISettings() {
  return <ConnectionSettings kind="cloud" />;
}
