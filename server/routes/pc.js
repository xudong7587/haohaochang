import { providerHeaders } from "../separation/protocol.js";
import { connectionError } from "../connection-error.js";

const clipText = (v, max = 240) => String(v ?? "").slice(0, max);
export function pcApi({ app, admin, store, discovery }) {
  let pending;
  async function status() {
    const config = store.get("ai", {});
    const tasks = store.db
      .prepare(
        "SELECT id,kind,payload,status,stage,error,created,started,finished FROM jobs ORDER BY created DESC LIMIT 200",
      )
      .all()
      .map(({ payload, ...row }) => {
        const p = JSON.parse(payload);
        const song =
          p.id || p.existingId
            ? store.db
                .prepare("SELECT title,artist FROM songs WHERE id=?")
                .get(p.id || p.existingId)
            : null;
        return {
          ...row,
          title: p.title || p.metadata?.title || song?.title || "",
          artist: p.artist || p.metadata?.artist || song?.artist || "",
        };
      });
    const base = {
      connected: false,
      endpoint: config.pcEndpoint || "",
      checkedAt: Date.now(),
      discovery: discovery.info(),
      tasks,
      worker: null,
    };
    if (!config.pcEndpoint)
      return {
        ...base,
        status: "unconfigured",
        message:
          config.autoDiscover !== false && !discovery.info().enabled
            ? "未连接：当前 NAS 没有启用局域网发现。请使用 LAN 部署配置，或直接填写手动 PC 地址。"
            : "未连接：尚未获得 PC 地址。请启动整理器并等待发现，或填写手动 PC 地址。",
      };
    try {
      const response = await fetch(config.pcEndpoint + "/desktop/status", {
        headers: providerHeaders({ apiKey: config.pcApiKey }),
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (!response.ok)
        throw Object.assign(new Error("PC 状态暂不可用"), {
          status: response.status,
        });
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 512 * 1024) throw new Error("PC 状态响应过大");
        chunks.push(Buffer.from(chunk));
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Array.isArray(data.jobs) || !data.memory)
        throw Object.assign(new Error("请更新 PC 整理器"), {
          code: "INVALID_PROTOCOL",
        });
      const jobs = data.jobs
        .slice(0, 40)
        .map((j) =>
          Object.fromEntries(
            [
              "id",
              "title",
              "model",
              "status",
              "stage",
              "error",
              "created",
              "updated",
              "elapsed_seconds",
              "model_progress",
              "log",
            ]
              .filter((k) => k in j)
              .map((k) => [
                k,
                typeof j[k] === "number"
                  ? j[k]
                  : clipText(j[k], k === "log" ? 5000 : 300),
              ]),
          ),
        );
      const worker = {
        name: clipText(data.name),
        device: clipText(data.device),
        gpu_name: clipText(data.gpu_name),
        runtime: clipText(data.runtime),
        model: clipText(data.model),
        cpu: Number(data.cpu) || 0,
        uptime: Number(data.uptime) || 0,
        memory: {
          used_gb: Number(data.memory.used_gb) || 0,
          total_gb: Number(data.memory.total_gb) || 0,
          percent: Number(data.memory.percent) || 0,
        },
        gpu: data.gpu
          ? {
              utilization: Number(data.gpu.utilization) || 0,
              used_mb: Number(data.gpu.used_mb) || 0,
              total_mb: Number(data.gpu.total_mb) || 0,
            }
          : null,
        jobs,
      };
      return {
        ...base,
        connected: true,
        status: "connected",
        message: "PC 已连接，任务自动处理",
        worker,
      };
    } catch (error) {
      return {
        ...base,
        ...connectionError(error),
      };
    }
  }
  app.get("/api/admin/pc/status", admin, async (_req, res) => {
    pending ||= status().finally(() => {
      pending = null;
    });
    res.set("Cache-Control", "no-store").json(await pending);
  });
  app.get("/api/admin/pc/logs", admin, async (_req, res) => {
    const report = await status();
    report.scan = store.get("scan-progress", null);
    const secrets = [
      store.get("favorites", {}).cookie,
      ...Object.values(store.get("favorites", {}).credentials || {}),
      store.get("ai", {}).apiKey,
      store.get("ai", {}).pcApiKey,
      store.get("enrichment", {}).apiKey,
    ].filter(Boolean);
    const output = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        scope:
          "最近 200 条 NAS 任务与最近 40 条 PC 任务；PC 日志每条最多 5000 字符",
        ...report,
      },
      (_key, value) =>
        typeof value === "string"
          ? secrets.reduce(
              (text, secret) => text.split(secret).join("[已隐藏]"),
              value,
            )
          : value,
      2,
    );
    res
      .set("Cache-Control", "no-store")
      .attachment("haohaochang-diagnostics.json")
      .type("json")
      .send(output);
  });
}
