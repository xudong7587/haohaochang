import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";

const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-pc-page-"));
const service = createApp({
  dataDir: path.join(dir, "db"),
  roots: [path.join(dir, "media")],
  adminToken: "pc-page-test-password",
  worker: false,
  discovery: false,
});
const worker = express();
worker.use(express.json());
let updateState = { phase: "idle", current: "0.3.10" };
const updateCalls = [];
worker.post("/desktop/update/:action", (q, r) => {
  assert.equal(q.headers.authorization, "Bearer worker-test-secret");
  updateCalls.push(q.params.action);
  if (q.params.action === "check")
    updateState = {
      phase: "available",
      current: "0.3.10",
      latest: "0.3.11",
      secret: "never-forward-update-secret",
    };
  else if (q.params.action === "install") {
    assert.equal(q.body.version, "0.3.11");
    updateState = { phase: "waiting", latest: "0.3.11" };
  } else updateState = { phase: "cancelled", latest: "0.3.11" };
  r.json(updateState);
});
let mode = "online",
  requests = 0;
worker.get("/desktop/status", (q, r) => {
  requests++;
  assert.equal(q.headers.authorization, "Bearer worker-test-secret");
  if (mode === "offline") return r.status(503).end();
  r.json({
    version: "0.3.10",
    update: updateState,
    name: "测试 PC",
    device: "cuda",
    runtime: "cu128",
    gpu_name: "测试显卡",
    cpu: 21,
    memory: { used_gb: 8, total_gb: 32, percent: 25 },
    gpu: { utilization: 54, used_mb: 4000, total_mb: 12000 },
    secret: "must-not-reach-browser",
    jobs: [
      {
        id: "old-job",
        status: "done",
        stage: "done",
        title: "已整理旧歌曲",
        elapsed_seconds: 60,
      },
      {
        id: "test-job",
        status: "running",
        stage: "clipping",
        title: "测试视频裁剪",
        elapsed_seconds: 23,
        log: "正在裁剪所选区间",
        input: "private-file-path",
        key: "private-worker-key",
      },
    ],
  });
});
const remote = worker.listen(0, "127.0.0.1"),
  server = service.app.listen(0, "127.0.0.1");
await Promise.all([
  new Promise((r) => remote.once("listening", r)),
  new Promise((r) => server.once("listening", r)),
]);
const base = `http://127.0.0.1:${server.address().port}`;
service.store.set("ai", {
  enabled: true,
  pcEndpoint: `http://127.0.0.1:${remote.address().port}`,
  pcApiKey: "worker-test-secret",
});
service.store.db
  .prepare(
    "INSERT INTO jobs(id,kind,payload,status,stage,created) VALUES (?,?,?,?,?,?)",
  )
  .run(
    "nas-test",
    "download",
    JSON.stringify({
      title: "待整理歌曲",
      artist: "测试歌手",
      secret: "private-payload",
    }),
    "waiting-worker",
    "clipping",
    Date.now(),
  );
