import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rm,
} from "node:fs/promises";
import { openStore } from "../server/db.js";
import {
  nfoIdentity,
  completeLocalMetadata,
  stageLocalFile,
  intakeKey,
  intakeRoot,
  moveLocalFile,
  intakeCleanupSources,
} from "../server/local-intake.js";
import { importMedia } from "../server/library.js";
import { orderSongs } from "../server/routes/public-library.js";
import { createApp } from "../server/app.js";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { run } from "../server/process.js";
import { prepareSong } from "../server/media.js";
import { cleanImportedDownloads } from "../server/download-cleanup.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-local-intake-"));
  const downloads = path.join(root, "downloads"),
    media = path.join(root, "media");
  await mkdir(downloads);
  await mkdir(media);
  const store = openStore(path.join(root, "data"));
  t.after(async () => {
    store.db.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, downloads, media, store, localMetadataSearch: async () => [] };
}

test("NFO title wins, explicit performer and version survive, unsafe XML is rejected", () => {
  const result = nfoIdentity(
    "<musicvideo><title><![CDATA[【4K修复】歌手甲 - 歌曲乙（现场版）]]></title><artist>歌手甲</artist><director>上传者</director></musicvideo>",
    "无用标题",
  );
  assert.equal(result.title, "歌曲乙（现场版）");
  assert.equal(result.artist, "歌手甲");
  assert.equal(result.needs_review, 1);
  assert.throws(() =>
    nfoIdentity('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>', "x"),
  );
  assert.equal(
    nfoIdentity("<musicvideo><title>【有意义的标题】</title></musicvideo>", "x")
      .title,
    "【有意义的标题】",
  );
});

test("title search fills a unique singer but preserves ambiguous candidates for confirmation", async (t) => {
  const f = await fixture(t),
    file = path.join(f.downloads, "无名录音.mp4");
  await writeFile(file, "recording");
  await writeFile(
    file.replace(".mp4", ".nfo"),
    "<musicvideo><title>测试同名曲</title></musicvideo>",
  );
  const single = await completeLocalMetadata(
    file,
    f.downloads,
    f.store,
    async () => [{ title: "测试同名曲", artist: "甲" }],
  );
  assert.equal(single.artist, "甲");
  const ambiguous = await completeLocalMetadata(
    file,
    f.downloads,
    f.store,
    async () => [
      { title: "测试同名曲", artist: "甲" },
      { title: "测试同名曲", artist: "乙" },
      { title: "另一首", artist: "丙" },
    ],
  );
  assert.equal(ambiguous.artist, "未知歌手");
  assert.deepEqual(ambiguous.candidates, ["甲", "乙"]);
});

test("local staging moves media and same-name sidecars, resumes safely, retains identity and offset on import", async (t) => {
  const f = await fixture(t),
    file = path.join(f.downloads, "录音.mp4");
  await writeFile(file, "unique recording");
  await writeFile(
    file.replace(".mp4", ".nfo"),
    "<musicvideo><title>测试歌曲</title><artist>测试歌手</artist></musicvideo>",
  );
  await writeFile(file.replace(".mp4", ".lrc"), "[00:05]歌词");
  const info = await stat(file),
    payload = { file, signature: info.size + ":" + info.mtimeMs };
  await stageLocalFile({ id: "local-job" }, payload, f);
  await assert.rejects(stat(file), { code: "ENOENT" });
  const plan = f.store.get(intakeKey(file));
  assert.equal(path.dirname(path.dirname(plan.file)), intakeRoot(f.downloads));
  assert.match(path.basename(plan.file), /^测试歌手 - 测试歌曲/);
  assert.equal(await readFile(plan.file, "utf8"), "unique recording");
  await stageLocalFile({ id: "local-job" }, payload, f);
  const cleanup = await intakeCleanupSources(f.store, plan.file, f.downloads);
  assert.equal(cleanup.length, 2);
  f.store.set("lyrics-offset:" + plan.id, 90500);
  const id = await importMedia(f.store, plan.file, f.downloads, f.media, {
    title: "确认后的名称",
    artist: "测试歌手",
  });
  assert.equal(id, plan.id);
  assert.equal(f.store.get("lyrics-offset:" + id), 90500);
});

test("move refuses conflicting targets and changed sources without losing originals", async (t) => {
  const f = await fixture(t),
    source = path.join(f.downloads, "a.mp4"),
    target = path.join(f.downloads, "b.mp4");
  await writeFile(source, "original");
  await writeFile(target, "different");
  await assert.rejects(
    moveLocalFile(source, target, [f.downloads]),
    /校验失败/,
  );
  assert.equal(await readFile(source, "utf8"), "original");
  assert.equal(await readFile(target, "utf8"), "different");
  await assert.rejects(
    moveLocalFile(
      source,
      path.join(f.downloads, "c.mp4"),
      [f.downloads],
      "0:0",
    ),
    /变化/,
  );
  await assert.rejects(stat(path.join(f.downloads, "c.mp4")), {
    code: "ENOENT",
  });
});

