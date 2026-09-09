import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { openStore } from "../server/db.js";
import { run } from "../server/process.js";
import { prepareSong } from "../server/media.js";
import { saveSongMetadata } from "../server/song-metadata.js";
import { stageResources } from "../server/resource-publication.js";
import { cleanSongVersions } from "../server/resource-cleanup.js";
import { resourceManifest } from "../server/resource-manifest.js";

process.env.FFMPEG = ffmpeg;
process.env.FFPROBE = ffprobe.path;
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-storage-"));
  const cache = path.join(root, "media"),
    source = path.join(root, "source.wav");
  await mkdir(cache);
  const store = openStore(path.join(root, "data"));
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
    "sine=frequency=440:duration=1",
    source,
  ]);
  store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,created,needs_video) VALUES('song',?,'Song','Artist',?,1)",
    )
    .run(source, Date.now());
  const song = () =>
    store.db.prepare("SELECT * FROM songs WHERE id='song'").get();
  const dir = () => store.get("package:song");
  await prepareSong(store, "song", [root], cache);
  async function edit(lyrics) {
    await saveSongMetadata(
      store,
      "song",
      { lyrics, expectedRevision: song().metadataRevision },
      cache,
    );
    return dir();
  }
  const clean = (options = {}) =>
    cleanSongVersions(store, "song", cache, {
      now: Date.now() + 3600000,
      ...options,
    });
  return { root, cache, source, store, song, dir, edit, clean };
}

test("metadata revisions share immutable audio; lyrics and failed writes remain isolated", async (t) => {
  const f = await fixture(t),
    before = f.dir();
  const changed = await f.edit("[00:00.00]new words");
  const a = await stat(path.join(before, "原唱.m4a")),
    b = await stat(path.join(changed, "原唱.m4a"));
  assert.equal(a.ino, b.ino);
  assert.equal(a.dev, b.dev);
  assert.ok(b.nlink >= 2);
  assert.equal(await readFile(path.join(before, "歌词.lrc"), "utf8"), "");
  assert.equal(
    await readFile(path.join(changed, "歌词.lrc"), "utf8"),
    "[00:00.00]new words",
  );
  const stage = await stageResources(f.store, f.song(), f.cache);
  await writeFile(
    path.join(stage.directory, "replacement.tmp"),
    "different audio",
  );
  const { rename } = await import("node:fs/promises");
  await rename(
    path.join(stage.directory, "replacement.tmp"),
    path.join(stage.directory, "原唱.m4a"),
  );
  await stage.abandon();
  assert.equal((await stat(path.join(changed, "原唱.m4a"))).size, b.size);
  assert.equal(resourceManifest(f.store, f.song(), f.cache).vocal, true);
  const result = await f.clean();
  assert.equal(result.removed, 1);
  assert.equal(await readFile(f.source).then((b) => b.length > 0), true);
  assert.equal(resourceManifest(f.store, f.song(), f.cache).vocal, true);
  assert.equal((await stat(path.join(changed, "原唱.m4a"))).nlink, 1);
  assert.equal(f.store.get("package-version:song:1"), undefined);
});

test("cleanup protects grace period, playback, resumable jobs, current media and source references", async (t) => {
  const f = await fixture(t),
    first = f.dir();
  await f.edit("[00:00.00]new");
  assert.equal((await f.clean({ now: Date.now() })).removed, 0);
  f.store.db
    .prepare(
      "INSERT INTO queue(id,song_id,name,position) VALUES('q','song','listener',0)",
    )
    .run();
  assert.equal((await f.clean()).removed, 0);
  f.store.db.prepare("DELETE FROM queue").run();
  for (const status of ["queued", "running", "waiting-worker", "review"]) {
    f.store.db
      .prepare(
        "INSERT OR REPLACE INTO jobs(id,kind,payload,status,created) VALUES('j','prepare',?, ?,0)",
      )
      .run(JSON.stringify({ id: "song" }), status);
    assert.equal((await f.clean()).removed, 0, status);
  }
  f.store.db.prepare("DELETE FROM jobs").run();
  f.store.set("video-source:song", { path: path.join(first, "来源.mp4") });
  assert.equal((await f.clean()).removed, 0);
  f.store.set("video-source:song", null);
  f.store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,created) VALUES('other',?,'Other','Artist',0)",
    )
    .run(path.join(first, "原唱.m4a"));
  assert.equal((await f.clean()).removed, 0);
  f.store.db.prepare("DELETE FROM songs WHERE id='other'").run();
  const current = path.join(f.dir(), "原唱.m4a"),
    content = await readFile(current);
  await writeFile(current, "corrupt");
  assert.equal((await f.clean()).removed, 0);
  // Leave the deliberately damaged fixture for teardown; old files must survive.
  assert.ok((await readdir(first)).includes("原唱.m4a"));
  assert.ok(content.length > 0);
});

test("cleanup removes old orphan staging but rejects unknown files and linked directories", async (t) => {
  const f = await fixture(t),
    versions = path.dirname(f.dir());
  const orphan = path.join(versions, randomUUID()),
    unknown = path.join(versions, randomUUID());
  await mkdir(orphan);
  await mkdir(unknown);
  await writeFile(path.join(orphan, "画面.mp4"), "abandoned output");
  await writeFile(path.join(unknown, "my-notes.txt"), "keep me");
  const outside = path.join(f.root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "画面.mp4"), "unrelated");
  await symlink(
    outside,
    path.join(versions, randomUUID()),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal((await f.clean({ dryRun: true })).removed, 1);
  assert.equal((await f.clean()).removed, 1);
  assert.equal(
    await readFile(path.join(unknown, "my-notes.txt"), "utf8"),
    "keep me",
  );
  assert.equal(
    await readFile(path.join(outside, "画面.mp4"), "utf8"),
    "unrelated",
  );
});

test("v1 generated caches expire only after v2 is usable and never remove a recorded source or ambient playback", async (t) => {
  const f = await fixture(t),
    legacyCache = path.join(f.root, "legacy");
  await mkdir(legacyCache);
  const retained = path.join(f.cache, "song-vocal.mp4");
  await writeFile(retained, "recorded source");
  await writeFile(path.join(f.cache, "song-backing.mp4"), "obsolete v1 output");
  await writeFile(
    path.join(legacyCache, "song-vocal.mp4"),
    "obsolete copied cache",
  );
  await writeFile(path.join(legacyCache, "unrelated.mp4"), "unrelated");
  f.store.db.prepare("UPDATE songs SET path=? WHERE id='song'").run(retained);
  assert.equal(
    (await f.clean({ legacyCache, isPlaying: () => true })).bytes,
    0,
  );
  const result = await f.clean({ legacyCache });
  assert.equal(result.legacyFiles, 2);
  assert.equal(await readFile(retained, "utf8"), "recorded source");
  assert.equal(
    await readFile(path.join(legacyCache, "unrelated.mp4"), "utf8"),
    "unrelated",
  );
  assert.equal(resourceManifest(f.store, f.song(), f.cache).vocal, true);
});