const cancelFolder = path.join(
  dir,
  "db",
  "downloads",
  ".ktv-jobs",
  "active-download",
);
await mkdir(cancelFolder, { recursive: true });
await writeFile(path.join(cancelFolder, "video.part"), "partial download");
service.store.db
  .prepare(
    "INSERT INTO jobs(id,kind,payload,status,stage,created) VALUES('active-download','download',?, 'running','downloading',?)",
  )
  .run(JSON.stringify({ title: "卡住的下载", artist: "测试歌手" }), Date.now());
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
try {
  for (const id of ["retry-failure", "delete-failure"])
    service.store.db
      .prepare(
        "INSERT INTO jobs(id,kind,payload,status,created) VALUES(?, 'download', ?, 'failed', ?)",
      )
      .run(id, JSON.stringify({ title: id, artist: "测试歌手" }), Date.now());
  assert.equal((await fetch(base + "/api/admin/pc/status")).status, 401);
  assert.equal(requests, 0);
  const response = await fetch(base + "/api/admin/pc/status", {
    headers: { Authorization: "Bearer pc-page-test-password" },
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.text();
  for (const secret of [
    "worker-test-secret",
    "private-file-path",
    "private-worker-key",
    "private-payload",
    "must-not-reach-browser",
  ])
    assert.ok(!body.includes(secret));
  const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    assert.equal(u.origin, base);
    return route.continue();
  });
  await page.goto(base + "/pc");
  await page.getByLabel("管理密码").fill("wrong");
  await page.getByRole("button", { name: "查看状态" }).click();
  await page.getByRole("alert").filter({ hasText: "请输入正确" }).waitFor();
  await page.getByLabel("管理密码").fill("pc-page-test-password");
  await page.getByRole("button", { name: "查看状态" }).click();
  await page.getByText("PC 已连接，任务自动处理", { exact: true }).waitFor();
  await page.getByText("测试视频裁剪", { exact: true }).waitFor();
  const retryRow = page.locator('[data-task-id="nas-retry-failure"]');
  await retryRow.getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForFunction(
    () =>
      ![
        ...document.querySelectorAll(
          '[data-task-id="nas-retry-failure"] .task-actions button',
        ),
      ].some((button) => button.textContent === "重试"),
  );
  assert.equal(
    service.store.db
      .prepare("SELECT status FROM jobs WHERE id='retry-failure'")
      .get().status,
    "queued",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator('[data-task-id="nas-delete-failure"]')
    .getByRole("button", { name: "取消并删除", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector('[data-task-id="nas-delete-failure"]'),
  );
  assert.equal(
    service.store.db
      .prepare("SELECT id FROM jobs WHERE id='delete-failure'")
      .get(),
    undefined,
  );
  const activeRow = page.locator('[data-task-id="nas-active-download"]');
  page.once("dialog", (dialog) => dialog.dismiss());
  await activeRow
    .getByRole("button", { name: "取消并删除", exact: true })
    .click();
  assert.ok(
    service.store.db
      .prepare("SELECT id FROM jobs WHERE id='active-download'")
      .get(),
  );
  assert.ok(await stat(path.join(cancelFolder, "video.part")));
  page.once("dialog", (dialog) => dialog.accept());
  await activeRow
    .getByRole("button", { name: "取消并删除", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector('[data-task-id="nas-active-download"]'),
  );
  assert.equal(
    service.store.db
      .prepare("SELECT id FROM jobs WHERE id='active-download'")
      .get(),
    undefined,
  );
  await assert.rejects(stat(cancelFolder), { code: "ENOENT" });
  for (const name of ["检查更新", "安装新版", "取消更新"])
    assert.equal(
      await page.getByRole("button", { name, exact: true }).count(),
      0,
    );
  assert.deepEqual(updateCalls, []);
  assert.ok(
    !(await page.locator("body").textContent()).includes(
      "never-forward-update-secret",
    ),
  );
  assert.equal(
    await page.getByText("已整理旧歌曲", { exact: true }).isVisible(),
    false,
  );
  await page.getByRole("button", { name: /已完成记录.*1 项/ }).click();
  await page.getByText("已整理旧歌曲", { exact: true }).waitFor();
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await page.getByText("已整理旧歌曲", { exact: true }).waitFor();
  await page.getByRole("button", { name: /已完成记录.*1 项/ }).click();
  await page.getByText("待整理歌曲", { exact: true }).waitFor();
  await page.getByRole("button", { name: /测试视频裁剪/ }).click();
  await page.getByText("正在裁剪所选区间", { exact: true }).waitFor();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出诊断日志" }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /好好唱诊断/);
  const exported = await fetch(base + "/api/admin/pc/logs", {
    headers: { Authorization: "Bearer pc-page-test-password" },
  });
  assert.equal(exported.status, 200);
  const exportedText = await exported.text();
  assert.ok(exportedText.includes("最近 200 条"));
  assert.ok(!exportedText.includes("worker-test-secret"));
  await mkdir("test-results/pc-dashboard", { recursive: true });
  await page.screenshot({
    path: "test-results/pc-dashboard/desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "test-results/pc-dashboard/mobile.png",
    fullPage: true,
  });
  mode = "offline";
  await page.getByRole("button", { name: "刷新状态" }).click();
  await page
    .getByText("PC返回 HTTP 503，服务暂时不可用。请查看整理器日志。", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.getByText("测试视频裁剪", { exact: true }).count(),
    0,
  );
  await page.reload();
  await page.getByRole("heading", { name: "整理任务中心" }).waitFor();
  await page.goto(base + "/admin");
  await page.getByRole("button", { name: "歌星管理", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "歌星点歌", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "歌星管理", exact: true }).click();
  await page.getByRole("heading", { name: "歌星管理", exact: true }).waitFor();
  mode = "online";
  await page.getByRole("button", { name: "PC 整理器", exact: true }).click();
  await page.getByText("PC 已连接，任务自动处理", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/admin");
  assert.equal(
    await page.getByRole("link", { name: "返回管理页面" }).count(),
    0,
  );
  await page
    .locator("summary")
    .filter({ hasText: /^PC 连接设置$/ })
    .click();
  await page
    .getByLabel("PC 地址", { exact: true })
    .fill("http://192.168.11.155:8000");
  assert.equal(await page.getByLabel("自动发现并连接 PC").isChecked(), false);
  assert.equal(
    await page.getByLabel("分离服务地址", { exact: true }).count(),
    0,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/pc-dashboard/admin-tab.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "备用 AI", exact: true }).click();
  await page.getByRole("heading", { name: "备用 AI 分离服务" }).waitFor();
  assert.equal(await page.getByLabel("PC 地址", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "检测备用 AI" }).click();
  await page.getByRole("alert").filter({ hasText: "未配置备用 AI" }).waitFor();
  await page.screenshot({
    path: "test-results/pc-dashboard/ai-tab.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PC dashboard: auth, same-origin NAS proxy, redaction, online/offline, desktop/mobile and admin singer label passed",
  );
} finally {
  await browser.close();
  service.close();
  server.closeAllConnections();
  remote.closeAllConnections();
  await Promise.all([
    new Promise((r) => server.close(r)),
    new Promise((r) => remote.close(r)),
  ]);
  await rm(dir, { recursive: true, force: true });
}
