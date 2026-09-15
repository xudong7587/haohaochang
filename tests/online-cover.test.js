import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import { onlineCoverApi, onlineCoverPath } from "../server/online-cover.js";
import { searchSongs } from "../server/online-search.js";
import { downloadPoster } from "../server/poster-source.js";

test("online results keep remote metadata and provide a NAS thumbnail path", async () => {
  const result = await searchSongs("测试", "", "", 1, {
    search: async () => [
      {
        url: "https://www.bilibili.com/video/BVtest",
        cover: "//i0.hdslb.com/bfs/archive/test.jpg",
        duration: 200,
      },
      {
        url: "https://www.bilibili.com/video/BVtest2",
        cover: "http://127.0.0.1/private",
      },
      { url: "https://www.bilibili.com/video/BVtest3" },
    ],
  });
  assert.equal(result.results[0].cover, "//i0.hdslb.com/bfs/archive/test.jpg");
  assert.equal(
    result.results[0].coverPath,
    onlineCoverPath("https://i0.hdslb.com/bfs/archive/test.jpg"),
  );
  assert.equal(result.results[1].coverPath, "");
  assert.equal(result.results[2].coverPath, "");
});

test("thumbnail API authenticates, caches and coalesces image reads; failed loads can retry", async (t) => {
  const png = await readFile("public/favicon.png");
  let requests = 0,
    failNext = false;
  let active = 0,
    peak = 0;
  const app = express();
  onlineCoverApi({
    app,
    member(req, res, next) {
      if (req.get("authorization") === "Bearer fixture") next();
      else res.sendStatus(401);
    },
    download: (url) =>
      downloadPoster(url, {
        fetcher: async (target, options) => {
          requests++;
          assert.equal(options.headers.Referer, "https://www.bilibili.com/");
          assert.equal(options.headers.Authorization, undefined);
          if (failNext) {
            failNext = false;
            return new Response("unavailable", { status: 503 });
          }
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 15));
          active--;
          return new Response(png, {
            headers: { "content-type": "image/png" },
          });
        },
      }),
  });
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = onlineCoverPath("https://i0.hdslb.com/bfs/archive/test.png");
  const headers = { authorization: "Bearer fixture" };
  assert.equal((await fetch(base + path)).status, 401);
  assert.equal(requests, 0);
  const responses = await Promise.all(
    Array.from({ length: 3 }, () => fetch(base + path, { headers })),
  );
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /image\/png/);
    assert.match(response.headers.get("cache-control"), /private/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  }
  assert.equal(requests, 1);
  await fetch(base + path, { headers });
  assert.equal(requests, 1);
  for (const url of [
    "https://127.0.0.1/a",
    "https://i0.hdslb.com.evil.test/a",
    "https://u:p@i0.hdslb.com/a",
  ]) {
    assert.equal(
      (
        await fetch(base + "/api/online/cover?url=" + encodeURIComponent(url), {
          headers,
        })
      ).status,
      400,
    );
  }
  assert.equal(requests, 1);
  failNext = true;
  const retry = onlineCoverPath("https://i0.hdslb.com/bfs/archive/retry.png");
  assert.equal((await fetch(base + retry, { headers })).status, 502);
  assert.equal((await fetch(base + retry, { headers })).status, 200);
  assert.equal(requests, 3);
  const burst = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      fetch(base + onlineCoverPath(`https://i0.hdslb.com/burst-${i}.png`), {
        headers,
      }),
    ),
  );
  assert.ok(
    burst.every((response) => response.status === 200),
    "a page of thumbnails queues instead of losing images",
  );
  assert.ok(peak <= 8, "upstream downloads have a bounded concurrency");
});
