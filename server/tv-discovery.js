import dgram from "node:dgram";
import { privateIPv4 } from "./discovery.js";

export const TV_DISCOVERY_PROTOCOL = "haohaochang-tv-discovery-v1";
export const TV_DISCOVERY_PORT = 43212;
export const serverIdentity = {
  service: "haohaochang",
  protocol: TV_DISCOVERY_PROTOCOL,
};

// Respond only to a small, explicit discovery request. No credentials, URLs,
// remote requests, library state or pairing side effects are involved.
export function startTvDiscovery({
  enabled = false,
  httpPort = 3210,
  port = TV_DISCOVERY_PORT,
  host = "0.0.0.0",
  allowLoopback = false,
  onError = () => {},
} = {}) {
  if (!enabled) return { stop() {} };
  if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535)
    throw new Error("TV discovery HTTP port is invalid");
  const socket = dgram.createSocket("udp4");
  const recent = new Map();
  socket.on("error", onError);
  socket.on("message", (data, remote) => {
    if (
      data.length > 512 ||
      (!privateIPv4(remote.address) &&
        !(allowLoopback && remote.address === "127.0.0.1"))
    )
      return;
    let request;
    try {
      request = JSON.parse(data);
    } catch {
      return;
    }
    if (
      request?.protocol !== TV_DISCOVERY_PROTOCOL ||
      !/^[a-f0-9]{32}$/.test(request.nonce || "")
    )
      return;
    const now = Date.now();
    if (now - (recent.get(remote.address) || 0) < 1000) return;
    if (recent.size >= 1000)
      for (const [ip, time] of recent)
        if (now - time > 10000) recent.delete(ip);
    if (recent.size >= 1000 && !recent.has(remote.address)) return;
    recent.set(remote.address, now);
    socket.send(
      Buffer.from(
        JSON.stringify({
          ...serverIdentity,
          nonce: request.nonce,
          port: httpPort,
          name: "好好唱 · 家庭歌房",
        }),
      ),
      remote.port,
      remote.address,
      () => {},
    );
  });
  socket.bind(port, host);
  socket.unref();
  return {
    socket,
    stop() {
      try {
        socket.close();
      } catch {}
    },
  };
}
