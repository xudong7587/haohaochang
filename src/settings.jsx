import React, { useEffect, useState } from "react";
export function AISettings({ attempt }) {
  const [config, setConfig] = useState({
      enabled: false,
      autoDiscover: true,
      endpoint: "",
      model: "",
      apiKey: "",
      hasKey: false,
      pcEndpoint: "",
      pcModel: "htdemucs",
      pcApiKey: "",
    }),
    [busy, setBusy] = useState(false);
  async function request(method, body, suffix = "") {
    const r = await fetch("/api/admin/ai" + suffix, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionStorage.getItem("adminToken")}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    return data;
  }
  useEffect(() => {
    let live = true;
    attempt(() => request("GET")).then((v) => {
      if (live && v) setConfig({ ...v, apiKey: "", pcApiKey: "" });
    });
    const timer = setInterval(
      () =>
        request("GET")
          .then((v) => {
            if (live)
              setConfig((c) => ({
                ...c,
                discovery: v.discovery,
                ...(c.autoDiscover !== false
                  ? { pcEndpoint: v.pcEndpoint, hasPcKey: v.hasPcKey }
                  : {}),
              }));
          })
          .catch(() => {}),
      5000,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const update = (key, value) => setConfig((c) => ({ ...c, [key]: value }));
  return (
    <form
      className="settings-card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await attempt(
          () => request("POST", config),
          "AI 分离设置已保存",
        );
        if (ok)
          setConfig((c) => ({
            ...c,
            hasKey: !!c.apiKey || c.hasKey,
            apiKey: "",
            pcApiKey: "",
            hasPcKey: !!c.pcApiKey || c.hasPcKey,
          }));
        setBusy(false);
      }}
    >
      <h3>AI 伴奏分离</h3>
      <p>
        第一次点歌时，NAS
        将音频发送到你配置的服务，生成并永久保存伴奏版本。原视频音频保留为原唱。下次直接播放已保存版本。
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => update("enabled", e.target.checked)}
        />
        启用歌曲整理与伴奏分离
      </label>
      <h4>局域网 PC 整理器</h4>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={config.autoDiscover !== false}
          onChange={(e) => update("autoDiscover", e.target.checked)}
        />
        自动发现并连接 PC
      </label>
      <p>
        {config.discovery?.message || "打开同一局域网的 PC 整理器即可连接。"}
      </p>
      {config.autoDiscover !== false && (
        <>
          <p>
            {config.discovery?.worker?.name} {config.pcEndpoint}
          </p>
          <button
            type="button"
            onClick={() =>
              attempt(async () => {
                await request("POST", {}, "/discover");
                const v = await request("GET");
                setConfig((c) => ({
                  ...c,
                  pcEndpoint: v.pcEndpoint,
                  discovery: v.discovery,
                }));
              })
            }
          >
            刷新连接状态
          </button>
        </>
      )}
      <details>
        <summary>高级：手动连接设置</summary>
        <p>关闭自动发现后使用。地址应为 PC 的局域网 IP。</p>

        <label>
          PC 地址
          <input
            type="url"
            disabled={config.autoDiscover !== false}
            value={config.pcEndpoint}
            placeholder="http://192.168.1.20:8000"
            onChange={(e) => update("pcEndpoint", e.target.value)}
          />
        </label>
        <label>
          PC 模型
          <input
            value={config.pcModel}
            onChange={(e) => update("pcModel", e.target.value)}
          />
        </label>
        <label>
          PC 连接密钥
          <input
            type="password"
            disabled={config.autoDiscover !== false}
            value={config.pcApiKey || ""}
            placeholder={
              config.hasPcKey ? "已保存，留空保留" : "从 PC 支持程序复制"
            }
            onChange={(e) => update("pcApiKey", e.target.value)}
          />
        </label>
      </details>
      <h4>备用 API / PC 忙时并行处理</h4>
      <label>
        分离服务地址
        <input
          type="url"
          value={config.endpoint}
          placeholder="https://separator.example.com"
          onChange={(e) => update("endpoint", e.target.value)}
        />
      </label>
      <label>
        分离模型
        <input
          value={config.model}
          placeholder="例如 htdemucs（由服务决定）"
          onChange={(e) => update("model", e.target.value)}
        />
      </label>
      <label>
        API Key
        <input
          type="password"
          autoComplete="new-password"
          value={config.apiKey}
          placeholder={
            config.hasKey ? "已保存；留空保留原密钥" : "可选，取决于服务"
          }
          onChange={(e) => update("apiKey", e.target.value)}
        />
      </label>
      <p>
        PC 空闲优先使用 PC；离线或失败转备用 API，PC 忙时其他歌曲可由 API
        并行处理。没有备用 API 时保留失败任务。两种服务都需要 ktv-separation-v1
        兼容接口；普通聊天模型 API 不具备音源分离能力。项目附带可自行部署的
        Demucs
        适配服务，也可接入第三方适配器。启用即允许将点播音频发送至此地址。
      </p>
      <div className="modal-actions">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await attempt(
              () => request("POST", config, "/test"),
              "分离服务协议检测通过",
            );
            setBusy(false);
          }}
        >
          检测服务
        </button>
        <button className="primary" disabled={busy}>
          保存配置
        </button>
      </div>
    </form>
  );
}
