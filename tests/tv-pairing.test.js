import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import QRCode from "qrcode";
import { tvPairingApi } from "../server/tv-pairing.js";

test("TV pairing requires phone authentication and separate capabilities; expires and collects once", async (t) => {
  const app = express();
  app.use(express.json());
  let time = 1000,
    link;
  const original = QRCode.toDataURL;
  QRCode.toDataURL = async (url) => {
    link = url;
    return "data:image/png;base64,fixture";
  };
  t.after(() => {
    QRCode.toDataURL = original;
  });
  tvPairingApi({
    app,
    get: (key, fallback) => (key === "roomToken" ? "room-secret" : fallback),
    allowedOrigin: () => false,
    now: () => time,
    member: (req, res, next) =>
      req.get("authorization") === "Bearer room-secret"
        ? next()
        : res.status(401).json({ error: "login" }),
  });
  app.use((err, req, res, next) =>
    res.status(err.status || 400).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, body = {}, authenticated = false) => {
    const response = await fetch(base + "/api" + url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { Authorization: "Bearer room-secret" } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const created = (
    await request("/tv-pairing", { origin: "https://untrusted.example" })
  ).body;
  assert.ok(link.startsWith(base + "/mobile#pair="));
  assert.ok(!link.includes(created.pollKey));
  assert.ok(!JSON.stringify(created).includes("room-secret"));
  const approvalKey = new URL(link).hash.split(".")[1],
    route = "/tv-pairing/" + created.id;
  assert.equal(
    (await request(route + "/approve", { approvalKey })).status,
    401,
  );
  assert.equal(
    (await request(route + "/check", { pollKey: approvalKey })).status,
    403,
  );
  assert.equal(
    (await request(route + "/info", { approvalKey: created.pollKey }, true))
      .status,
    403,
  );
  assert.equal(
    (await request(route + "/info", { approvalKey }, true)).body.code,
    created.code,
  );
  assert.deepEqual(
    (await request(route + "/check", { pollKey: created.pollKey })).body,
    { status: "waiting" },
  );
  assert.equal(
    (await request(route + "/approve", { approvalKey }, true)).status,
    200,
  );
  assert.deepEqual(
    (await request(route + "/check", { pollKey: created.pollKey })).body,
    { status: "approved", token: "room-secret" },
  );
  assert.equal(
    (await request(route + "/check", { pollKey: created.pollKey })).status,
    410,
  );
  const expired = (await request("/tv-pairing")).body;
  time += 180001;
  assert.equal(
    (
      await request(`/tv-pairing/${expired.id}/check`, {
        pollKey: expired.pollKey,
      })
    ).status,
    410,
  );
});
