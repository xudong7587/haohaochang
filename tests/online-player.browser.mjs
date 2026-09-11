// All media, API fixtures and browser requests stay on an isolated localhost server.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import { chromium } from "playwright";
import ffmpeg from "ffmpeg-static";
import { run } from "../server/process.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "ktv-online-browser-"));
await mkdir("test-results/online", { recursive: true });
await run(ffmpeg, [
  "-y",
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=s=320x180:r=24:d=12",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=12",
  "-c:v",
  "libx264",
  "-c:a",
  "aac",
  "-movflags",
  "+faststart",
  path.join(temp, "video.mp4"),
]);
await run(ffmpeg, [
  "-y",
  "-v",
  "error",
  "-i",
  path.join(temp, "video.mp4"),
  "-vn",
  "-c:a",
  "aac",
  path.join(temp, "audio.m4a"),
]);
await writeFile(
  path.join(temp, "index.html"),
  '<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
);
await build({
  stdin: {
    contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{OnlineSongs}from'./src/online-songs.jsx';import{Player}from'./src/playback/player.jsx';import './src/style.css';
function Fixture(){const[offset,setOffset]=useState(0);window.controlCalls ||= [];async function request(url,body){if(url==='/control'){window.controlCalls.push(body);setOffset(v=>body.reset?0:v+body.deltaMs);}return{ok:true};}
return location.pathname==='/lyrics'?<div className="app tv stage-home"><input aria-label="测试输入框"/><Player keyboardLyrics current={{id:'entry-fixture',song_id:'fixture',title:'歌词测试',artist:'合成测试',duration:12,mode:'tracks',lyrics:'[00:08]第一句歌词\\n[00:10]第二句歌词'}} playback={{paused:true,vocal:true,lyricsOffsetMs:offset}} request={request} token="fixture" notify={()=>{}}/></div>:<main style={{maxWidth:1100,margin:'auto',padding:24}}><OnlineSongs mobile={location.pathname==='/mobile'} notify={message=>window.notice=message}/></main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
`,
    resolveDir: process.cwd(),
    loader: "jsx",
  },
  bundle: true,
  outfile: path.join(temp, "fixture.js"),
});
const app = express();
app.use(express.json());
const audioRequests = [];
app.get("/api/requests/status", (_q, r) =>
  r.json(
    audioRequests.map((p, i) => ({
      ...p,
      id: "request-" + i,
      status: "queued",
      stage: "acquire",
    })),
  ),
);
app.post("/api/requests", (q, r) => {
  audioRequests.push(q.body);
  r.json({ id: "audio-fixture" });
});
const submissions = [],
  previewRequests = [];
app.get("/api/online/songs", (q, r) =>
  r.json({
    duration: 12,
    page: 1,
    hasMore: false,
    results: [
      {
        title: "测试视频 · 演唱室现场",
        url: "https://www.bilibili.com/video/BVtest1",
        uploader: "合成测试",
        duration: 12,
        durationDifference: 0,
      },
      {
        title: "测试视频 · 有开场介绍的加长版本",
        url: "https://www.bilibili.com/video/BVtest2",
        uploader: "合成测试",
        duration: 30,
        durationDifference: 18,
      },
      {
        title: "测试视频 · 音乐和画面",
        url: "https://www.bilibili.com/video/BVtest3",
        uploader: "合成测试",
        duration: 14,
        durationDifference: 2,
      },
    ],
  }),
);
app.post("/api/online/preview", (q, r) => {
  previewRequests.push(q.body);
  r.json({
    quality: q.body.quality,
    qualities: [
      { value: "highest", label: "最高可用" },
      { value: "1080", label: "1080p" },
      { value: "360", label: "360p" },
    ],
    previewHeight: 360,
    downloadHeight: 2160,
    id: "preview-fixture",
    duration: 12,
    video: "/video.mp4",
    audio: "/audio.m4a",
  });
});
app.post("/api/online", (q, r) => {
  submissions.push(q.body);
  r.json({ id: "job-fixture" });
});
app.get("/api/playback-assets/fixture", (_q, r) => r.json({ version: 1 }));
app.get("/api/media/*path", (_q, r) =>
  r.sendFile(path.join(temp, "video.mp4")),
);
app.get("/api/lyrics-style", (_q, r) => r.json({}));
app.use(express.static(temp));
app.get(["/lyrics", "/mobile"], (_q, r) =>
  r.sendFile(path.join(temp, "index.html")),
);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL && process.env.BROWSER_CHANNEL !== "chromium"
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let dialogs = 0;
page.on("dialog", (d) => {
  dialogs++;
  d.dismiss();
});
try {
  await page.goto(origin);
  await page.getByLabel("在线歌名").fill("测试歌名");
  await page.getByLabel("在线歌手").fill("测试歌手");
  await page.getByRole("button", { name: "搜索视频", exact: true }).click();
  await page.waitForSelector(".video-card");
  assert.equal(await page.locator(".video-card").count(), 3);
  await page.screenshot({
    path: "test-results/online/waterfall-desktop.png",
    fullPage: true,
  });
  // Editing query after search must not rename already displayed search results.
  await page.getByLabel("在线歌名").fill("尚未搜索的新歌名");
  await page.locator(".video-card").first().click();
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 1,
  );
  assert.equal(
    await page.getByRole("dialog").getByRole("heading").textContent(),
    "测试歌名 · 测试歌手",
  );
  await page.locator("video").evaluate((v) => {
    v.pause();
    v.currentTime = 1.25;
  });
  await page.getByRole("button", { name: "标记开头", exact: true }).click();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("video").currentTime > 1.5,
  );
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.locator("video").evaluate((v) => {
    v.currentTime = 3.75;
  });
  await page.getByRole("button", { name: "标记结束", exact: true }).click();
  const pair = await page.evaluate(() => ({
    v: document.querySelector("video").currentTime,
    a: document.querySelector("audio").currentTime,
    paused: document.querySelector("audio").paused,
  }));
  assert.ok(Math.abs(pair.v - pair.a) < 0.2);
  assert.equal(pair.paused, true);
  await page.screenshot({
    path: "test-results/online/marked-preview.png",
    fullPage: true,
  });
  const previewCount = previewRequests.length;
  const previewSrc = await page.locator("video").getAttribute("src");
  await page.getByLabel("视频清晰度").selectOption("1080");
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 1,
  );
  assert.equal(previewRequests.length, previewCount);
  assert.equal(await page.locator("video").getAttribute("src"), previewSrc);
  assert.equal(previewRequests.at(-1).quality, undefined);
  assert.ok(
    Math.abs(
      (await page.locator("video").evaluate((v) => v.currentTime)) - 3.75,
    ) < 0.1,
  );
  await page.getByRole("button", { name: "加入曲库", exact: true }).click();
  await page
    .getByRole("button", { name: "已加入整理任务", exact: true })
    .waitFor();
  assert.deepEqual(submissions[0].clip, { start: 1.25, end: 3.75 });
  assert.equal(submissions[0].title, "测试歌名");
  assert.equal(submissions[0].quality, "1080");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator(".video-card").nth(1).click();
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 1,
  );
  await page.locator("video").evaluate((v) => {
    v.currentTime = 5;
  });
  await page.getByRole("button", { name: "标记开头", exact: true }).click();
  await page.locator("video").evaluate((v) => {
    v.currentTime = 2;
  });
  await page.getByRole("button", { name: "标记结束", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "加入曲库", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "恢复全部", exact: true }).click();
  await page.getByRole("button", { name: "加入曲库", exact: true }).click();
  await page
    .getByRole("button", { name: "已加入整理任务", exact: true })
    .waitFor();
  assert.equal(submissions[1].clip, null);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/online/waterfall-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(origin + "/lyrics");
  const enterFull = async () => {
    await page.locator(".tv-player").evaluate((el) => {
      el.requestFullscreen = () => Promise.reject(new Error("WebView fixture"));
    });
    await page.getByRole("button", { name: "全屏播放", exact: true }).click();
    await page.locator(".tv-player.is-full").waitFor();
  };
  await enterFull();
  await page.waitForSelector(".lyric-countdown");
  assert.match(
    await page.locator(".lyric-current").textContent(),
    /第一句歌词/,
  );
  assert.equal(await page.locator(".lyric-countdown span").count(), 4);
  await page.getByRole("button", { name: "隐藏歌词", exact: true }).click();
  assert.equal(await page.locator(".lyrics-scene").count(), 0);
  assert.equal(await page.getByLabel("歌词时间微调").count(), 0);
  await page.locator(".video-stage").focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.evaluate(() => window.controlCalls.length), 0);
  await page.reload();
  await enterFull();
  await page.getByRole("button", { name: "显示歌词", exact: true }).waitFor();
  assert.equal(await page.locator(".lyrics-scene").count(), 0);
  await page.getByRole("button", { name: "显示歌词", exact: true }).click();
  await page.waitForSelector(".lyric-countdown");
  await page.locator(".video-stage").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => window.controlCalls.length === 1);
  assert.equal(await page.evaluate(() => window.controlCalls[0].deltaMs), 100);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => window.controlCalls.length === 2);
  assert.equal(await page.evaluate(() => window.controlCalls[1].deltaMs), -100);
  await page.getByLabel("测试输入框").fill("输入内容");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.evaluate(() => window.controlCalls.length), 2);
  await page.screenshot({
    path: "test-results/online/lyrics-countdown.png",
    fullPage: true,
  });
  for (const direction of ["提前", "延后"]) {
    for (const seconds of [0.5, 3, 10]) {
      await page
        .getByRole("button", {
          name: `歌词${direction} ${seconds} 秒`,
          exact: true,
        })
        .click();
      assert.equal(
        await page.evaluate(() => window.controlCalls.at(-1).deltaMs),
        (direction === "提前" ? 1 : -1) * seconds * 1000,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.querySelector(".app").className = "";
  });
  await page.screenshot({
    path: "test-results/online/lyrics-steps-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.locator(".tv-player").evaluate((el) => {
    el.requestFullscreen = () => Promise.reject(new Error("WebView fixture"));
  });
  await page.getByRole("button", { name: "退出全屏", exact: true }).click();
  await page.getByRole("button", { name: "全屏播放", exact: true }).click();
  await page.waitForSelector(".tv-player.is-full");
  await page.evaluate(() =>
    document.dispatchEvent(new Event("fullscreenchange")),
  );
  await page.waitForSelector(".tv-player.is-full");
  await page.getByRole("button", { name: "隐藏歌词", exact: true }).click();
  assert.equal(await page.locator(".lyrics-scene").count(), 0);
  await page.getByRole("button", { name: "显示歌词", exact: true }).click();
  await page.waitForSelector(".lyrics-scene");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".tv-player.is-full").count(), 1);
  await page.keyboard.press("ArrowDown");
  await page.getByRole("button", { name: "退出全屏", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector(".tv-player.is-full"),
  );
  assert.equal(dialogs, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/mobile");
  await page.getByLabel("在线歌名").fill("手机测试歌曲");
  await page.getByLabel("在线歌手").fill("手机测试歌手");
  await page.getByRole("button", { name: "搜索视频", exact: true }).click();
  await page.locator(".video-card").first().click();
  await page.getByRole("button", { name: "整理并点歌", exact: true }).click();
  await page
    .getByRole("button", { name: "已加入整理任务", exact: true })
    .waitFor();
  assert.equal(submissions.at(-1).client, "mobile");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .getByRole("button", { name: "先找音频 + 歌词", exact: true })
    .click();
  await page.getByRole("heading", { name: "手机找歌进度" }).waitFor();
  assert.equal(audioRequests.at(-1).title, "手机测试歌曲");
  assert.equal(audioRequests.at(-1).artist, "手机测试歌手");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "test-results/online/mobile-request.png",
    fullPage: true,
  });
  console.log(
    "PASS online waterfall, preview A/V, paused/playing range marks, full video default, invalid range, identity, mobile layout, lyric countdown and remote keys.",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(temp, { recursive: true, force: true });
}
