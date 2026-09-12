import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import express from "express";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { openStore } from "../server/db.js";
import { createScheduler } from "../server/scheduler.js";
import {
  registerFavoriteBundle,
  finishFavoritePart,
  analyzeFavoriteBundle,
  processFavoritePart,
  favoriteBundlesApi,
  bundleKey,
  resumeFavoriteBundles,
  discoverLocalFavoriteBundles,
} from "../server/favorite-bundles.js";
import { favoriteNfo } from "../server/favorites.js";
import {
  nfoIdentity,
  stageLocalFile,
  intakeKey,
} from "../server/local-intake.js";
import { importMedia } from "../server/library.js";
import { prepareSong } from "../server/media.js";
import { run } from "../server/process.js";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-bundle-"));
  const downloads = path.join(root, "downloads"),
    cache = path.join(root, "media");
  await mkdir(downloads);
  await mkdir(cache);
  const store = openStore(path.join(root, "data"));
  const f = {
    root,
    downloads,
    cache,
    roots: [cache],
    store,
    ...store,
    emit() {},
    localMetadataSearch: async () => [],
    albumPosterFind: async () => null,
  };
  const scheduler = createScheduler(f, { enabled: false });
  f.addJob = scheduler.addJob;
  f.set("favorites", { favoriteId: "123" });
  t.after(async () => {
    await scheduler.stop();
    store.db.close();
    await rm(root, { recursive: true, force: true });
  });
  f.jobs = (kind) =>
    f.db
      .prepare("SELECT * FROM jobs WHERE kind=?")
      .all(kind)
      .map((j) => ({ ...j, p: JSON.parse(j.payload) }));
  f.parts = (titles) =>
    titles.map((title, i) => ({
      bvid: "BV1234567890",
      cid: String(100 + i),
      page: i + 1,
      pageCount: titles.length,
      title,
      collectionTitle: "经典歌曲MV合集~值得收藏",
      url: "https://www.bilibili.com/video/BV1234567890?p=" + (i + 1),
    }));
  f.deliver = async (group, index, contents = "part " + index) => {
    const part = group.parts[index],
      file = path.join(downloads, group.id + "-" + index + ".mp4");
    await writeFile(file, contents);
    await writeFile(file.replace(".mp4", ".nfo"), favoriteNfo(part));
    await finishFavoritePart(part, file, f);
    f.db
      .prepare("UPDATE jobs SET status='done' WHERE id=?")
      .run(part.downloadJob);
    return file;
  };
  return f;
}
async function api(t, f) {
  const app = express();
  app.use(express.json());
  favoriteBundlesApi({ app, admin: (_req, _res, next) => next(), ...f });
  app.use((err, _req, res, _next) =>
    res.status(400).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  return async (url, body) =>
    fetch(
      `http://127.0.0.1:${server.address().port}/api/admin/favorite-bundles${url}`,
      {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
}
test("known single NFO emits one import; unknown single needs singer and title confirmation", async (t) => {
  assert.equal(nfoIdentity("<title>梁咏琪-短发</title>", "x").artist, "梁咏琪");
  const f = await fixture(t),
    group = await registerFavoriteBundle(f.parts(["梁咏琪-短发"]), f);
  await f.deliver(group, 0);
  await analyzeFavoriteBundle({}, { bundleId: group.id }, f);
  const job = f.jobs("favorite-process")[0];
  await processFavoritePart(job, job.p, f);
  assert.equal(f.jobs("import")[0].p.metadata.title, "短发");
  assert.equal(f.jobs("import")[0].p.metadata.artist, "梁咏琪");
  assert.equal(f.jobs("import")[0].p.approved, true);
  const call = await api(t, f);
  assert.deepEqual(await (await call("")).json(), []);
  const g2 = await registerFavoriteBundle(
    f.parts(["无名录音"]).map((p) => ({
      ...p,
      bvid: "BVunknown",
      cid: "200",
      url: "https://www.bilibili.com/video/BVunknown",
    })),
    f,
  );
  await f.deliver(g2, 0, "unknown recording");
  await analyzeFavoriteBundle({}, { bundleId: g2.id }, f);
  assert.equal(f.get(bundleKey(g2.id)).status, "review");
  assert.equal((await call(`/${g2.id}/confirm`, { artist: "" })).status, 400);
  assert.equal(
    (await call(`/${g2.id}/confirm`, { artist: "真实歌手", title: "真实歌名" }))
      .status,
    200,
  );
  await analyzeFavoriteBundle({}, { bundleId: g2.id }, f);
  const p = f.get(bundleKey(g2.id)).parts[0];
  assert.equal(p.metadata.title, "真实歌名");
  assert.equal(p.metadata.artist, "真实歌手");
});
test("multi-P waits for all downloads, asks once, retains known singers, and deduplicates retries", async (t) => {
  const f = await fixture(t),
    group = await registerFavoriteBundle(
      f.parts(["第一首", "歌手乙-第二首", "第三首"]),
      f,
    );
  const call = await api(t, f);
  await f.deliver(group, 0);
  assert.equal(f.jobs("favorite-analyze").length, 0);
  assert.equal(
    (await call(`/${group.id}/confirm`, { artist: "歌手甲" })).status,
    400,
  );
  await Promise.all([f.deliver(group, 1), f.deliver(group, 2)]);
  assert.equal(f.jobs("favorite-analyze").length, 1);
  await analyzeFavoriteBundle({}, { bundleId: group.id }, f);
  const review = await (await call("")).json();
  assert.equal(review.length, 1);
  assert.equal(review[0].total, 3);
  assert.equal(f.jobs("favorite-process").length, 0);
  assert.equal(
    (await call(`/${group.id}/confirm`, { artist: "歌手甲" })).status,
    200,
  );
  await analyzeFavoriteBundle({}, { bundleId: group.id }, f);
  assert.deepEqual(
    f.jobs("favorite-process").map((j) => j.p.artist),
    ["歌手甲", "歌手乙", "歌手甲"],
  );
  assert.deepEqual(
    f.jobs("favorite-process").map((j) => j.p.title),
    ["第一首", "第二首", "第三首"],
  );
  await analyzeFavoriteBundle({}, { bundleId: group.id }, f);
  await registerFavoriteBundle(
    f.parts(["第一首", "歌手乙-第二首", "第三首"]),
    f,
  );
  assert.equal(f.jobs("favorite-process").length, 3);
  for (const job of f.jobs("favorite-process"))
    await processFavoritePart(job, job.p, f);
  assert.equal(f.jobs("import").length, 3);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM songs").get().n, 0);
  assert.ok(f.jobs("import").every((j) => j.p.metadata.title !== group.title));
});
test("identified multi-P produces separate standard songs with distinct names and content", async (t) => {
  process.env.FFMPEG = ffmpeg;
  process.env.FFPROBE = ffprobe.path;
  const f = await fixture(t),
    group = await registerFavoriteBundle(
      f.parts(["歌手甲-第一首", "歌手甲-第二首"]),
      f,
    );
  for (let index = 0; index < 2; index++) {
    const file = path.join(f.downloads, "real-" + index + ".mp4");
    await run(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=64x64:d=0.5",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${440 + index * 110}:duration=0.5`,
      "-ac",
      "2",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-shortest",
      file,
    ]);
    await writeFile(
      file.replace(".mp4", ".nfo"),
      favoriteNfo(group.parts[index]),
    );
    if (index === 0) {
      const oldId = await importMedia(f.store, file, f.downloads, f.cache, {
        title: group.title,
        artist: "歌手甲",
        mode: "channels",
        vocal: 0,
        backing: 1,
      });
      await prepareSong(f.store, oldId, [f.root], f.cache);
      f.set("lyrics-offset:" + oldId, 90500);
      group.parts[0].candidateSongId = oldId;
      f.set(bundleKey(group.id), group);
    }
    await finishFavoritePart(group.parts[index], file, f);
    f.db
      .prepare("UPDATE jobs SET status='done' WHERE id=?")
      .run(group.parts[index].downloadJob);
  }
  await analyzeFavoriteBundle({}, { bundleId: group.id }, f);
  for (const job of f.jobs("favorite-process"))
    await processFavoritePart(job, job.p, f);
  for (const job of f.jobs("import")) {
    const id = await importMedia(f.store, job.p.file, f.downloads, f.cache, {
      ...job.p.metadata,
      mode: "channels",
      vocal: 0,
      backing: 1,
    });
    await prepareSong(f.store, id, [f.root], f.cache);
  }
  assert.equal(f.get("lyrics-offset:" + group.parts[0].candidateSongId), 90500);
  const songs = f.db.prepare("SELECT title,status FROM songs").all();
  assert.deepEqual(
    songs.map((s) => s.title).sort(),
    ["第一首", "第二首"].sort(),
  );
  assert.ok(songs.every((s) => s.status === "ready"));
});
test("legacy P1 needs content verification; cancelled missing downloads retry explicitly", async (t) => {
  const f = await fixture(t),
    parts = f.parts(["歌手甲-第一首", "第二首"]);
  f.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,created) VALUES('old','/isolated/old.mp4',?,'歌手甲',0)",
    )
    .run(parts[0].collectionTitle);
  const old = f.addJob("import", {
    id: "old",
    title: parts[0].collectionTitle,
    sourceUrl: "https://www.bilibili.com/video/BV1234567890",
  });
  f.db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(old);
  const group = await registerFavoriteBundle(parts, f);
  assert.equal(group.parts[0].candidateSongId, "old");
  assert.equal(group.parts[0].legacySongId, undefined);
  assert.equal(f.jobs("favorite-download").length, 2);
  const missing = group.parts[1].downloadJob;
  f.db.prepare("DELETE FROM jobs WHERE id=?").run(missing);
  const call = await api(t, f);
  assert.equal((await call(`/${group.id}/retry`, {})).status, 200);
  assert.notEqual(f.get(bundleKey(group.id)).parts[1].downloadJob, missing);
});

