import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  stat,
  copyFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { openStore } from "../server/db.js";
import { prepareSong } from "../server/media.js";
import { run } from "../server/process.js";
import { cleanImportedDownloads } from "../server/download-cleanup.js";
process.env.FFMPEG = ffmpeg;
process.env.FFPROBE = ffprobe.path;
test("download cleanup requires a complete package and unchanged unreferenced source", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-clean-download-"));
  const downloads = path.join(root, "download"),
    cache = path.join(root, "cache"),
    source = path.join(root, "retained.mp4");
  await mkdir(downloads);
  await mkdir(cache);
  const store = openStore(path.join(root, "db"));
  t.after(async () => {
    store.db.close();
    await rm(root, { recursive: true, force: true });
  });
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=s=160x90:r=5:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=1",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-ac",
    "2",
    source,
  ]);
  store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,mode,backing,vocal,created) VALUES('song',?,'Song','Artist','channels',1,0,0)",
    )
    .run(source);
  const files = {};
  for (const name of ["good", "changed", "shared", "failed", "outside"]) {
    const file = path.join(
      name === "outside" ? root : downloads,
      name + ".mp4",
    );
    await copyFile(source, file);
    const info = await stat(file);
    files[name] = file;
    store.db
      .prepare(
        "INSERT INTO jobs(id,kind,payload,status,created) VALUES(?,'import',?,?,0)",
      )
      .run(
        name,
        JSON.stringify({
          id: "song",
          file,
          signature: info.size + ":" + info.mtimeMs,
        }),
        name === "failed" ? "failed" : "done",
      );
  }
  assert.equal((await cleanImportedDownloads(store, downloads)).removed, 0);
  await prepareSong(store, "song", [root], cache);
  await writeFile(files.changed, "replacement input");
  store.db
    .prepare(
      "INSERT INTO jobs(id,kind,payload,status,created) VALUES('using','download',?,'running',0)",
    )
    .run(JSON.stringify({ file: files.shared }));
  assert.equal((await cleanImportedDownloads(store, downloads)).removed, 1);
  await assert.rejects(access(files.good));
  for (const name of ["changed", "shared", "failed", "outside"])
    await access(files[name]);
  await access(source);
  assert.equal((await cleanImportedDownloads(store, downloads)).removed, 0);
});
