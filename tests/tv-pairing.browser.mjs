import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";

const root = await mkdtemp(path.join(os.tmpdir(), "ktv-pair-browser-"));
const service = createApp({
  dataDir: path.join(root, "db"),
  roots: [path.join(root, "media")],
  worker: false,
  discovery: false,
  adminToken: "pair-test-password",
});
const server = service.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const original = QRCode.toDataURL;
let pairingUrl;
QRCode.toDataURL = async (url, options) => {
  if (url.includes("#pair=")) pairingUrl = url;
  return original(url, options);
};
const channel = process.env.BROWSER_CHANNEL;
const browser = await chromium.launch({
  headless: true,
  ...(channel ? { channel } : {}),
});
const errors = [];
try {
  const tvContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const tv = await tvContext.newPage();
  tv.on("pageerror", (e) => errors.push(e.message));
  await tv.goto(base + "/tv");
  await tv.getByAltText("扫码登录电视并点歌").waitFor();
  assert.equal(await tv.evaluate(() => window.haohaochangBack()), false);
  await mkdir("test-results/tv-pairing", { recursive: true });
  await tv.screenshot({
    path: "test-results/tv-pairing/login.png",
    fullPage: true,
  });
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const phone = await phoneContext.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(pairingUrl);
  assert.equal(
    await phone.evaluate(() => localStorage.getItem("roomToken")),
    null,
  );
  await phone.getByLabel("管理密码").fill("pair-test-password");
  await phone.getByRole("button", { name: "进入好好唱" }).click();
  await phone.getByRole("button", { name: "确认登录电视并点歌" }).click();
  await phone.getByText("今晚，唱点开心的。", { exact: true }).waitFor();
  await tv.getByRole("button", { name: "音乐现场", exact: true }).waitFor();
  assert.equal(
    await tv.evaluate(() => localStorage.getItem("roomToken")),
    service.store.get("roomToken"),
  );
  assert.ok(!(await tv.evaluate(() => sessionStorage.getItem("adminToken"))));
  assert.equal(await tv.evaluate(() => window.haohaochangBack()), false);
  await tv.getByRole("button", { name: "歌名点歌", exact: true }).click();
  assert.equal(await tv.evaluate(() => window.haohaochangBack()), true);
  await tv
    .locator("nav button.selected")
    .filter({ hasText: "音乐现场" })
    .waitFor();
  assert.equal(await tv.evaluate(() => window.haohaochangBack()), false);
  await tv.getByRole("button", { name: "扫码点歌", exact: true }).click();
  await tv.getByRole("dialog").waitFor();
  assert.equal(await tv.evaluate(() => window.haohaochangBack()), true);
  await tv.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await tv.evaluate(() => window.haohaochangBack()), false);
  await tv.reload();
  await tv.getByRole("button", { name: "音乐现场", exact: true }).waitFor();
  // A previously joined phone needs only to confirm, with no password entry.
  await tv.evaluate(() => localStorage.removeItem("roomToken"));
  await tv.reload();
  await tv.getByAltText("扫码登录电视并点歌").waitFor();
  await phone.goto(pairingUrl);
  await phone.getByRole("button", { name: "确认登录电视并点歌" }).click();
  await tv.getByRole("button", { name: "音乐现场", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS TV/phone QR login, no TV admin password, persistent room login, modal/page/root back handling",
  );
} finally {
  QRCode.toDataURL = original;
  await browser.close();
  service.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(root, { recursive: true, force: true });
}