test("song ordering applies before limits, while default clients retain their existing order", () => {
  const rows = [
    { id: "b", title: "乙" },
    { id: "a", title: "阿" },
  ];
  assert.deepEqual(orderSongs([...rows], undefined), rows);
  assert.equal(orderSongs([...rows], "title")[0].id, "a");
  assert.deepEqual(
    orderSongs([...rows], "random")
      .map((row) => row.id)
      .sort(),
    ["a", "b"],
  );
});

test("confirmed local media leaves no download duplicate after a usable package is published", async (t) => {
  const f = await fixture(t),
    file = path.join(f.downloads, "本地.mp4");
  process.env.FFMPEG = ffmpeg;
  process.env.FFPROBE = ffprobe.path;
  await run(ffmpeg, [
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
    file,
  ]);
  await writeFile(
    file.replace(".mp4", ".nfo"),
    "<musicvideo><title>移动测试</title><artist>测试歌手</artist></musicvideo>",
  );
  const original = await stat(file);
  await stageLocalFile(
    { id: "stage" },
    { file, signature: original.size + ":" + original.mtimeMs },
    f,
  );
  const staged = f.store.get(intakeKey(file)).file;
  const stagedInfo = await stat(staged);
  const cleanupSources = await intakeCleanupSources(
    f.store,
    staged,
    f.downloads,
  );
  const id = await importMedia(f.store, staged, f.downloads, f.media, {
    title: "移动测试",
    artist: "测试歌手",
    mode: "channels",
  });
  f.store.db.prepare("UPDATE songs SET backing=1,vocal=0 WHERE id=?").run(id);
  await prepareSong(f.store, id, [f.root], f.media);
  f.store.db
    .prepare(
      "INSERT INTO jobs(id,kind,payload,status,created) VALUES('confirmed','import',?,'done',0)",
    )
    .run(
      JSON.stringify({
        id,
        file: staged,
        signature: stagedInfo.size + ":" + stagedInfo.mtimeMs,
        cleanupSources,
        localIntake: true,
      }),
    );
  const result = await cleanImportedDownloads(f.store, f.downloads, { id });
  assert.equal(result.removed, 2);
  await assert.rejects(stat(staged), { code: "ENOENT" });
  const song = f.store.db.prepare("SELECT * FROM songs WHERE id=?").get(id);
  assert.ok((await stat(song.path)).size > 0);
});

test("inbox API stages local files, protects online review workflow and deletes staged media directly", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-intake-api-"));
  const service = createApp({
    dataDir: path.join(root, "data"),
    roots: [path.join(root, "media")],
    adminToken: "isolated-test-password",
    worker: false,
  });
  const downloads = path.join(root, "data", "downloads");
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await service.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const call = (url, body, method = "POST") =>
    fetch(`http://127.0.0.1:${server.address().port}/api${url}`, {
      method,
      headers: {
        Authorization: "Bearer isolated-test-password",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  await mkdir(downloads, { recursive: true });
  const file = path.join(downloads, "本地测试.mp4");
  await writeFile(file, "recording");
  const response = await call("/admin/inbox/complete-metadata", { file });
  assert.equal(response.status, 200);
  const { id } = await response.json();
  const job = service.store.db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
  assert.equal(job.kind, "local-intake");
  assert.equal(
    (await call("/admin/inbox/delete-preview", { file })).status,
    400,
    "active job blocks deletion",
  );
  await stageLocalFile(job, JSON.parse(job.payload), {
    store: service.store,
    downloads,
    localMetadataSearch: async () => [],
    emit: () => {},
  });
  service.store.db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(id);
  const staged = service.store.get(intakeKey(file)).file;
  const list = await (await call("/admin/inbox", null, "GET")).json();
  assert.equal(list.find((row) => row.file === staged).intakeStage, "staged");
  const plan = await (
    await call("/admin/inbox/delete-preview", { file: staged })
  ).json();
  assert.equal(
    (
      await call("/admin/inbox/delete-files", {
        file: staged,
        token: plan.token,
      })
    ).status,
    200,
  );
  await assert.rejects(stat(staged), { code: "ENOENT" });
  const online = path.join(downloads, "online.mp4");
  await writeFile(online, "online");
  service.store.db
    .prepare(
      "INSERT INTO jobs(id,kind,payload,status,created) VALUES('online','import',?,'review',0)",
    )
    .run(
      JSON.stringify({
        file: online,
        candidate: { canonicalUrl: "https://example.com" },
      }),
    );
  assert.equal(
    (
      await call("/admin/inbox/complete-metadata", {
        file: online,
        reviewId: "online",
      })
    ).status,
    400,
  );
  assert.equal(
    service.store.db.prepare("SELECT status FROM jobs WHERE id='online'").get()
      .status,
    "review",
  );
});
