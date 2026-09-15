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
export function CloudSettings() {
  const [config, setConfig] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  useEffect(() => {
    let live = true;
    request("")
      .then((value) => {
        if (live) setConfig({ ...value, apiKey: "" });
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  function update(key, value) {
    setConfig((old) => ({ ...old, [key]: value }));
    setResult("");
    setError("");
  }
  async function act(test) {
    setBusy(true);
    setError("");
    setResult("");
    try {
      // This form owns only the external service; the shared switches live above.
      const response = await request("/cloud" + (test ? "/test" : ""), {
        endpoint: config.endpoint,
        model: config.model,
        apiKey: config.apiKey,
      });
      setResult(test ? "检测通过：" + response.endpoint : "备用 AI 设置已保存");
      if (!test)
        setConfig((old) => ({
          ...old,
          apiKey: "",
          hasKey: !!old.apiKey || old.hasKey,
        }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!config) return <p role="status">{error || "正在读取连接设置…"}</p>;
  return (
    <form
      className="settings-card"
      onSubmit={(e) => {
        e.preventDefault();
        act(false);
      }}
    >
      <h2>备用 AI 分离服务</h2>
      <p>
        PC、NAS NPU 和 CPU
        均不可用时，尝试这里配置的外部服务。需要兼容的音源分离接口。
      </p>
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
          placeholder={config.hasKey ? "已保存，留空保留" : "可选，取决于服务"}
          onChange={(e) => update("apiKey", e.target.value)}
        />
      </label>
      <p>需要 ktv-separation-v1 音源分离接口，普通聊天模型 API 不适用。</p>
      <details>
        <summary>音源分离 API 供应商与接入说明</summary>
        <p>
          以下服务可作为云端分离的候选，需要适配为本项目的 ktv-separation-v1
          接口后使用，不能直接把文档地址填入上方。
        </p>
        <ul>
          <li>
            <a
              href="https://help.aliyun.com/zh/ims/user-guide/audio-and-video-intelligent-production-overview"
              target="_blank"
              rel="noopener noreferrer"
            >
              阿里云 IMS · MusicDemix 声伴分离
            </a>
            ：国内服务，输出人声和伴奏；通过 SubmitIProductionJob
            提交任务。未承诺采用 htdemucs 模型。
          </li>
          <li>
            <a
              href="https://cloud.tencent.com/document/product/436/100113"
              target="_blank"
              rel="noopener noreferrer"
            >
              腾讯云 COS／数据万象 · 人声分离 API
            </a>
            ：通过 VoiceSeparate 任务分离人声与背景音。未承诺采用 htdemucs
            模型。
          </li>
          <li>
            <a
              href="https://replicate.com/cjwbw/demucs/api"
              target="_blank"
              rel="noopener noreferrer"
            >
              Replicate · Demucs API
            </a>
            ：托管 Demucs，通过 API
            提交音频并取回分轨结果；接入时核对模型版本、费用和网络可达性。
          </li>
        </ul>
        <p>
          也可在国内 GPU 服务器部署现有分离器，继续使用
          htdemucs。选择供应商前，可用相同歌曲比较伴奏中的人声残留、乐器损失与处理耗时。
        </p>
      </details>
      {error && <p role="alert">{error}</p>}
      {result && <p role="status">{result}</p>}
      <div className="modal-actions">
        <button type="button" disabled={busy} onClick={() => act(true)}>
          {busy ? "正在处理…" : "检测备用 AI"}
        </button>
        <button className="primary" disabled={busy}>
          保存备用 AI 配置
        </button>
      </div>
    </form>
  );
}
