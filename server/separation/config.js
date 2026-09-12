import { npuConfig } from "./providers.js";
export function providerConfig(input, old = {}) {
  const previousNpu = npuConfig(old);
  const npuEnabled = input.npuEnabled ?? previousNpu.enabled;
  const npuEndpoint = String(input.npuEndpoint ?? previousNpu.endpoint)
    .trim()
    .replace(/\/$/, "");
  if (npuEndpoint) {
    const url = new URL(npuEndpoint);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("NPU 服务地址格式错误");
  }
  if (npuEnabled && !npuEndpoint) throw new Error("请填写 NPU 服务地址");
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
    !(
      pcEndpoint ||
      (npuEnabled && npuEndpoint) ||
      (endpoint && String(input.model || "").trim())
    )
  )
    throw new Error("启用 AI 分离前请填写地址和模型");
  return {
    enabled: input.enabled === true,
    npuEnabled: npuEnabled === true,
    npuEndpoint,
    npuApiKey: input.clearNpuKey
      ? ""
      : String(input.npuApiKey || old.npuApiKey || "").slice(0, 2000),
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
