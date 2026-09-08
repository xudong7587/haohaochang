import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { run } from "../server/process.js";
import { createMediaDownloader } from "../server/sources.js";
import { probe } from "../server/media-utils.js";
process.env.FFPROBE = ffprobe.path;
test("downloads serialize a URL, preserve audio while adding video, and retry invalid staged content", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-download-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "downloads");
  await mkdir(dir);
  const audio = path.join(root, "audio.m4a"),
    video = path.join(root, "video.mp4");
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=1",
    "-c:a",
    "aac",
    audio,
  ]);
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=s=128x72:r=5:d=1",
    "-i",
    audio,
    "-c:v",
    "libx264",
    "-c:a",
    "copy",
    "-shortest",
    video,
  ]);
  const url = "https://www.youtube.com/watch?v=abcdef12345",
    id = createHash("sha256").update(url).digest("hex").slice(0, 24);
  let calls = 0,
    active = 0,
    maxActive = 0,
    invalid = true;
  const stages = [];
  const transport = (source, extension) => async (_url, staging) => {
    calls++;
    active++;
    maxActive = Math.max(maxActive, active);
    stages.push(staging);
    try {
      const file = path.join(staging, id + extension);
      if (extension === ".mp4" && invalid) await writeFile(file, "not media");
      else await copyFile(source, file);
      return { id, file };
    } finally {
      active--;
    }
  };
  const download = createMediaDownloader({
    audio: transport(audio, ".m4a"),
    video: transport(video, ".mp4"),
  });
  const [first, second] = await Promise.all([
    download(url, dir, undefined, true),
    download(url, dir, undefined, true),
  ]);
  assert.equal(first.file, second.file);
  assert.equal(calls, 1);
  assert.equal(maxActive, 1);
  const original = await readFile(first.file);
  await assert.rejects(download(url, dir, undefined, false));
  assert.deepEqual(await readFile(first.file), original);
  assert.deepEqual(await readdir(dir), [id + ".m4a"]);
  invalid = false;
  const mv = await download(url, dir, undefined, false);
  assert.equal((await probe(mv.file)).hasVideo, true);
  assert.deepEqual(await readFile(first.file), original);
  assert.equal(calls, 3);
  assert.equal(new Set(stages).size, 3);
  await download(url, dir, undefined, false);
  assert.equal(calls, 3);
  await writeFile(mv.file, "damaged cache");
  await download(url, dir, undefined, false);
  assert.equal(calls, 4);
  assert.equal((await probe(mv.file)).hasVideo, true);
  assert.equal(
    (await readdir(dir)).some((name) => name.startsWith(".ktv-download-")),
    false,
  );
});
