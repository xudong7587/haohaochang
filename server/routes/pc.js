import { providerHeaders } from "../separation/protocol.js";

const clipText = (v, max = 240) => String(v ?? "").slice(0, max);
export function pcApi({ app, admin, store, discovery }) {
  let pending;
  async function status() {
    const config = store.get("ai", {});
    const tasks = store.db
      .prepare(
        "SELECT id,kind,payload,status,stage,error,created FROM jobs ORDER BY created DESC LIMIT 40",
      )
      .all()
      .map(({ payload, ...row }) => {
        const p = JSON.parse(payload);
        return {
          ...row,
          title: p.title || p.metadata?.title || "",
          artist: p.artist || p.metadata?.artist || "",
        };
      });
    const base = {
      connected: false,
      discovery: discovery.info(),
      tasks,
      worker: null,
    };
    if (!config.pcEndpoint)
      return {
        ...base,
        message: "等待 PC 整理器上线。在电脑上运行 start.cmd 即可。",
      };
    try {
      const response = await fetch(config.pcEndpoint + "/desktop/status", {
        headers: providerHeaders({ apiKey: config.pcApiKey }),
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("PC 状态暂不可用");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 512 * 1024) throw new Error("PC 状态响应过大");
        chunks.push(Buffer.from(chunk));
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Array.isArray(data.jobs) || !data.memory)
        throw new Error("请更新 PC 整理器");
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
        message: "PC 已连接，任务自动处理",
        worker,
      };
    } catch {
      return {
        ...base,
        message: "PC 暂未连接或仍在安装环境，已保存的任务会等待恢复。",
      };
    }
  }
  app.get("/api/admin/pc/status", admin, async (_req, res) => {
    pending ||= status().finally(() => {
      pending = null;
    });
    res.set("Cache-Control", "no-store").json(await pending);
  });
}
