import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { createApp } from "../server/app.js";
import { searchText, prepareSong } from "../server/media.js";
import { run } from "../server/process.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
process.env.FFMPEG = ffmpeg;
process.env.FFPROBE = ffprobe.path;
await mkdir("test-results/ui", { recursive: true });
const directory = await mkdtemp(path.join(os.tmpdir(), "ktv-ui-")),
  media = path.join(directory, "media");
await mkdir(media);
const service = createApp({
  adminToken: "ui-test-password",
  dataDir: path.join(directory, "db"),
  roots: [media],
  worker: false,
});
const { app, store, close } = service;
const titles = ["合成测试曲 · 清晨", "合成测试曲 · 夏夜", "合成测试曲 · 远方"];
const file = path.join(media, "fixture.mkv");
await run(ffmpeg, [
  "-y",
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=0x314b50:s=320x180:r=12:d=90",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=90",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=880:duration=90",
  "-map",
  "0:v",
  "-map",
  "1:a",
  "-map",
  "2:a",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-c:a",
  "aac",
  file,
]);
for (const [i, title] of titles.entries()) {
  const id = String(i + 1).repeat(24),
    source = path.join(media, "source-" + i + ".mkv");
  const { copyFile } = await import("node:fs/promises");
  await copyFile(file, source);
  store.db
    .prepare(
      "INSERT INTO songs (id,path,title,artist,search,created,mode,backing,vocal,lyrics) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      source,
      title,
      "测试歌手",
      searchText(title, "测试歌手"),
      Date.now() - i,
      "tracks",
      0,
      1,
      "[00:00.00]合成测试字幕\n[00:20.00]手机点歌与双版本播放",
    );
  await prepareSong(store, id, [media], path.join(media, "好好唱播放资源"));
}
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = "http://127.0.0.1:" + server.address().port;
const channel = process.env.BROWSER_CHANNEL;
const browser = await chromium.launch({
  ...(channel && channel !== "chromium" ? { channel } : {}),
  headless: true,
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/tv");
  await page.getByLabel("管理密码").fill("ui-test-password");
  await page.getByRole("button", { name: "进入好好唱" }).click();
  await page.locator(".stage-card").first().waitFor();
  await page.screenshot({ path: "test-results/ui/stage.png", fullPage: true });
  await page.getByRole("button", { name: "我要点歌", exact: true }).click();
  await page.getByText("今晚，唱点开心的。").waitFor();
  await page
    .getByRole("button", { name: "点歌 " + titles[0], exact: true })
    .waitFor();
  await page.screenshot({ path: "test-results/ui/tv.png", fullPage: true });
  await page.getByRole("button", { name: "歌名点歌", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator(":focus").innerText(), "歌星点歌");
  await page.getByLabel("搜索歌名或歌手").fill("不存在的歌曲");
  await page.getByText("还没找到这首歌").waitFor();
  await page.getByRole("button", { name: "清空搜索" }).click();
  await page.getByRole("button", { name: "扫码点歌", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.getByRole("dialog").locator("img").count(), 1);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto(base + "/mobile#" + store.get("roomToken"));
  await mobile
    .getByRole("button", { name: "点歌 " + titles[0], exact: true })
    .waitFor();
  await mobile.screenshot({
    path: "test-results/ui/mobile.png",
    fullPage: true,
  });
  await mobile
    .getByRole("button", { name: "点歌 " + titles[0], exact: true })
    .click();
  await page
    .locator(".now-playing strong")
    .filter({ hasText: titles[0] })
    .waitFor();
  await mobile.getByRole("button", { name: "发送 👏", exact: true }).click();
  await page.locator(".reaction-layer").getByText("👏").waitFor();
  await page.goto(base + "/admin");
  await page.getByRole("button", { name: "设置与任务", exact: true }).click();
  await page.getByRole("button", { name: "媒体与导入", exact: true }).click();
  await page
    .getByRole("heading", { name: "NAS 媒体目录", exact: true })
    .waitFor();
  await page.screenshot({ path: "test-results/ui/admin.png", fullPage: true });
  await page.getByRole("button", { name: "曲库管理", exact: true }).click();
  await page.getByRole("button", { name: /^标准曲库/ }).click();
  await page.locator(".artist-library summary").first().click();
  const row = page.locator('[data-song-id="' + String(2).repeat(24) + '"]');
  await row.getByRole("button", { name: "编辑歌曲", exact: true }).click();
  await row.getByLabel("歌名", { exact: true }).fill("保留中的草稿");
  const before = store.db
    .prepare("SELECT metadataRevision FROM songs WHERE id=?")
    .get(String(2).repeat(24)).metadataRevision;
  store.db
    .prepare("UPDATE songs SET title=?,search=? WHERE id=?")
    .run(
      "后台更新的标题",
      searchText("后台更新的标题", "测试歌手"),
      String(2).repeat(24),
    );
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await row
    .getByRole("alert")
    .filter({ hasText: "资料已更新，草稿已保留" })
    .waitFor();
  assert.equal(
    await row.getByLabel("歌名", { exact: true }).inputValue(),
    "保留中的草稿",
  );
  const stale = await fetch(
    base + "/api/admin/library/" + String(2).repeat(24) + "/save",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer ui-test-password",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "过期覆盖",
        artist: "测试歌手",
        lyrics: "[00:00]旧",
        expectedRevision: before,
      }),
    },
  );
  assert.equal(stale.status, 409);
  await row
    .getByRole("button", { name: "采用最新资料，放弃草稿", exact: true })
    .click();
  assert.equal(
    await row.getByLabel("歌名", { exact: true }).inputValue(),
    "后台更新的标题",
  );
  await row.getByLabel("歌名", { exact: true }).fill("编辑后的测试歌曲");
  await row.getByRole("button", { name: "仅保存信息", exact: true }).click();
  await row.getByText("编辑后的测试歌曲", { exact: true }).waitFor();
  assert.equal(
    store.db
      .prepare("SELECT title FROM songs WHERE id=?")
      .get(String(2).repeat(24)).title,
    "编辑后的测试歌曲",
  );
  await page.screenshot({
    path: "test-results/ui/workbench.png",
    fullPage: true,
  });
  const hidden = String(3).repeat(24);
  let response = await fetch(base + "/api/admin/library/" + hidden, {
    method: "DELETE",
    headers: { Authorization: "Bearer ui-test-password" },
  });
  assert.equal(response.status, 200);
  response = await fetch(base + "/api/queue", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + store.get("roomToken"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ songId: hidden }),
  });
  assert.equal(response.status, 409);
  response = await fetch(base + "/api/admin/library/" + hidden + "/restore", {
    method: "POST",
    headers: { Authorization: "Bearer ui-test-password" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(errors, []);
  console.log(
    "UI passed: TV, QR, mobile queue, reactions, workbench edits, stale drafts, revision conflicts, hide/restore.",
  );
  await writeFile(
    "test-results/ui/result.json",
    JSON.stringify({ passed: true, checks: 11, pageErrors: errors }, null, 2),
  );
} finally {
  await browser.close();
  close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(directory, { recursive: true, force: true });
}
