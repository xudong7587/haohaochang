import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { matchesInitials } from "../shared/initials.js";
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react';import{createRoot}from'react-dom/client';import{LyricsSettings}from'/src/library/lyrics-settings.jsx';import'/src/style.css';
window.saved=null;createRoot(document.getElementById('root')).render(React.createElement('main',{className:'admin',style:{padding:24}},React.createElement(LyricsSettings,{request:async(url,body)=>{if(body)window.saved=body;return {font:'sans-serif',size:48,color:'#ffd66e'};},notify:message=>window.notice=message})));
</script></body></html>`;
const server = await createServer({
  configFile: false,
  plugins: [
    react(),
    {
      name: "lyrics-fixture",
      configureServer(vite) {
        vite.middlewares.use("/lyrics-fixture", async (req, res, next) => {
          try {
            res.setHeader("Content-Type", "text/html");
            res.end(await vite.transformIndexHtml("/lyrics-fixture", fixture));
          } catch (e) {
            next(e);
          }
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 0, watch: null },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = "http://127.0.0.1:" + server.httpServer.address().port;
  await page.goto(base + "/lyrics-fixture");
  const current = page.locator(".lyrics-preview-frame strong");
  await current.waitFor();
  const before = await current.boundingBox();
  await page.getByRole("slider", { name: "歌词大小", exact: true }).fill("70");
  await page.getByRole("slider", { name: "垂直位置", exact: true }).fill("75");
  await page.getByRole("slider", { name: "水平位置", exact: true }).fill("55");
  await page.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector(".lyrics-scene"),
      ).getPropertyValue("--lyrics-y") === "75%",
  );
  const after = await current.boundingBox();
  assert.ok(after.height > before.height);
  assert.ok(after.y > before.y);
  await page.getByRole("button", { name: "保存字幕设置" }).click();
  assert.deepEqual(
    await page.evaluate(() => [saved.size, saved.x, saved.y]),
    [70, 55, 75],
  );
  await mkdir("test-results/room-browsing", { recursive: true });
  await page.screenshot({
    path: "test-results/room-browsing/lyrics-preview.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "test-results/room-browsing/lyrics-preview-mobile.png",
    fullPage: true,
  });
  const songs = [
    {
      id: "qing",
      title: "青花瓷",
      artist: "周杰伦",
      status: "ready",
      mode: "original",
    },
    {
      id: "dao",
      title: "稻香",
      artist: "周杰伦",
      status: "ready",
      mode: "original",
    },
  ];
  let queued = [];
  await page.route("**/api/**", (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    let data = {};
    if (path === "/api/events")
      return route.fulfill({
        contentType: "text/event-stream",
        body:
          "data: " +
          JSON.stringify({
            queue: [],
            pending: [],
            playback: { paused: true },
          }) +
          "\n\n",
      });
    if (path === "/api/state")
      data = { queue: [], pending: [], playback: { paused: true } };
    if (path === "/api/songs")
      data = songs.filter((s) =>
        matchesInitials(s.title, url.searchParams.get("initials")),
      );
    if (path === "/api/artists")
      data = [
        { id: "zhou", artist: "周杰伦", count: 2 },
        { id: "lin", artist: "林俊杰", count: 1 },
      ].filter((s) =>
        matchesInitials(s.artist, url.searchParams.get("initials")),
      );
    if (path === "/api/queue") {
      queued.push(req.postDataJSON().songId);
      data = { queue: [], pending: [], playback: { paused: true } };
    }
    if (path === "/api/artist-profile")
      data = { id: "zhou", artist: "周杰伦", count: 2, songs };
    if (path === "/api/join") data = { url: base + "/mobile#fixture", qr: "" };
    return route.fulfill({ json: data });
  });
  await page.goto(base + "/mobile#fixture");
  await page.getByRole("button", { name: "首字母 Q", exact: true }).click();
  await page
    .getByRole("button", { name: "选择歌曲 青花瓷", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="选择歌曲 稻香"]'),
  );
  await page
    .getByRole("button", { name: "选择歌曲 青花瓷", exact: true })
    .click();
  assert.deepEqual(queued, ["qing"]);
  await page.getByRole("button", { name: "歌星点歌", exact: true }).click();
  await page.getByRole("button", { name: "首字母 Z", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".artist-card").length === 1,
  );
  await page.screenshot({
    path: "test-results/room-browsing/initials-mobile.png",
    fullPage: true,
  });
  await page.locator(".artist-card").click();
  await page.locator(".artist-library-wall").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "热更新", exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Room browsing: initials filter, direct enqueue, artist detail, static lyric preview, save and mobile width passed",
  );
} finally {
  await browser.close();
  await server.close();
}
