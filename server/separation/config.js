export function providerConfig(input, old = {}) {
  const endpoint = String(input.endpoint || "")
    .trim()
    .replace(/\/$/, "");
  if (endpoint) {
    const url = new URL(endpoint);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("分离服务地址格式错误");
  }
  const pcEndpoint = String(
    (input.autoDiscover === true ? old.pcEndpoint : input.pcEndpoint) || "",
  )
    .trim()
    .replace(/\/$/, "");
  if (pcEndpoint) {
    const pc = new URL(pcEndpoint);
    if (
      !["http:", "https:"].includes(pc.protocol) ||
      pc.username ||
      pc.password ||
      pc.search ||
      pc.hash
    )
      throw new Error("PC 服务地址格式错误");
  }
  if (
    input.enabled &&
    input.autoDiscover !== true &&
    !(pcEndpoint || (endpoint && String(input.model || "").trim()))
  )
    throw new Error("启用 AI 分离前请填写地址和模型");
  return {
    enabled: input.enabled === true,
    autoDiscover: input.autoDiscover !== false,
    pcEndpoint,
    pcModel: String(input.pcModel || "htdemucs").slice(0, 120),
    pcApiKey: input.clearPcKey
      ? ""
      : String(input.pcApiKey || old.pcApiKey || "").slice(0, 2000),
    endpoint,
    model: String(input.model || "").slice(0, 120),
    apiKey: input.clearKey
      ? ""
      : String(input.apiKey || old.apiKey || "").slice(0, 2000),
  };
}
