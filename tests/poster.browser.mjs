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
const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-poster-browser-")),
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
  "color=c=purple:s=320x180:r=24:d=8",
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
  "sine=frequency=440:duration=8",
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
for (let n = 0; n < 28; n++) {
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
      8,
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
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((token) => {
    sessionStorage.setItem("adminToken", "poster-browser-password");
    localStorage.setItem("roomToken", token);
    const NativeAudio = window.Audio;
    window.previewAudio = [];
    window.Audio = function (src) {
      const el = new NativeAudio(src);
      window.previewAudio.push(el);
      return el;
    };
  }, service.store.get("roomToken"));
  await page.goto(base + "/admin");
  await page.getByRole("button", { name: "歌星管理", exact: true }).click();
  await page.locator(".artist-card").click();
  await page.locator(".song-poster-card").first().waitFor();
  assert.equal(await page.locator(".song-poster-card").count(), 24);
  await page.getByRole("button", { name: "海报墙下一页", exact: true }).click();
  assert.equal(await page.locator(".song-poster-card").count(), 4);
  await page.getByRole("button", { name: "海报墙上一页", exact: true }).click();
  await page.getByRole("button", { name: "预览 歌曲 00", exact: true }).click();
  await page.getByRole("button", { name: "播放原唱", exact: true }).click();
  await page.waitForFunction(() =>
    window.previewAudio.some((a) => a.currentTime > 1),
  );
  assert.ok(
    await page.locator("video").evaluate((v) => v.currentTime > 0 && !v.error),
  );
  assert.equal(
    service.store.db.prepare("SELECT count(*) AS n FROM queue").get().n,
    0,
  );
  assert.ok(
    await page.evaluate(() =>
      window.previewAudio.every((a) => !a.src.includes("/backing")),
    ),
  );
  await page.getByRole("button", { name: "暂停预览", exact: true }).click();
  assert.ok(
    await page.evaluate(() => window.previewAudio.every((a) => a.paused)),
  );
  await page.locator(".preview-files summary").click();
  await page
    .getByRole("button", { name: "复制文件夹路径", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  assert.ok(
    await page.evaluate(() =>
      window.previewAudio.every((a) => a.paused && !a.getAttribute("src")),
    ),
  );
  for (const route of ["/play", "/tv"]) {
    await page.goto(base + route);
    await page.locator(".stage-card img").first().waitFor();
    assert.ok(
      await page
        .locator(".stage-card img")
        .first()
        .evaluate((i) => i.complete && i.naturalWidth > 0),
    );
  }
  await page.goto(base + "/mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".song-poster-card").first().waitFor();
  await page.getByRole("textbox", { name: "搜索歌名或歌手" }).fill("测试歌手");
  await page.waitForFunction(
    () => document.querySelectorAll(".song-poster-card").length === 28,
  );
  assert.deepEqual(
    await page.evaluate(() => [
      document.documentElement.scrollWidth,
      innerWidth,
    ]),
    [390, 390],
  );
  assert.equal(
    await page
      .locator(".song-poster-grid")
      .evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      ),
    2,
  );
  const request = await fetch(base + "/api/admin/poster-batch", {
    method: "POST",
    headers: {
      authorization: "Bearer poster-browser-password",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      items: [{ id: "0".repeat(24), expectedRevision: 0, force: true }],
    }),
  });
  assert.equal(request.status, 200);
  assert.equal((await request.json()).results[0].status, "success");
  for (const icon of [
    "/favicon.ico",
    "/favicon.png",
    "/apple-touch-icon.png",
    "/site.webmanifest",
  ])
    assert.equal((await fetch(base + icon)).status, 200);
  assert.deepEqual(errors, []);
  console.log(
    "Poster UI passed: singer pagination, original-only A/V preview, cleanup, file paths, play/TV artwork, mobile grid, cover batch revision and public icons.",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await service.close();
  await rm(dir, { recursive: true, force: true });
}
