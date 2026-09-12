// One shared priority order for new songs and replacement recordings.
export function npuConfig(config = {}) {
  return {
    enabled: config.npuEnabled ?? !!process.env.KTV_NPU_ENDPOINT,
    endpoint: config.npuEndpoint ?? process.env.KTV_NPU_ENDPOINT ?? "",
    apiKey: config.npuApiKey || process.env.KTV_NPU_API_KEY || "",
    model: "htdemucs",
    npu: true,
  };
}

export function providerCandidates(config) {
  const npu = npuConfig(config);
  return [
    config.pcEndpoint && {
      endpoint: config.pcEndpoint,
      apiKey: config.pcApiKey,
      model: config.pcModel || "htdemucs",
      pc: true,
    },
    npu.enabled && npu.endpoint && npu,
    config.endpoint && {
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model,
    },
  ].filter(Boolean);
}
