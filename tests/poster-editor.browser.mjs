import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";
import ffmpeg from "ffmpeg-static";
import { createApp } from "../server/app.js";
process.env.FFMPEG = ffmpeg;
const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-cover-browser-")),
  media = path.join(dir, "media");
await mkdir(media);
const png = await readFile("public/favicon.png"),
  file = path.join(media, "source.wav"),
  oldCover = path.join(media, "old.png");
await writeFile(file, "untouched original audio");
await writeFile(oldCover, png);
const id = "7".repeat(24);
const service = createApp({
  dataDir: path.join(dir, "data"),
  roots: [media],
  adminToken: "cover-browser-password",
  worker: false,
  discovery: false,
  posterOptions: {
    search: async () => [
      {
        title: "合成歌曲 · 现场封面",
        uploader: "测试作者",
        cover: "https://i0.hdslb.com/bfs/archive/one.jpg",
        url: "https://www.bilibili.com/video/BV1234567890",
      },
      {
        title: "合成歌曲 · 专辑封面",
        uploader: "测试频道",
        cover: "https://i0.hdslb.com/bfs/archive/two.jpg",
        url: "https://www.bilibili.com/video/BV1234567891",
      },
    ],
    download: async () => png,
  },
});
service.store.db
  .prepare(
    "INSERT INTO songs(id,path,title,artist,status,mode,poster,lyrics,created) VALUES(?,?,?,?,?,?,?,?,?)",
  )
  .run(
    id,
    file,
    "合成歌曲",
    "测试歌手",
    "ready",
    "original",
    oldCover,
    "[00:01]旧歌词",
    Date.now(),
  );
const server = service.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`,
  browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((token) => {
    sessionStorage.setItem("adminToken", "cover-browser-password");
    localStorage.setItem("roomToken", token);
  }, service.store.get("roomToken"));
  await page.goto(base + "/admin");
  await page.getByRole("button", { name: "曲库管理", exact: true }).click();
  const row = page.locator(`[data-song-id="${id}"]`);
  await row.getByRole("button", { name: "编辑歌曲", exact: true }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.locator(".poster-editor-preview img").waitFor();
  await dialog
    .getByRole("button", { name: "去 B站搜索封面", exact: true })
    .click();
  await dialog.locator(".poster-candidate").nth(1).waitFor();
  assert.equal(await dialog.locator(".poster-candidate").count(), 2);
  await dialog.locator(".poster-candidate").nth(1).click();
  assert.equal(
    service.store.db.prepare("SELECT poster FROM songs WHERE id=?").get(id)
      .poster,
    oldCover,
  );
  await mkdir("test-results/poster-editor", { recursive: true });
  await page.screenshot({
    path: "test-results/poster-editor/cover-picker.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "保存封面", exact: true }).click();
  await dialog.getByRole("status").filter({ hasText: "封面已保存" }).waitFor();
  assert.match(
    service.store.get("poster-source:" + id).sourceUrl,
    /BV1234567891/,
  );
  await dialog
    .getByLabel("选择封面文件", { exact: true })
    .setInputFiles({
      name: "new-cover.png",
      mimeType: "image/png",
      buffer: png,
    });
  await page.waitForFunction(() =>
    document
      .querySelector(".poster-editor-preview img")
      ?.src.startsWith("blob:"),
  );
  await dialog.getByRole("button", { name: "取消选择", exact: true }).click();
  assert.equal(service.store.get("poster-source:" + id).provider, "bilibili");
  await dialog
    .getByLabel("选择封面文件", { exact: true })
    .setInputFiles({
      name: "new-cover.png",
      mimeType: "image/png",
      buffer: png,
    });
  await dialog.getByRole("button", { name: "保存封面", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".poster-editor-tools p")?.textContent ===
      "手动上传",
  );
  assert.equal(service.store.get("poster-source:" + id).provider, "manual");
  assert.equal((await readFile(file)).toString(), "untouched original audio");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/poster-editor/cover-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  let requestedSource;
  await page.route("**/api/admin/find-lyrics", (route) => {
    requestedSource = route.request().postDataJSON().source;
    const candidates = [
      {
        source: "QQ 音乐",
        provider: "qqmusic",
        sourceId: "one",
        lyrics: "[00:01]合成歌词一",
        recording: {
          title: "合成歌曲 (Live)",
          artist: "测试歌手",
          duration: 200,
          album: "现场",
        },
        warning: "",
      },
      {
        source: "QQ 音乐",
        provider: "qqmusic",
        sourceId: "two",
        lyrics: "[00:01]合成歌词二",
        recording: {
          title: "合成歌曲",
          artist: "另一歌手",
          duration: 210,
          album: "另一专辑",
        },
        warning: "演唱者不同，请核对内容",
      },
    ];
    return route.fulfill({
      json: {
        ...candidates[0],
        candidates,
        candidateCount: 2,
        selectionRequired: true,
      },
    });
  });
  await dialog.getByRole("button", { name: "同步歌词", exact: true }).click();
  const lyrics = dialog.locator("textarea");
  await dialog.getByLabel("查找歌词来源").selectOption("qqmusic");
  await dialog.getByRole("button", { name: "自动找歌词", exact: true }).click();
  await dialog.locator(".lyrics-candidate").nth(1).waitFor();
  assert.equal(requestedSource, "qqmusic");
  assert.equal(await lyrics.inputValue(), "[00:01]旧歌词");
  await dialog
    .locator(".lyrics-candidate")
    .first()
    .getByText("预览歌词", { exact: true })
    .click();
  await page.screenshot({
    path: "test-results/poster-editor/lyrics-candidates.png",
    fullPage: true,
  });
  await dialog
    .locator(".lyrics-candidate")
    .first()
    .getByRole("button", { name: "使用这份歌词" })
    .click();
  assert.equal(await lyrics.inputValue(), "[00:01]合成歌词一");
  assert.equal(
    service.store.db.prepare("SELECT lyrics FROM songs WHERE id=?").get(id)
      .lyrics,
    "[00:01]旧歌词",
  );
  let saved;
  await page.route(`**/api/admin/library/${id}/save`, async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, metadataRevision: 1 } });
  });
  await dialog.getByRole("button", { name: "仅保存信息", exact: true }).click();
  await dialog.getByRole("status").filter({ hasText: "已保存信息" }).waitFor();
  assert.equal(saved.lyricsSource.candidates, undefined);
  assert.equal(saved.lyricsSource.recording.artist, "测试歌手");
  assert.deepEqual(errors, []);
  console.log(
    "Poster editor browser passed: current preview, Bilibili selection, replace existing cover, raw upload, cancel, mobile layout, lyric source/candidate preview and explicit draft selection.",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await service.close();
  await rm(dir, { recursive: true, force: true });
}
