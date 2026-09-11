import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, copyFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { run } from "../server/process.js";
import { libraryVideoInfo } from "../server/library-video-info.js";

test("library reads old package and legacy video dimensions without rewriting media and caches by revision", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-video-label-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousProbe = process.env.FFPROBE;
  process.env.FFPROBE = ffprobe.path;
  t.after(() => {
    if (previousProbe === undefined) delete process.env.FFPROBE;
    else process.env.FFPROBE = previousProbe;
  });
  const values = new Map([["package:a", root]]);
  const store = {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  };
  const video = path.join(root, "画面.mp4");
  const make = (file, size) =>
    run(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=black:s=${size}:r=1`,
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      file,
    ]);
  await make(video, "640x480");
  const manifest = { version: 2, resources: { video: { available: true } } };
  assert.deepEqual(await libraryVideoInfo(store, { id: "a" }, manifest, root), {
    available: true,
    width: 640,
    height: 480,
  });
  process.env.FFPROBE = path.join(root, "missing-ffprobe");
  assert.equal(
    (await libraryVideoInfo(store, { id: "a" }, manifest, root)).height,
    480,
  );
  process.env.FFPROBE = ffprobe.path;
  await make(video, "1280x720");
  assert.equal(
    (await libraryVideoInfo(store, { id: "a" }, manifest, root)).height,
    720,
  );
  await copyFile(video, path.join(root, "legacy-vocal.mp4"));
  assert.equal(
    (
      await libraryVideoInfo(
        store,
        { id: "legacy" },
        { version: 1, resources: { video: { available: true } } },
        root,
      )
    ).height,
    720,
  );
  assert.equal(
    (
      await libraryVideoInfo(
        store,
        { id: "raw", path: video },
        { version: 1, resources: { video: { available: false } } },
        root,
      )
    ).height,
    720,
  );
  assert.deepEqual(
    await libraryVideoInfo(
      store,
      { id: "audio" },
      { version: 2, resources: { video: { available: false } } },
      root,
    ),
    { available: false },
  );
  assert.equal(values.get("package-health:a"), undefined);
});
