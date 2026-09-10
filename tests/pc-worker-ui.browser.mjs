import assert from "node:assert/strict";
import express from "express";
import path from "node:path";
import { chromium } from "playwright";
const app = express(),
  jobs = [
    {
      id: "running",
      title: "正在分离的歌曲",
      status: "running",
      stage: "separating",
      model: "htdemucs",
      model_progress: 42,
      created: Date.now() / 1000,
    },
  ];
for (let i = 0; i < 75; i++)
  jobs.push({
    id: "q" + i,
    title: "排队歌曲 " + i,
    status: "queued",
    created: Date.now() / 1000,
  });
for (let i = 0; i < 80; i++)
  jobs.push({
    id: "d" + i,
    title: "完成歌曲 " + i,
    status: "done",
    created: Date.now() / 1000,
  });
let update = { phase: "idle", current: "0.3.10" };
app.use(express.json());
app.get("/update.js", (q, r) =>
  r.sendFile(path.resolve("pc-worker/ui/update.js")),
);
app.post("/desktop/update/:action", (q, r) => {
  assert.equal(q.headers.authorization, "Bearer fixture-key");
  update =
    q.params.action === "check"
      ? { phase: "available", latest: "0.3.11" }
      : q.params.action === "install"
        ? { phase: "waiting", latest: "0.3.11" }
        : { phase: "cancelled" };
  r.json(update);
});
app.get("/desktop/status", (req, res) =>
  res.json({
    version: "0.3.10",
    update,
    jobs,
    device: "cpu",
    cpu: 8,
    memory: { used_gb: 4, total_gb: 32, percent: 12 },
    runtime: "test",
    segment: 7,
    addresses: [],
    lan: { enabled: false },
  }),
);
app.get("/icon.svg", (req, res) =>
  res.type("svg").send('<svg xmlns="http://www.w3.org/2000/svg"/>'),
);
app.get("/", (req, res) =>
  res.sendFile(path.resolve("pc-worker/ui/index.html")),
);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(
    "http://127.0.0.1:" + server.address().port + "/#fixture-key",
  );
  await page.locator(".task-item").waitFor();
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByRole("button", { name: "安装新版", exact: true }).waitFor();
  await page.getByRole("button", { name: "安装新版", exact: true }).click();
  await page.getByRole("button", { name: "取消更新", exact: true }).waitFor();
  await page.getByRole("button", { name: "取消更新", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已取消更新" }).waitFor();
  assert.equal(await page.locator(".task-item").count(), 1);
  await page.getByRole("button", { name: /排队等待 · 75 项/ }).click();
  assert.equal(await page.locator(".task-item").count(), 11);
  await page
    .getByRole("button", { name: "排队等待下一页", exact: true })
    .click();
  await page.getByText("排队歌曲 10", { exact: true }).waitFor();
  await page.screenshot({ path: "test-results/pc-workbench.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(
    await page.evaluate(() => [
      document.documentElement.scrollWidth,
      innerWidth,
    ]),
    [390, 390],
  );
  await page.screenshot({ path: "test-results/pc-workbench-mobile.png" });
  console.log(
    "PC standalone workspace passed: 156 jobs, grouped collapse, ten-row pagination, mobile width",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
