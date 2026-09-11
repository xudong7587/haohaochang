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
const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-adaptive-browser-")),
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
for (let n = 0; n < 6; n++) {
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
      n % 2 ? "" : path.join(folder, "封面.png"),
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
await mkdir("test-results/adaptive", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  await context.addInitScript((token) => {
    localStorage.setItem("roomToken", token);
    sessionStorage.setItem("adminToken", "poster-browser-password");
  }, service.store.get("roomToken"));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/admin");
  await page.getByRole("button", { name: "歌星管理", exact: true }).click();
  await page.locator(".artist-card").click();
  await page.getByRole("button", { name: "编辑歌星资料", exact: true }).click();
  await page
    .getByLabel("歌星介绍", { exact: true })
    .fill("这是一段测试介绍，用于验证歌星资料保存和展示。");
  await page.getByRole("button", { name: "保存介绍", exact: true }).click();
  await page.getByText("歌星介绍已保存", { exact: true }).waitFor();
  await page.getByLabel("选择封面文件").setInputFiles("public/favicon.png");
  await page.getByRole("button", { name: "保存封面", exact: true }).click();
  await page.getByText("封面已保存", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".artist-hero-background").waitFor();
  await page.getByRole("button", { name: "编辑 歌曲 00", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "test-results/adaptive/artist-admin.png",
    fullPage: true,
  });
  await page.goto(base + "/play");
  await page.waitForFunction(() =>
    document.querySelector("video")?._audioTracks?.some((t) => !t.el.paused),
  );
  const range = await fetch(
    `${base}/api/assets/${"0".repeat(24)}/video?token=${encodeURIComponent(service.store.get("roomToken"))}`,
    { headers: { Range: "bytes=0-15" } },
  );
  assert.equal(range.status, 206);
  assert.match(range.headers.get("content-range"), /^bytes 0-15\//);
  assert.equal((await range.arrayBuffer()).byteLength, 16);
  await page.waitForFunction(
    () => document.querySelector("video").currentTime > 0.5,
  );
  await page.evaluate(() => {
    const v = document.querySelector("video");
    window.unrequestedSeeks = 0;
    v.addEventListener("seeking", () => window.unrequestedSeeks++);
    v.playbackRate = 0.75;
  });
  await page.waitForTimeout(1800);
  assert.equal(
    await page.evaluate(() => window.unrequestedSeeks),
    0,
    "slow picture is allowed to continue without automatic seeks",
  );
  await page.evaluate(() => {
    const v = document.querySelector("video");
    v.playbackRate = 1;
    v._playback.seek(v._playback.getTime());
  });
  await page.getByRole("button", { name: "歌星点歌", exact: true }).click();
  await page.locator(".artist-card").click();
  await page
    .locator(".artist-description")
    .filter({ hasText: "这是一段测试介绍" })
    .waitFor();
  await page.getByRole("button", { name: "点歌 歌曲 01", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(
    service.store.db.prepare("SELECT COUNT(*) n FROM queue").get().n,
    2,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/adaptive/artist-play.png",
    fullPage: true,
  });
  await page.locator("nav button").filter({ hasText: "已点歌曲" }).click();
  const color = await page
    .locator(".queue-row")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(color, "rgb(48, 34, 62)");
  await page.screenshot({
    path: "test-results/adaptive/queue.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "音乐现场", exact: true }).click();
  await page.getByRole("button", { name: "全屏播放", exact: true }).click();
  await page.locator('.tv-player[data-controls="hidden"]').waitFor();
  assert.equal(await page.locator(".video-caption").isVisible(), false);
  await page.keyboard.press("ArrowRight");
  await page.locator('.tv-player[data-controls="visible"]').waitFor();
  await page.locator('.tv-player[data-controls="hidden"]').waitFor();
  await page.mouse.click(600, 200);
  await page.locator('.tv-player[data-controls="visible"]').waitFor();
  await page.getByRole("button", { name: "退出全屏", exact: true }).click();
  await page.close();
  await context.close();
  const native = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: "Mozilla/5.0 Chrome/74.0 Safari/537.36 HaohaochangTV/0.3.13",
  });
  await native.addInitScript(
    (token) => localStorage.setItem("roomToken", token),
    service.store.get("roomToken"),
  );
  const tv = await native.newPage();
  tv.on("pageerror", (e) => errors.push(e.message));
  await tv.goto(base + "/tv");
  await tv.waitForFunction(() =>
    document.querySelector("video")?._audioTracks?.some((t) => !t.el.paused),
  );
  await tv.getByRole("button", { name: "歌星点歌", exact: true }).click();
  await tv.getByRole("button", { name: "歌星点歌", exact: true }).focus();
  await tv.keyboard.press("ArrowRight");
  await tv.locator(".tv-content-entered").waitFor();
  await tv.waitForFunction(() =>
    document.activeElement?.classList.contains("artist-card"),
  );
  await tv.keyboard.press("Enter");
  await tv.waitForFunction(() =>
    document.activeElement?.parentElement?.classList.contains(
      "song-poster-card",
    ),
  );
  const firstSong = await tv.evaluate(() => document.activeElement.textContent);
  await tv.keyboard.press("ArrowDown");
  assert.equal(
    await tv.evaluate(
      () => !!document.activeElement.closest(".song-poster-grid"),
    ),
    true,
    "down selects the next song row before footer controls",
  );
  await tv.keyboard.press("ArrowUp");
  assert.equal(
    await tv.evaluate(() => document.activeElement.textContent),
    firstSong,
  );
  assert.equal(
    await tv.evaluate(
      () => getComputedStyle(document.activeElement).backgroundColor,
    ),
    "rgb(255, 255, 255)",
  );
  const heights = await tv
    .locator(".song-poster-card")
    .evaluateAll((items) =>
      items.map((el) => el.getBoundingClientRect().height),
    );
  assert.ok(
    Math.max(...heights) - Math.min(...heights) < 2,
    "missing posters keep the same card height",
  );
  await tv.screenshot({
    path: "test-results/adaptive/artist-tv-navigation.png",
  });
  await tv.keyboard.press("Escape");
  await tv.locator(".tv-content-entered").waitFor({ state: "detached" });
  assert.equal(
    await tv.evaluate(() => !!document.activeElement.closest(".sidebar")),
    true,
    "Back restores primary navigation",
  );
  assert.equal(
    await tv.locator(".tv-player:not(.is-full) .lyric-adjust").count(),
    0,
  );
  await tv.locator("[data-open-fullscreen]").focus();
  await tv.getByRole("button", { name: "全屏播放", exact: true }).click();
  await tv.locator(".tv-player.is-full").waitFor();
  assert.equal(
    await tv.evaluate(() => document.fullscreenElement === null),
    true,
    "APK keeps controls in its immersive WebView",
  );
  await tv.keyboard.press("ArrowDown");
  await tv.waitForFunction(
    () => document.activeElement?.dataset.playerAction === "pause",
  );
  await tv.keyboard.press("Enter");
  await tv
    .locator('[data-player-action="pause"]')
    .filter({ hasText: "继续" })
    .waitFor();
  await tv.keyboard.press("Enter");
  await tv
    .locator('[data-player-action="pause"]')
    .filter({ hasText: "暂停" })
    .waitFor();
  await tv.locator('.tv-player[data-controls="hidden"]').waitFor();
  await tv.keyboard.down("Enter");
  await tv.keyboard.down("Enter");
  await tv.keyboard.up("Enter");
  await tv.waitForFunction(
    () => document.activeElement?.dataset.playerAction === "pause",
  );
  assert.equal(await tv.locator(".tv-player.is-full").count(), 1);
  assert.equal(
    await tv.locator('[data-player-action="pause"]').innerText(),
    "暂停",
    "first confirmation wakes controls without pausing",
  );
  await tv.keyboard.press("ArrowDown");
  assert.ok(
    await tv
      .locator(".video-caption")
      .evaluate((el) => el.contains(document.activeElement)),
  );
  await tv.getByLabel("歌词提前 0.5 秒", { exact: true }).focus();
  await tv.keyboard.press("Enter");
  await tv
    .locator(".lyric-adjust output")
    .filter({ hasText: "提前 0.5 秒" })
    .waitFor();
  await tv.screenshot({ path: "test-results/adaptive/fullscreen-menu.png" });
  await tv.locator('[data-player-action="next"]').focus();
  await tv.keyboard.press("Enter");
  await tv
    .locator(".now-playing strong")
    .filter({ hasText: "歌曲 01" })
    .waitFor();
  await tv.keyboard.press("Escape");
  assert.equal(await tv.locator(".tv-player.is-full").count(), 1);
  await tv.keyboard.press("ArrowDown");
  await tv.keyboard.press("Escape");
  await tv.locator('.tv-player[data-controls="hidden"]').waitFor();
  await tv.keyboard.press("Escape");
  await tv.locator('.tv-player[data-controls="visible"]').waitFor();
  await tv.locator("[data-fullscreen]").click();
  assert.equal(await tv.locator(".tv-player.is-full").count(), 0);
  const queueBeforeReload = service.store.db
    .prepare("SELECT id,song_id FROM queue ORDER BY position")
    .all();
  await tv.getByRole("button", { name: "热更新", exact: true }).focus();
  await tv.keyboard.press("Enter");
  await tv.waitForURL(/refresh=\d+/);
  await tv.locator(".app.tv").waitFor();
  assert.equal(
    await tv.evaluate(() => localStorage.getItem("roomToken")),
    service.store.get("roomToken"),
  );
  assert.deepEqual(
    service.store.db
      .prepare("SELECT id,song_id FROM queue ORDER BY position")
      .all(),
    queueBeforeReload,
  );
  assert.equal(await tv.locator(".tv-login-qr").count(), 0);
  await native.close();
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await phone.addInitScript(
    (token) => localStorage.setItem("roomToken", token),
    service.store.get("roomToken"),
  );
  const mobile = await phone.newPage();
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto(base + "/play");
  await mobile.locator(".tv-player").waitFor();
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await mobile.setViewportSize({ width, height });
    await mobile.waitForTimeout(200);
    assert.ok(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "phone overflow",
    );
    const nav = await mobile.locator(".sidebar").boundingBox();
    assert.ok(Math.abs(nav.width - width) < 2, "phone nav spans viewport");
    const box = await mobile.locator(".video-stage").boundingBox();
    assert.ok(Math.abs(box.width / box.height - 16 / 9) < 0.03, "video ratio");
    await mobile.screenshot({
      path: `test-results/adaptive/phone-${width}.png`,
      fullPage: true,
    });
  }
  await phone.close();
  // Exercise the actual legacy bundle with missing APIs from older WebViews.
  const old = await browser.newContext();
  await old.addInitScript((token) => {
    localStorage.setItem("roomToken", token);
    delete Array.prototype.at;
    delete Array.prototype.flatMap;
    delete Object.fromEntries;
    delete String.prototype.matchAll;
    delete Promise.allSettled;
    delete window.AbortController;
  }, service.store.get("roomToken"));
  const legacy = await old.newPage();
  legacy.on("pageerror", (e) => errors.push(e.message));
  await legacy.route("**/tv", async (route) => {
    const r = await route.fetch();
    let html = await r.text();
    html = html
      .replace(/<script type="module"[\s\S]*?<\/script>/g, "")
      .replace(/ nomodule/g, "");
    await route.fulfill({ response: r, body: html });
  });
  await legacy.goto(base + "/tv");
  await legacy.locator(".app.tv").waitFor();
  assert.equal(
    await legacy.evaluate(() => window.haohaochangBoot.loaded),
    true,
  );
  await old.close();
  const broken = await browser.newPage();
  await broken.route("**/assets/*.js", (route) => route.abort());
  await broken.goto(base + "/tv");
  await broken.locator("#boot-actions").waitFor();
  assert.equal(await broken.locator("#boot-screen").isVisible(), true);
  await broken.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS direct Range streaming without periodic video seeking, fullscreen remote menu, artist editing and enqueue, dark queue, phone orientations, legacy bundle and boot recovery",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await service.close();
  await rm(dir, { recursive: true, force: true });
}
