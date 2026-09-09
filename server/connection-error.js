export function connectionError(error, label = "PC") {
  const codes = [
    error.code,
    error.cause?.code,
    ...(error.cause?.errors || []).map((e) => e.code),
  ];
  if (error.status === 401 || error.status === 403)
    return {
      status: "unauthorized",
      message: `${label}已响应，但连接密钥不正确。请重新配对，或更新手动连接密钥。`,
    };
  if (error.status === 404)
    return {
      status: "incompatible",
      message: `${label}地址可达，但没有对应接口。请检查端口和整理器版本。`,
    };
  if (codes.includes("ECONNREFUSED"))
    return {
      status: "refused",
      message: `${label}拒绝连接。整理器可能未启动或已经退出，请检查安装目录中的 runtime/launcher.log，并核对 IP 和端口。`,
    };
  if (
    ["TimeoutError", "AbortError"].includes(error.name) ||
    codes.some((c) => ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(c))
  )
    return {
      status: "timeout",
      message: `连接${label}超时。请确认两台设备在同一内网，并检查 PC 是否休眠、IP 是否变化，以及家庭网络的防火墙设置。`,
    };
  if (codes.some((c) => ["ENOTFOUND", "EAI_AGAIN"].includes(c)))
    return {
      status: "dns",
      message: `无法解析${label}地址，请核对地址或使用实际内网 IP。`,
    };
  if (error.status)
    return {
      status: "unavailable",
      message: `${label}返回 HTTP ${error.status}，服务暂时不可用。请查看整理器日志。`,
    };
  if (error.code === "INVALID_PROTOCOL")
    return {
      status: "incompatible",
      message: `${label}地址可达，但不是兼容的整理器接口。请核对端口或升级程序。`,
    };
  return {
    status: "offline",
    message: `尚未连通${label}。请检查整理器是否启动、内网 IP 和端口是否正确；启动错误见 runtime/launcher.log。`,
  };
}
