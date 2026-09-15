// One shared priority order for new songs and replacement recordings.
export const embeddedSeparation = () =>
  process.env.KTV_LOCAL_SEPARATION !== "1" &&
  process.env.KTV_EMBEDDED_SEPARATION === "1";
export const localSeparation = () => process.env.KTV_LOCAL_SEPARATION === "1";
export const managedSeparation = () => localSeparation() || embeddedSeparation();
export function cpuConfig(config = {}) {
  const local = localSeparation(), embedded = embeddedSeparation();
  return {
    enabled: config.cpuEnabled ?? (local || embedded),
    endpoint: local ? process.env.KTV_CPU_ENDPOINT || "http://127.0.0.1:18002" : embedded
      ? process.env.KTV_EMBEDDED_CPU_ENDPOINT || "http://127.0.0.1:18002"
      : "",
    apiKey: (local ? process.env.KTV_LOCAL_KEY : process.env.KTV_EMBEDDED_KEY) || "",
    model: "htdemucs",
    cpu: true,
    embedded,
    managed: local || embedded,
  };
}
export function npuConfig(config = {}) {
  const embedded = embeddedSeparation(), local = localSeparation();
  return {
    enabled: config.npuEnabled ?? (embedded || !!process.env.KTV_NPU_ENDPOINT),
    endpoint: local ? process.env.KTV_NPU_ENDPOINT || "" : embedded
      ? process.env.KTV_EMBEDDED_NPU_ENDPOINT || "http://127.0.0.1:18001"
      : config.npuEndpoint || process.env.KTV_NPU_ENDPOINT || "",
    apiKey: local ? process.env.KTV_LOCAL_KEY || "" : embedded
      ? process.env.KTV_EMBEDDED_KEY || ""
      : config.npuApiKey || process.env.KTV_NPU_API_KEY || "",
    model: "htdemucs",
    npu: true,
    embedded,
    managed: local || embedded,
  };
}
export function providerCandidates(config = {}) {
  const npu = npuConfig(config),
    cpu = cpuConfig(config);
  return [
    config.pcEnabled !== false &&
      config.pcEndpoint && {
        endpoint: config.pcEndpoint,
        apiKey: config.pcApiKey,
        model: config.pcModel || "htdemucs",
        pc: true,
      },
    npu.enabled && npu.endpoint && npu,
    cpu.enabled && cpu.endpoint && cpu,
    config.endpoint && {
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model,
    },
  ].filter(Boolean);
}
