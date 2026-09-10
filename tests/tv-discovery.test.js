import test from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import { once } from "node:events";
import {
  startTvDiscovery,
  TV_DISCOVERY_PROTOCOL,
} from "../server/tv-discovery.js";

test("TV discovers only the advertised HTTP port through an isolated loopback exchange", async () => {
  const server = startTvDiscovery({
    enabled: true,
    httpPort: 43210,
    port: 0,
    host: "127.0.0.1",
    allowLoopback: true,
  });
  const client = dgram.createSocket("udp4");
  try {
    await once(server.socket, "listening");
    client.bind(0, "127.0.0.1");
    await once(client, "listening");
    const response = once(client, "message");
    const nonce = "a".repeat(32);
    client.send(
      JSON.stringify({ protocol: TV_DISCOVERY_PROTOCOL, nonce }),
      server.socket.address().port,
      "127.0.0.1",
    );
    const [bytes, remote] = await response;
    const body = JSON.parse(bytes);
    assert.equal(remote.address, "127.0.0.1");
    assert.deepEqual(body, {
      service: "haohaochang",
      protocol: TV_DISCOVERY_PROTOCOL,
      nonce,
      port: 43210,
      name: "好好唱 · 家庭歌房",
    });
  } finally {
    client.close();
    server.stop();
  }
});

test("TV discovery ignores invalid, oversized and unsolicited packets and bounds repeats", async () => {
  const server = startTvDiscovery({
    enabled: true,
    port: 0,
    host: "127.0.0.1",
    allowLoopback: true,
  });
  const client = dgram.createSocket("udp4");
  try {
    await once(server.socket, "listening");
    client.bind(0, "127.0.0.1");
    await once(client, "listening");
    const responses = [];
    client.on("message", (b) => responses.push(JSON.parse(b)));
    for (const body of [
      "bad",
      "{}",
      JSON.stringify({ protocol: TV_DISCOVERY_PROTOCOL, nonce: "bad" }),
      JSON.stringify({
        protocol: TV_DISCOVERY_PROTOCOL,
        nonce: "a".repeat(32),
        padding: "x".repeat(600),
      }),
    ])
      client.send(body, server.socket.address().port, "127.0.0.1");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(responses.length, 0);
    for (let n = 0; n < 3; n++)
      client.send(
        JSON.stringify({
          protocol: TV_DISCOVERY_PROTOCOL,
          nonce: "a".repeat(32),
        }),
        server.socket.address().port,
        "127.0.0.1",
      );
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(responses.length, 1);
  } finally {
    client.close();
    server.stop();
  }
});

test("discovery stays off unless explicitly enabled", () => {
  const server = startTvDiscovery();
  assert.equal(server.socket, undefined);
  server.stop();
});
