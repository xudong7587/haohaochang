import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const source = await readFile("src/playback/native-controller.js", "utf8");
const server = createServer((req, res) => {
  if (req.url === "/native.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(source);
  }
  res.end(
    '<!doctype html><div class="tv-player"><div class="video-stage" style="width:640px;height:360px"><video></video></div></div>',
  );
});
server.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    window.commands = [];
    window.finishes = 0;
    window.status = [];
    window.HaohaochangPlayer = {
      version: 1,
      postMessage: (v) => commands.push(v),
    };
    const { createNativeController } = await import("/native.js");
    window.make = () =>
      createNativeController({
        video: document.querySelector("video"),
        manifest: {
          version: 2,
          resources: {
            video: { url: "/api/assets/song/video", duration: 90 },
            vocal: { url: "/api/assets/song/vocal", duration: 60 },
            backing: { url: "/api/assets/song/backing", duration: 60 },
          },
        },
        onEnded: () => finishes++,
        onStatus: (v) => status.push(v),
      });
    window.controller = make();
    window.report = (
      value,
      session = commands.find((x) => x.action === "load").session,
    ) =>
      dispatchEvent(
        new CustomEvent("haohaochang-native-state", {
          detail: { session, ...value },
        }),
      );
  });
  assert.equal(
    await page.locator("video").getAttribute("data-engine"),
    "native",
  );
  assert.equal(await page.locator("video").getAttribute("src"), null);
  assert.equal(
    await page.evaluate(
      () => document.querySelector("video")._audioTracks.length,
    ),
    0,
  );
  const bounds = await page.evaluate(() =>
    commands.find((x) => x.action === "bounds"),
  );
  assert.equal(bounds.width, 640);
  assert.equal(bounds.height, 360);
  await page.evaluate(() => {
    controller.setState({ lease: true, paused: false, variant: "vocal" });
    report({
      positionMs: 12345,
      playing: true,
      variant: "vocal",
      decoder: "test-decoder",
      width: 3840,
      height: 2160,
      fps: 60,
    });
  });
  assert.ok(
    await page.evaluate(
      () => controller.getTime() >= 12.345 && controller.getTime() < 12.75,
    ),
  );
  await page.waitForTimeout(650);
  assert.ok(
    await page.evaluate(() => controller.getTime() <= 12.746),
    "clock stops extrapolating after a missing native report",
  );
  assert.equal(
    await page.evaluate(
      () => commands.filter((x) => x.action === "seek").length,
    ),
    0,
    "state reports never seek to sync",
  );
  await page.evaluate(() => {
    controller.seek(8.25);
    controller.setState({ lease: false });
    report({ ended: true });
  });
  assert.equal(
    await page.evaluate(() => finishes),
    0,
    "revoked player cannot advance queue",
  );
  assert.equal(
    await page.evaluate(
      () => commands.find((x) => x.action === "seek").positionMs,
    ),
    8250,
  );
  await page.evaluate(() => {
    controller.setState({ lease: true });
    report({ ended: true });
    report({ ended: true });
  });
  assert.equal(await page.evaluate(() => finishes), 1);
  await page.evaluate(() => {
    report({ positionMs: 80000 }, "old-session");
  });
  assert.ok(
    await page.evaluate(() => controller.getTime() < 1),
    "stale events cannot change the clock",
  );
  await page
    .locator(".video-stage")
    .evaluate((el) => (el.style.width = "800px"));
  await page.waitForFunction(
    () => commands.filter((x) => x.action === "bounds").at(-1).width === 800,
  );
  await page.evaluate(() =>
    report({ pictureError: true, warning: "failed picture" }),
  );
  assert.equal(await page.locator("html.has-native-picture").count(), 0);
  await page.evaluate(() => controller.destroy());
  assert.equal(await page.locator("video").getAttribute("data-engine"), null);
  assert.equal(await page.evaluate(() => commands.at(-1).action), "stop");
  await page.close();
  console.log(
    "Native bridge: isolated media, shared clock, stale session, lease, one-shot end, bounds and cleanup passed",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
