import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const temp = await mkdtemp(path.join(os.tmpdir(), "ktv-player-check-"));
const output = path.resolve("test-results/player");
await mkdir(output, { recursive: true });
function tone(seconds) {
  const sampleRate = 16000,
    frames = sampleRate * seconds,
    wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    wav.writeInt16LE(
      Math.round(Math.sin((i / sampleRate) * 440 * Math.PI * 2) * 3000),
      44 + i * 2,
    );
  return wav;
}
await writeFile(path.join(temp, "tone.wav"), tone(30));
await writeFile(path.join(temp, "short.wav"), tone(2));
await writeFile(
  path.join(temp, "index.html"),
  '<html><head><meta charset="UTF-8"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
);
await build({
  stdin: {
    contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Player} from './src/playback/player.jsx';import './src/style.css';
function Fixture(){const [paused,setPaused]=useState(false),[vocal,setVocal]=useState(false),[id,setId]=useState('entry-1'),[song,setSong]=useState(new URLSearchParams(location.search).get('song')||'audio');window.setPaused=setPaused;window.setVocal=setVocal;window.setEntry=setId;window.setSong=setSong;
async function request(url,body){if(url==='/player/heartbeat'&&window.leaseFailure)throw new Error('测试：另一台设备持有播放会话');if(url==='/player/ended')window.endedCalls=(window.endedCalls||0)+1;return {ok:true};}
return <div className="app tv stage-home"><Player current={{id,song_id:song,title:'本地合成测试',artist:'测试歌手',needs_video:song==='audio'?1:0,duration:30,lyrics:'[00:00]第一句 · 准备开唱\\n[00:03]第二句 · 音乐和字幕同步'}} playback={{paused,vocal}} token="fixture" request={request} notify={()=>{}}/></div>}
createRoot(document.getElementById('root')).render(<Fixture/>);`,
    resolveDir: process.cwd(),
    loader: "jsx",
  },
  bundle: true,
  outfile: path.join(temp, "fixture.js"),
});
const app = express();
app.get("/api/playback-assets/:id", (req, res) =>
  res.json(
    req.params.id === "legacy"
      ? { version: 1 }
      : {
          version: 2,
          revision: 7,
          vocal: true,
          backing: true,
          video: req.params.id === "picture",
          resources: {
            vocal: { url: "/tone.wav", offset: 0 },
            backing: { url: "/tone.wav?backing=1", offset: 0 },
            ...(req.params.id === "picture"
              ? { video: { url: "/short.wav", offset: 1, duration: 2 } }
              : {}),
          },
          background: {
            images: ["/image/one.svg", "/image/two.svg"],
            intervalSeconds: 3,
          },
        },
  ),
);
app.get("/api/media/legacy/:kind", (_req, res) =>
  res.sendFile(path.join(temp, "tone.wav")),
);
app.get("/api/lyrics-style", (_req, res) =>
  res.json({ font: "sans-serif", size: 48, color: "#ffd66e", offset: 0 }),
);
app.get("/image/:name", (req, res) =>
  res
    .type("svg")
    .send(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g"><stop stop-color="${req.params.name === "one.svg" ? "#352452" : "#194354"}"/><stop offset="1" stop-color="#161426"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/></svg>`,
    ),
);
app.use(express.static(temp));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`,
  requested = process.env.BROWSER_CHANNEL;
const browserOptions = {
  headless: true,
  ...(requested && requested !== "chromium" ? { channel: requested } : {}),
};
let browser, strictBrowser;
try {
  browser = await chromium.launch({
    ...browserOptions,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(
    () => document.querySelector("video")?._playback?.getTime() > 0.5,
  );
  const read = () =>
    page.evaluate(() => {
      const v = document.querySelector("video");
      return {
        time: v._playback.getTime(),
        tracks: v._audioTracks.map((t) => ({
          kind: t.kind,
          time: t.el.currentTime,
          paused: t.el.paused,
          gain: t.gain?.gain.value,
        })),
        context: v._audioContext.state,
      };
    });
  const initial = await read();
  assert.equal(initial.context, "running");
  assert.ok(initial.tracks.every((t) => !t.paused));
  assert.ok(Math.abs(initial.tracks[0].time - initial.tracks[1].time) < 0.2);
  await page.evaluate(() => window.setVocal(true));
  await page.waitForFunction(
    () => document.querySelector("video")._playback.selected().kind === "vocal",
  );
  await page.evaluate(() => window.setPaused(true));
  await page.waitForFunction(() =>
    document.querySelector("video")._audioTracks.every((t) => t.el.paused),
  );
  const paused = await read();
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await read()).time - paused.time) < 0.02);
  await page.evaluate(() => window.setPaused(false));
  await page.waitForFunction(
    () => document.querySelector("video")._playback.getTime() > 1,
  );
  await page.evaluate(() => document.querySelector("video")._playback.seek(4));
  await page.waitForFunction(() =>
    document.querySelector(".playback-background")?.src.includes("two.svg"),
  );
  await page.screenshot({
    path: path.join(output, "audio-stage.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "全屏播放" }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.screenshot({ path: path.join(output, "audio-fullscreen.png") });
  await page.getByRole("button", { name: "退出全屏" }).click();
  await page.evaluate(() => {
    window.setVocal(false);
    const t = document
      .querySelector("video")
      ._audioTracks.find((t) => t.kind === "backing");
    t.el.src = "/missing.wav";
    t.el.load();
  });
  await page.waitForFunction(
    () => document.querySelector("video")._playback.selected().kind === "vocal",
  );
  await page
    .getByRole("status")
    .filter({ hasText: "已切换到可用原唱" })
    .waitFor();
  assert.equal(
    (await read()).tracks.find((t) => t.kind === "vocal").paused,
    false,
  );
  assert.equal(
    await page
      .locator(".video-caption [data-audio-variant]")
      .getAttribute("data-audio-variant"),
    "vocal",
  );
  await page.evaluate(() => (window.leaseFailure = true));
  await page.waitForFunction(
    () =>
      document.querySelector("video")._audioTracks.every((t) => t.el.paused),
    null,
    { timeout: 8000 },
  );
  await page.evaluate(() => (window.leaseFailure = false));
  await page.waitForFunction(
    () =>
      document
        .querySelector("video")
        ._audioTracks.some((t) => !t.failed && !t.el.paused),
    null,
    { timeout: 8000 },
  );
  await page.evaluate(() => {
    window.oldTracks = document.querySelector("video")._audioTracks;
    window.setEntry("entry-2");
  });
  await page.waitForFunction(
    () =>
      document.querySelector("video")._audioTracks !== window.oldTracks &&
      document.querySelector("video")._playback?.getTime() > 0.2,
  );
  assert.equal(
    await page.evaluate(() => window.oldTracks.every((t) => t.el.paused)),
    true,
  );
  await page.goto(base + "/?song=picture");
  await page.waitForFunction(() => document.querySelector("video")?.ended);
  assert.equal(await page.evaluate(() => window.endedCalls || 0), 0);
  assert.equal(
    await page.evaluate(() =>
      document.querySelector("video")._audioTracks.every((t) => !t.el.paused),
    ),
    true,
  );
  // Delay old-format metadata, pause while loading, then release the response.
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/api/media/legacy/**", async (route) => {
    await held;
    await route.continue();
  });
  const legacyRequest = page.waitForRequest("**/api/media/legacy/**");
  await page.goto(base + "/?song=legacy", { waitUntil: "domcontentloaded" });
  await legacyRequest;
  await page.evaluate(() => window.setPaused(true));
  release();
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 1,
  );
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => document.querySelector("video").paused),
    true,
  );
  await page.evaluate(() => window.setPaused(false));
  await page.waitForFunction(
    () => document.querySelector("video").currentTime > 0.2,
  );
  await page.evaluate(() => {
    document.querySelector("video").currentTime = 3;
    window.setVocal(true);
  });
  await page.waitForFunction(
    () =>
      document.querySelector("video").currentTime >= 3 &&
      !document.querySelector("video").paused,
  );
  await page.evaluate(() => (window.leaseFailure = true));
  await page.waitForFunction(
    () => document.querySelector("video").paused,
    null,
    { timeout: 8000 },
  );
  await page.evaluate(() => (window.leaseFailure = false));
  await page.waitForFunction(
    () => !document.querySelector("video").paused,
    null,
    { timeout: 8000 },
  );
  assert.deepEqual(errors, []);
  strictBrowser = await chromium.launch({
    ...browserOptions,
    args: [
      "--autoplay-policy=document-user-activation-required",
      "--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies",
    ],
  });
  const strict = await strictBrowser.newPage();
  strict.on("pageerror", (error) => errors.push(error.message));
  await strict.goto(base);
  const strictSession = await strict.context().newCDPSession(strict);
  let deniedState;
  for (let attempt = 0; attempt < 400; attempt++) {
    const result = await strictSession.send("Runtime.evaluate", {
      expression:
        "JSON.stringify({tracks:document.querySelector('video')?._audioTracks?.map(t=>({blocked:t.blocked,paused:t.el.paused,ready:t.el.readyState})),button:[...document.querySelectorAll('button')].some(b=>b.textContent.includes('开始播放'))})",
      userGesture: false,
      returnByValue: true,
    });
    deniedState = JSON.parse(result.result.value);
    if (
      deniedState.tracks?.length === 2 &&
      deniedState.tracks.every((t) => t.blocked && t.paused && t.ready >= 2) &&
      deniedState.button
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(deniedState.tracks?.length, 2);
  assert.ok(
    deniedState.tracks.every((t) => t.blocked && t.paused),
    JSON.stringify(deniedState),
  );
  assert.equal(deniedState.button, true);
  await strict.getByRole("button", { name: "开始播放", exact: true }).click();
  await strict.waitForFunction(
    () =>
      document.querySelector("video")._audioContext.state === "running" &&
      document.querySelector("video")._playback.getTime() > 0.3,
  );
  assert.equal(
    await strict.getByRole("button", { name: "开始播放", exact: true }).count(),
    0,
  );
  const legacyStrict = await strictBrowser.newPage();
  legacyStrict.on("pageerror", (error) => errors.push(error.message));
  await legacyStrict.goto(base + "/?song=legacy");
  // Playwright's page.evaluate/waitForFunction may carry userGesture=true.
  // Read loading state through CDP without granting audio authorization.
  const legacySession = await legacyStrict
    .context()
    .newCDPSession(legacyStrict);
  let legacyState;
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await legacySession.send("Runtime.evaluate", {
      expression:
        "JSON.stringify({ready:document.querySelector('video')?.readyState,paused:document.querySelector('video')?.paused,active:navigator.userActivation.isActive})",
      userGesture: false,
      returnByValue: true,
    });
    legacyState = JSON.parse(result.result.value);
    if (legacyState.ready >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(legacyState.ready >= 2, "legacy media metadata must load");
  assert.equal(legacyState.paused, true, JSON.stringify(legacyState));
  await legacyStrict
    .getByRole("button", { name: "开始播放", exact: true })
    .click();
  await legacyStrict.waitForFunction(
    () =>
      !document.querySelector("video").paused &&
      document.querySelector("video").currentTime > 0.2,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Player browser passed: real WAV dual audio, switching, pause, shared slideshow, fallback label, leases, entry cleanup, early picture end, delayed legacy metadata, native autoplay denial and click recovery; screenshots saved.",
  );
} finally {
  await strictBrowser?.close();
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (
    path.dirname(path.resolve(temp)) !== path.resolve(os.tmpdir()) ||
    !path.basename(temp).startsWith("ktv-player-check-")
  )
    throw new Error("Unexpected test output path");
  await rm(temp, { recursive: true, force: true });
}
