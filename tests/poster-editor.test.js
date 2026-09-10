import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import ffmpeg from "ffmpeg-static";
import { createApp } from "../server/app.js";
process.env.FFMPEG = ffmpeg;
const png = await readFile("public/favicon.png");
async function fixture(t, readOnlyMedia = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-cover-editor-")),
    media = path.join(dir, "media");
  await mkdir(media);
  const downloads = [];
  const service = createApp({
    dataDir: path.join(dir, "data"),
    roots: [media],
    adminToken: "cover-fixture-password",
    worker: false,
    discovery: false,
    readOnlyMedia,
    posterOptions: {
      search: async () => [
        {
          title: "合成 MV 一",
          cover: "https://i0.hdslb.com/bfs/archive/one.jpg",
          url: "https://www.bilibili.com/video/BV1234567890",
          uploader: "测试作者",
          duration: 200,
        },
        {
          title: "合成 MV 二",
          cover: "https://i0.hdslb.com/bfs/archive/two.jpg",
          url: "https://www.bilibili.com/video/BV1234567891",
          uploader: "另一作者",
        },
        {
          title: "无效封面",
          cover: "http://127.0.0.1/private",
          url: "https://www.bilibili.com/video/BV1234567892",
        },
      ],
      download: async (url) => {
        downloads.push(url);
        return png;
      },
    },
  });
  const id = "1".repeat(24),
    file = path.join(media, "original.wav");
  await writeFile(file, "original audio untouched");
  service.store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,status,mode,created) VALUES(?,?,?,?,?,?,?)",
    )
    .run(id, file, "合成歌", "测试歌手", "ready", "original", Date.now());
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (url, body, headers = {}) =>
    fetch(base + "/api" + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer cover-fixture-password",
        "Content-Type": Buffer.isBuffer(body)
          ? "image/png"
          : "application/json",
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
    });
  return { ...service, id, file, call, downloads };
}
test("cover search returns selectable images; selection and upload preserve audio and reject invalid/stale writes", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.call("/admin/poster-search?q=test", undefined, {
        Authorization: "",
      })
    ).status,
    401,
  );
  const data = await (await f.call("/admin/poster-search?q=test")).json();
  assert.equal(data.results.length, 2);
  assert.equal(f.downloads.length, 0);
  assert.equal(
    (await f.call(`/admin/poster-candidates/${data.results[0].id}/image`))
      .status,
    200,
  );
  assert.equal(
    (
      await f.call(`/admin/library/${f.id}/poster/select`, {
        candidateId: data.results[1].id,
        expectedRevision: 99,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call(`/admin/library/${f.id}/poster/select`, {
        candidateId: data.results[1].id,
        expectedRevision: 0,
      })
    ).status,
    200,
  );
  const song = f.store.db.prepare("SELECT * FROM songs WHERE id=?").get(f.id),
    saved = await readFile(song.poster);
  assert.match(f.store.get("poster-source:" + f.id).sourceUrl, /BV1234567891/);
  assert.equal(
    (
      await f.call(
        `/admin/library/${f.id}/poster/upload?expectedRevision=0`,
        Buffer.from("invalid"),
      )
    ).status,
    400,
  );
  assert.deepEqual(await readFile(song.poster), saved);
  assert.equal(
    (
      await f.call(
        `/admin/library/${f.id}/poster/upload?expectedRevision=0`,
        png,
      )
    ).status,
    200,
  );
  assert.equal(f.store.get("poster-source:" + f.id).provider, "manual");
  assert.equal((await readFile(f.file)).toString(), "original audio untouched");
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM jobs").get().n, 0);
  assert.equal(
    f.store.db
      .prepare("SELECT metadataRevision FROM songs WHERE id=?")
      .get(f.id).metadataRevision,
    0,
  );
  assert.equal(
    (
      await f.call(`/admin/library/${f.id}/poster/select`, {
        candidateId: "unknown",
        expectedRevision: 0,
      })
    ).status,
    404,
  );
});
test("readonly preview permits cover discovery but refuses both image write routes", async (t) => {
  const f = await fixture(t, true);
  const data = await (await f.call("/admin/poster-search?q=test")).json();
  assert.equal(data.results.length, 2);
  assert.equal(
    (
      await f.call(`/admin/library/${f.id}/poster/select`, {
        candidateId: data.results[0].id,
        expectedRevision: 0,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(
        `/admin/library/${f.id}/poster/upload?expectedRevision=0`,
        png,
      )
    ).status,
    403,
  );
  assert.equal(
    f.store.db.prepare("SELECT poster FROM songs WHERE id=?").get(f.id).poster,
    "",
  );
});
