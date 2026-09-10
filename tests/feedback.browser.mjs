import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-feedback-ui-"));
const service = createApp({
  dataDir: path.join(dir, "db"),
  roots: [path.join(dir, "media")],
  downloads: path.join(dir, "downloads"),
  adminToken: "feedback-ui-password",
  worker: false,
  discovery: false,
});
const insert = service.store.db.prepare(
  "INSERT INTO jobs(id,kind,payload,status,stage,created,started) VALUES(?,?,?,?,?,?,?)",
);
insert.run(
  "active",
  "import",
  JSON.stringify({ id: "song-progress", title: "晴天", artist: "周杰伦" }),
  "running",
  "separating",
  Date.now() - 120000,
  Date.now() - 120000,
);
service.store.set("separation:song-progress:pc", {
  result: { status: "running", stage: "separating", model_progress: 42 },
});
for (let i = 0; i < 49; i++)
  insert.run(
    "queue-" + i,
    "organize",
    JSON.stringify({ title: "待整理歌曲 " + i, artist: "测试歌手" }),
    "queued",
    "",
    Date.now() - 60000 + i,
    null,
  );
const server = service.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((token) => {
    sessionStorage.setItem("adminToken", "feedback-ui-password");
    localStorage.setItem("roomToken", token);
  }, service.store.get("roomToken"));
  await page.goto(`http://127.0.0.1:${server.address().port}/admin`);
  await page.getByRole("button", { name: "设置与任务", exact: true }).click();
  await page.locator(".task-song").filter({ hasText: "晴天" }).waitFor();
  assert.equal(await page.locator(".task-item").count(), 1, "queued work starts collapsed");
  await page.getByRole("button", {name:/排队等待.*49 项/}).click();
  assert.equal(await page.locator(".task-item").count(), 11, "only one page of queued tasks renders");
  await page.getByRole("button", {name:"排队等待下一页",exact:true}).click();
  await page.getByText("待整理歌曲 10", {exact:true}).waitFor();
  assert.equal(
    await page.locator("progress").first().getAttribute("value"),
    "42",
  );
  await mkdir("test-results/feedback", { recursive: true });
  await page.screenshot({
    path: "test-results/feedback/tasks.png",
    fullPage: false,
  });
  const nav = page.getByRole("navigation", { name: "设置功能板块" });
  await nav.getByRole("button", { name: "在线资源", exact: true }).click();
  assert.equal(
    await page.getByLabel("启用 Bilibili / YouTube 在线搜索与入库").isChecked(),
    true,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "NAS 媒体目录", exact: true })
      .isVisible(),
    false,
  );
  await page.getByLabel("启用 Bilibili / YouTube 在线搜索与入库").uncheck();
  await nav.getByRole("button", { name: "连接地址", exact: true }).click();
  await nav.getByRole("button", { name: "在线资源", exact: true }).click();
  assert.equal(
    await page.getByLabel("启用 Bilibili / YouTube 在线搜索与入库").isChecked(),
    false,
    "draft retained across settings panels",
  );
  await page.screenshot({
    path: "test-results/feedback/online-settings.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await nav.getByRole("button", { name: "后台任务", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "mobile page overflow",
  );
  await page.screenshot({
    path: "test-results/feedback/tasks-mobile.png",
    fullPage: false,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Feedback settings browser checks passed: 50 named tasks, real progress, functional panels, default online, retained drafts, mobile width.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  service.close();
  await rm(dir, { recursive: true, force: true });
}