test("external bili-sync folder waits for all stable files and groups them before intake", async (t) => {
  const f = await fixture(t),
    folder = path.join(f.downloads, "唱片", "Season 1");
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, "..", "tvshow.nfo"),
    "<tvshow><title>唱片</title></tvshow>",
  );
  const files = ["一", "二"].map((title, i) =>
    path.join(folder, `${title} - S01E0${i + 1}.mp4`),
  );
  for (const [index, file] of files.entries()) {
    await writeFile(file, "recording " + index);
    await writeFile(
      file.replace(".mp4", ".nfo"),
      `<episodedetails><title>歌曲${index}</title></episodedetails>`,
    );
  }
  assert.equal(
    (await discoverLocalFavoriteBundles(files, new Set([files[0]]), f)).size,
    2,
  );
  assert.equal(f.jobs("favorite-analyze").length, 0);
  const partial = path.join(folder, "third.mp4.part");
  await writeFile(partial, "partial");
  await discoverLocalFavoriteBundles(files, new Set(files), f);
  assert.equal(f.jobs("favorite-analyze").length, 0);
  await rm(partial);
  await discoverLocalFavoriteBundles(files, new Set(files), f);
  assert.equal(f.jobs("favorite-analyze").length, 1);
  const job = f.jobs("favorite-analyze")[0];
  await analyzeFavoriteBundle(job, job.p, f);
  const group = f.get(bundleKey(job.p.bundleId));
  assert.equal(group.status, "review");
  assert.equal(group.parts.length, 2);
  await discoverLocalFavoriteBundles(files, new Set(files), f);
  assert.equal(f.jobs("favorite-analyze").length, 1);
});

test("upgrade waits for an existing local-intake job and resumes its moved file", async (t) => {
  const f = await fixture(t),
    parts = f.parts(["未知歌曲"]),
    file = path.join(f.downloads, "old.mp4");
  await writeFile(file, "old independent recording");
  await writeFile(file.replace(".mp4", ".nfo"), favoriteNfo(parts[0]));
  const info = await stat(file),
    payload = {
      file,
      signature: info.size + ":" + info.mtimeMs,
      sourceUrl: parts[0].url,
    };
  const id = f.addJob("local-intake", payload);
  const group = await registerFavoriteBundle(parts, f);
  assert.equal(f.jobs("favorite-download").length, 0);
  await resumeFavoriteBundles(f);
  assert.equal(f.jobs("favorite-analyze").length, 0);
  await stageLocalFile({ id }, payload, f);
  f.db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(id);
  await resumeFavoriteBundles(f);
  assert.equal(f.jobs("favorite-analyze").length, 1);
  assert.equal(
    f.get(bundleKey(group.id)).parts[0].file,
    f.get(intakeKey(file)).file,
  );
});
