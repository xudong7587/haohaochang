// Real image decoding/canvas and the same photo containers as /play and /tv.
// All image responses are generated fixtures on an isolated localhost server.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{ArtistArtwork}from'/src/artist-artwork.jsx';
import'/src/style.css';import'/src/artist-library.css';import'/src/playback/tv-experience.css';
const h=React.createElement;
function App(){const[version,setVersion]=useState('bars');window.selectPhoto=setVersion;return h('div',{style:{padding:24,display:'flex',gap:24}},
['play','tv'].map(mode=>h('section',{key:mode,className:mode==='tv'?'tv artist-grid':'artist-grid',style:{width:240,display:'block'}},
h('h2',null,mode),h('button',{className:'artist-card artist-photo-card',style:{width:'100%'}},
h('span',{className:'artist-card-photo'},h(ArtistArtwork,{profile:{id:'fixture',artist:'图片测试',hasPhoto:true,photoVersion:version},token:'fixture'})),
h('span',{className:'artist-card-caption'},h('strong',null,'图片测试'))))))};
createRoot(document.getElementById('root')).render(h(App));
</script></body></html>`;
const server = await createServer({
  configFile: false,
  plugins: [
    react(),
    {
      name: "artwork-fixture",
      configureServer(server) {
        server.middlewares.use("/photo-fixture", async (_req, res, next) => {
          try {
            res.setHeader("Content-Type", "text/html");
            res.end(await server.transformIndexHtml("/photo-fixture", html));
          } catch (error) {
            next(error);
          }
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 0, watch: null },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL && process.env.BROWSER_CHANNEL !== "chromium"
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const pictures = await page.evaluate(() => {
    const result = {};
    for (const kind of ["bars", "plain", "dark", "portrait"]) {
      const canvas = document.createElement("canvas");
      canvas.width = kind === "portrait" ? 200 : 640;
      canvas.height = kind === "portrait" ? 2000 : 360;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = kind === "plain" ? "#51a4ba" : "#080808";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (kind === "bars" || kind === "portrait") {
        ctx.fillStyle = "#c26451";
        ctx.fillRect(0, canvas.height * 0.2, canvas.width, canvas.height * 0.6);
      }
      result[kind] = canvas.toDataURL("image/png").split(",")[1];
    }
    return result;
  });
  await page.route("**/api/artist-photo/**", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("v");
    return route.fulfill({
      contentType: "image/png",
      body: Buffer.from(pictures[kind], "base64"),
    });
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/photo-fixture`,
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".artist-card-photo img")].length === 2 &&
      [...document.querySelectorAll(".artist-card-photo img")].every(
        (img) => img.src.startsWith("data:") && img.complete,
      ),
  );
  const images = page.locator(".artist-card-photo img");
  for (const img of await images.all()) {
    const size = await img.evaluate((img) => ({
      width: img.naturalWidth,
      height: img.naturalHeight,
      fit: getComputedStyle(img).objectFit,
      frame: img.getBoundingClientRect().height,
      parent: img.parentElement.getBoundingClientRect().height,
    }));
    assert.equal(size.width, 640);
    assert.ok(Math.abs(size.height - 216) <= 6);
    assert.equal(size.fit, "cover");
    assert.ok(size.frame > 200);
    assert.ok(Math.abs(size.frame - size.parent) < 2);
  }
  await mkdir("test-results/artwork", { recursive: true });
  await page.screenshot({
    path: "test-results/artwork/cropped-play-tv.png",
    fullPage: true,
  });
  for (const kind of ["plain", "dark"]) {
    await page.evaluate((kind) => window.selectPhoto(kind), kind);
    await page.waitForFunction(
      (kind) =>
        [...document.querySelectorAll(".artist-card-photo img")].every(
          (img) => img.src.includes("v=" + kind) && img.complete,
        ),
      kind,
    );
    assert.equal(
      await images.first().evaluate((img) => img.naturalHeight),
      360,
    );
  }
  await page.evaluate(() => window.selectPhoto("portrait"));
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".artist-card-photo img")].every(
      (img) => img.src.startsWith("data:") && img.complete,
    ),
  );
  assert.ok(
    await images
      .first()
      .evaluate((img) => Math.max(img.naturalWidth, img.naturalHeight) <= 1200),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Artist artwork passed: real decoding, black-bar crop, /play and /tv fill, original dark/uncropped images, photo revision refresh, bounded portrait output.",
  );
} finally {
  await browser.close();
  await server.close();
}
