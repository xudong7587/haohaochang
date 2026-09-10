import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { bilibiliProvider } from "../server/providers/bilibili.js";
import { previewSessions } from "../server/online-preview.js";
test("legacy preview refusal retries WBI and retains backup CDN URLs", async () => {
  const calls = [];
  const fetcher = async (value) => {
    const url = new URL(value);
    calls.push(url);
    if (url.pathname.endsWith("/view"))
      return Response.json({
        code: 0,
        data: { cid: 1, bvid: "BVtest", duration: 20 },
      });
    if (url.pathname.endsWith("/nav"))
      return Response.json({
        code: -101,
        data: {
          wbi_img: {
            img_url: "https://i.test/7cd084941338484aae1ad9425b84077c.png",
            sub_url: "https://i.test/4932caff0ff746eab6f01bf08b70ac45.png",
          },
        },
      });
    if (url.pathname === "/x/player/playurl")
      return Response.json({ code: -352 });
    assert.ok(url.searchParams.has("w_rid"));
    return Response.json({
      code: 0,
      data: {
        dash: {
          video: [
            {
              codecs: "avc1",
              height: 720,
              baseUrl: "https://a.bilivideo.com/v",
              backupUrl: ["https://b.bilivideo.com/v"],
            },
          ],
          audio: [{ codecs: "mp4a", baseUrl: "https://a.bilivideo.com/a" }],
        },
      },
    });
  };
  const result = await bilibiliProvider.preview(
    "https://www.bilibili.com/video/BVtest",
    "",
    fetcher,
  );
  assert.equal(result.previewHeight, 720);
  assert.deepEqual(result.videoBackups, ["https://b.bilivideo.com/v"]);
  assert.equal(calls.length, 4);
});
test("preview proxy retries a failed CDN with the same byte range", async (t) => {
  const calls = [];
  const sessions = previewSessions({
    resolve: async () => ({
      duration: 20,
      video: {
        url: "https://a.bilivideo.com/v",
        backups: ["https://b.bilivideo.com/v"],
        headers: { Referer: "https://www.bilibili.com/" },
      },
    }),
    fetcher: async (url, options) => {
      calls.push({ url, headers: options.headers });
      return url.includes("a.bilivideo")
        ? new Response("blocked", { status: 403 })
        : new Response("test", {
            status: 206,
            headers: { "content-range": "bytes 0-3/20", "content-length": "4" },
          });
    },
  });
  const p = await sessions.create(
    "https://www.bilibili.com/video/BVtest",
    "",
    "unused",
  );
  const app = express();
  app.get("/:id/:track", (req, res) => sessions.stream(req, res));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/${p.id}/video`,
    { headers: { Range: "bytes=0-3" } },
  );
  assert.equal(response.status, 206);
  assert.equal(await response.text(), "test");
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      (c) =>
        c.headers.Range === "bytes=0-3" &&
        c.headers.Referer === "https://www.bilibili.com/",
    ),
  );
});
