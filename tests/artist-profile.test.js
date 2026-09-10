import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpeg from "ffmpeg-static";
import { createApp } from "../server/app.js";
import { findArtistDescription } from "../server/artist-description.js";
process.env.FFMPEG = ffmpeg;
const png = await readFile("public/favicon.png");
async function fixture(t, readOnlyMedia = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-artist-profile-")),
    media = path.join(root, "media");
  await mkdir(media);
  const service = createApp({
    dataDir: path.join(root, "db"),
    roots: [media],
    worker: false,
    discovery: false,
    readOnlyMedia,
    adminToken: "artist-test-password",
    artistOptions: {
      find: async (name) => ({
        provider: "apple-artist",
        artist: name,
        title: name,
        source: "歌手照片",
        sourceUrl: "https://music.apple.com/cn/artist/example/1",
        imageUrl: "https://is1-ssl.mzstatic.com/test.jpg",
      }),
      describe: async () => ({
        description: "测试歌手的合成介绍",
        sourceUrl: "https://www.wikidata.org/wiki/Q1",
      }),
    },
    posterOptions: {
      download: async () => png,
      search: async () => [
        {
          title: "合成歌手照片",
          cover: "https://i0.hdslb.com/fixture.jpg",
          url: "https://www.bilibili.com/video/BV1234567890",
        },
      ],
    },
  });
  const source = path.join(media, "original.wav");
  await writeFile(source, "audio is unchanged");
  service.store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,status,mode,created) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      "a".repeat(24),
      source,
      "合成歌",
      "测试歌手",
      "ready",
      "original",
      Date.now(),
    );
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await service.close();
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (route, body, auth = "artist-test-password") =>
    fetch(base + "/api" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + auth,
        "Content-Type": Buffer.isBuffer(body)
          ? "image/png"
          : "application/json",
      },
      ...(body === undefined
        ? {}
        : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
    });
  return { call, service, source, base };
}
test("artist profile editing, photo search/upload and public artwork preserve songs and reject stale changes", async (t) => {
  const f = await fixture(t),
    q = "?artist=" + encodeURIComponent("测试歌手");
  const initial = await (await f.call("/artist-profile" + q)).json();
  assert.equal(initial.hasPhoto, false);
  assert.equal(initial.revision, 0);
  const text = await f.call("/admin/artist-profile", {
    artist: "测试歌手",
    description: "我的合成简介",
    expectedRevision: 0,
  });
  assert.equal(text.status, 200);
  assert.equal((await text.json()).revision, 1);
  assert.equal(
    (
      await f.call("/admin/artist-profile", {
        artist: "测试歌手",
        description: "stale",
        expectedRevision: 0,
      })
    ).status,
    409,
  );
  const candidate = await (
    await f.call("/admin/artist-photo-search" + q)
  ).json();
  assert.ok(candidate.id);
  assert.equal(
    (await f.call("/artist-profile" + q).then((r) => r.json())).hasPhoto,
    false,
    "search cannot change a photo",
  );
  const saved = await f.call("/admin/artist-photo/select" + q, {
    candidateId: candidate.id,
    expectedRevision: 1,
  });
  assert.equal(saved.status, 200);
  const profile = await saved.json();
  assert.equal(profile.revision, 2);
  assert.equal(profile.description, "我的合成简介");
  assert.ok(profile.hasPhoto);
  assert.equal(profile.file, undefined);
  const room = f.service.store.get("roomToken");
  const photo = await f.call("/artist-photo/" + profile.id, undefined, room);
  assert.equal(photo.status, 200);
  const before = Buffer.from(await photo.arrayBuffer());
  assert.equal(
    (
      await f.call(
        "/admin/artist-photo/upload" + q + "&expectedRevision=2",
        Buffer.from("bad image"),
      )
    ).status,
    400,
  );
  const after = Buffer.from(
    await (await f.call("/artist-photo/" + profile.id)).arrayBuffer(),
  );
  assert.deepEqual(after, before);
  assert.equal(
    (
      await f.call(
        "/admin/artist-photo/upload" + q + "&expectedRevision=1",
        png,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call(
        "/admin/artist-photo/upload" + q + "&expectedRevision=2",
        png,
      )
    ).status,
    200,
  );
  const artists = await (await f.call("/artists", undefined, room)).json();
  assert.equal(artists[0].hasPhoto, true);
  assert.equal(artists[0].description, "我的合成简介");
  assert.equal(artists[0].count, 1);
  assert.equal(
    (
      await f.call(
        "/admin/artist-profile",
        { artist: "测试歌手", description: "no", expectedRevision: 3 },
        room,
      )
    ).status,
    401,
  );
  assert.equal(await readFile(f.source, "utf8"), "audio is unchanged");
  assert.equal(
    f.service.store.db.prepare("SELECT COUNT(*) n FROM jobs").get().n,
    0,
  );
});
test("read-only preview and invalid profile writes cannot change artist assets", async (t) => {
  const f = await fixture(t, true),
    q = "?artist=" + encodeURIComponent("测试歌手");
  assert.equal(
    (
      await f.call(
        "/admin/artist-photo/upload" + q + "&expectedRevision=0",
        png,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("/admin/artist-profile", {
        artist: "测试歌手",
        description: "test",
        expectedRevision: 0,
      })
    ).status,
    403,
  );
  assert.equal((await f.call("/artist-profile?artist=missing")).status, 404);
});
test("automatic artist introductions require one exact-name performer and retain source attribution", async () => {
  const fetcher = (rows) => async () =>
    new Response(JSON.stringify({ search: rows }));
  const row = { id: "Q123", label: "测试歌手", description: "中国歌手" };
  assert.deepEqual(
    await findArtistDescription("测试歌手", { fetcher: fetcher([row]) }),
    {
      description: "中国歌手",
      sourceUrl: "https://www.wikidata.org/wiki/Q123",
    },
  );
  assert.equal(
    await findArtistDescription("另一歌手", { fetcher: fetcher([row]) }),
    null,
  );
  assert.equal(
    await findArtistDescription("测试歌手", {
      fetcher: fetcher([row, { ...row, id: "Q124" }]),
    }),
    null,
  );
  assert.equal(
    await findArtistDescription("测试歌手", {
      fetcher: fetcher([{ ...row, description: "地名" }]),
    }),
    null,
  );
});
