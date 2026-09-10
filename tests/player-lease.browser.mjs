import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { createApp } from "../server/app.js";
import { inspectPackage } from "../server/resource-health.js";
import { run } from "../server/process.js";
process.env.FFMPEG = ffmpeg;
process.env.FFPROBE = ffprobe.path;
const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-lease-browser-")),
  media = path.join(dir, "media"),
  folder = path.join(media, "好好唱播放资源", "歌曲", "preview");
await mkdir(folder, { recursive: true });
await run(ffmpeg, [
  "-y",
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=purple:s=320x180:r=24:d=120",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  path.join(folder, "画面.mp4"),
]);
await run(ffmpeg, [
  "-y",
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=120",
  "-c:a",
  "aac",
  path.join(folder, "原唱.m4a"),
]);
await copyFile(path.join(folder, "原唱.m4a"), path.join(folder, "伴奏.m4a"));
await copyFile("public/favicon.png", path.join(folder, "封面.png"));
const service = createApp({
  dataDir: path.join(dir, "db"),
  roots: [media],
  adminToken: "poster-browser-password",
  worker: false,
  discovery: false,
});
for (let n = 0; n < 1; n++) {
  const id = n.toString(16).padStart(24, "0");
  service.store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,search,mode,status,duration,poster,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      path.join(folder, `source-${n}.m4a`),
      `歌曲 ${String(n).padStart(2, "0")}`,
      "测试歌手",
      `歌曲 ${n} 测试歌手`,
      "separated",
      "ready",
      120,
      path.join(folder, "封面.png"),
      Date.now() + n,
    );
  service.store.set("package:" + id, folder);
  service.store.set("package-ready:" + id, true);
  await inspectPackage(
    service.store,
    service.store.db.prepare("SELECT * FROM songs WHERE id=?").get(id),
    folder,
  );
}
const server = service.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
service.store.db
  .prepare("INSERT INTO queue VALUES (?,?,?,?)")
  .run("entry", "0".repeat(24), "test", 0);
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const errors = [];
try {
  const context = await browser.newContext();
  await context.addInitScript((token) => {
    localStorage.setItem("roomToken", token);
    Object.defineProperty(crypto, "randomUUID", { value: undefined });
  }, service.store.get("roomToken"));
  async function open(route) {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + route);
    return page;
  }
  const playing = (page) =>
    page.waitForFunction(() =>
      document.querySelector("video")?._audioTracks?.some((t) => !t.el.paused),
    );
  const silent = (page) =>
    page.waitForFunction(() =>
      document.querySelector("video")?._audioTracks?.every((t) => t.el.paused),
    );
  const owner = () =>
    service.store &&
    fetch(base + "/api/state", {
      headers: { Authorization: "Bearer poster-browser-password" },
    })
      .then((r) => r.json())
      .then((s) => s.player);
  console.log("lease: opening web");
  const web1 = await open("/play");
  await playing(web1);
  const first = await owner();
  const web2 = await open("/play");
  await playing(web2);
  await silent(web1);
  const second = await owner();
  assert.notEqual(first.id, second.id);
  console.log("lease: TV priority");
  const tv1 = await open("/tv");
  await playing(tv1);
  await silent(web2);
  assert.equal((await owner()).type, "tv");
  const web3 = await open("/play");
  await web3
    .getByText("TV 正在播放，此页面仅用于点歌和控制。", { exact: true })
    .waitFor();
  await silent(web3);
  const tv2 = await open("/tv");
  await playing(tv2);
  await silent(tv1);
  const last = await owner();
  await tv2.waitForTimeout(6200);
  assert.equal((await owner()).id, last.id);
  for (const page of [web1, web2, web3, tv1]) await silent(page);
  const stale = await fetch(base + "/api/player/ended", {
    method: "POST",
    headers: {
      Authorization: "Bearer poster-browser-password",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ playerId: first.id, entryId: "entry" }),
  });
  assert.equal(stale.status, 409);
  assert.equal(
    service.store.db.prepare("SELECT count(*) AS n FROM queue").get().n,
    1,
  );
  console.log("lease: offline fallback");
  await tv2.close();
  await playing(web3);
  assert.equal((await owner()).type, "web");
  for (const page of [web1, web2, tv1]) await silent(page);
  for (const page of [web1, web2, tv1]) await page.close();
  // A stale successful response must not unmute a displaced page.
  console.log("lease: delayed reply");
  let release, received;
  const held = new Promise((r) => (release = r)),
    arrived = new Promise((r) => (received = r));
  const delayed = await context.newPage();
  await delayed.route("**/api/player/heartbeat", async (route) => {
    const response = await route.fetch();
    received();
    await held;
    await route.fulfill({ response });
  });
  await delayed.goto(base + "/play", { waitUntil: "domcontentloaded" });
  await Promise.race([
    arrived,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("delayed claim missing")), 15000),
    ),
  ]);
  const tv3 = await open("/tv");
  await playing(tv3);
  release();
  await silent(delayed);
  await delayed.waitForTimeout(5500);
  await silent(delayed);
  assert.equal((await owner()).type, "tv");
  assert.deepEqual(errors, []);
  console.log(
    "Player ownership browser passed: peer takeover, TV priority, unique pages without randomUUID, revoked silence, stale ended rejection, offline fallback, delayed response.",
  );
} finally {
  await browser.close();
  await service.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
}
