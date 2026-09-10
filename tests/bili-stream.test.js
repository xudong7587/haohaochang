import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { biliStreamUrl, biliStreamCandidates } from "../server/bili-stream.js";
import { downloadStream } from "../server/bili-download.js";
import { resolvePreview } from "../server/online-preview.js";
import { bilibiliProvider } from "../server/providers/bilibili.js";

test("Bili media URLs support designated CDN ports and prefer normal backup CDNs", () => {
  const pcdn = "https://xy1.mcdn.bilivideo.cn:4483/video";
  const backup = "https://upos-sz-mirrorcos.bilivideo.com/video";
  assert.equal(biliStreamUrl(pcdn), pcdn);
  assert.equal(
    biliStreamUrl("https://node.v1d.szbdyd.com:4483/video"),
    "https://node.v1d.szbdyd.com:4483/video",
  );
  assert.deepEqual(biliStreamCandidates(pcdn, [backup, backup]), [
    backup,
    pcdn,
  ]);
  assert.deepEqual(
    biliStreamCandidates("https://unrelated.invalid/video", [backup]),
    [backup],
  );
  for (const url of [
    "http://test.bilivideo.com/video",
    "https://test.bilivideo.com:22/video",
    "https://bilivideo.com.attacker.test/video",
    "https://127.0.0.1/video",
    "https://user:password@test.bilivideo.com/video",
    "https://anything.szbdyd.com/video",
  ])
    assert.throws(() => biliStreamUrl(url));
});

test("Bili downloads retry incomplete transfers and handle validated CDN redirects", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-bili-lines-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, "video.mp4"),
    calls = [];
  const root = "https://test.bilivideo.com";
  await downloadStream(root + "/partial", target, 100, {
    backups: [root + "/redirect"],
    fetcher: async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.Cookie, undefined);
      if (url.endsWith("partial"))
        return new Response("bad", { headers: { "content-length": "20" } });
      if (url.endsWith("redirect"))
        return new Response(null, {
          status: 302,
          headers: { location: "https://backup.bilivideo.cn:4483/complete" },
        });
      return new Response("complete", { headers: { "content-length": "8" } });
    },
  });
  assert.equal(await readFile(target, "utf8"), "complete");
  assert.equal(calls.length, 3);
  assert.deepEqual(await readdir(dir), ["video.mp4"]);
});

test("unsafe redirects, HTTP errors and partial ranges cannot overwrite an existing download", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-bili-invalid-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, "audio.m4a"),
    calls = [];
  await writeFile(target, "previous audio");
  const root = "https://test.bilivideo.com";
  await assert.rejects(
    downloadStream(root + "/redirect", target, 100, {
      backups: [root + "/denied", root + "/range"],
      fetcher: async (url) => {
        calls.push(url);
        if (url.endsWith("redirect"))
          return new Response(null, {
            status: 302,
            headers: { location: "https://127.0.0.1/private" },
          });
        if (url.endsWith("denied"))
          return new Response("denied", { status: 403 });
        return new Response("partial", {
          status: 206,
          headers: { "content-range": "bytes 0-6/100", "content-length": "7" },
        });
      },
    }),
    /线路均未成功/,
  );
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every((url) => new URL(url).hostname === "test.bilivideo.com"),
  );
  assert.equal(await readFile(target, "utf8"), "previous audio");
  assert.deepEqual(await readdir(dir), ["audio.m4a"]);
});

test("preview resolves valid backup URLs when the primary URL cannot be used", async (t) => {
  t.mock.method(bilibiliProvider, "preview", async () => ({
    duration: 120,
    previewHeight: 360,
    downloadHeight: 1080,
    video: "http://unsupported.bilivideo.com/video",
    videoBackups: ["https://video.bilivideo.com/video"],
    audio: "https://node.mcdn.bilivideo.cn:4483/audio",
    audioBackups: ["https://audio.bilivideo.com/audio"],
  }));
  const result = await resolvePreview(
    "https://www.bilibili.com/video/BV1U1ti6xEac",
    "",
    "unused",
  );
  assert.equal(result.video.url, "https://video.bilivideo.com/video");
  assert.equal(result.audio.url, "https://audio.bilivideo.com/audio");
  assert.deepEqual(result.audio.backups, [
    "https://node.mcdn.bilivideo.cn:4483/audio",
  ]);
});
