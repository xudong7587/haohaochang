import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { previewSessions } from "../server/online-preview.js";
test("preview cancellation aborts the upstream quietly while genuine upstream errors still propagate", async (t) => {
  let failed = false,
    cancelled = false,
    finished;
  const complete = new Promise((resolve) => {
    finished = resolve;
  });
  const sessions = previewSessions({
    resolve: async () => ({
      duration: 10,
      video: { url: "https://cdn.bilivideo.com/test", headers: {} },
    }),
    fetcher: async () => {
      if (failed) return new Response("unavailable", { status: 503 });
      let timer;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1024));
            timer = setInterval(
              () => controller.enqueue(new Uint8Array(1024)),
              10,
            );
          },
          cancel() {
            clearInterval(timer);
            cancelled = true;
          },
        }),
      );
    },
  });
  const preview = await sessions.create(
    "https://www.bilibili.com/video/BVfixture",
    "",
    "unused",
  );
  const app = express(),
    errors = [];
  app.get("/:id/:track", async (req, res, next) => {
    try {
      await sessions.stream(req, res);
    } catch (e) {
      next(e);
    } finally {
      finished();
    }
  });
  app.use((error, req, res, next) => {
    errors.push(error.message);
    if (!res.headersSent) res.status(502).end();
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const url = `http://127.0.0.1:${server.address().port}/${preview.id}/video`;
  const abort = new AbortController();
  const response = await fetch(url, { signal: abort.signal });
  await response.body.getReader().read();
  abort.abort();
  await complete;
  assert.equal(cancelled, true);
  assert.deepEqual(errors, []);
  failed = true;
  assert.equal((await fetch(url)).status, 502);
  assert.equal(errors.length, 1);
});
