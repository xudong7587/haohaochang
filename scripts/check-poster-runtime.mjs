// Run against the actual NAS image (including Debian's FFmpeg), not the
// development ffmpeg-static binary. All data and requests stay in localhost.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { run } from "../server/process.js";

function png() {
  function chunk(type, data) {
    const name = Buffer.from(type),
      crcData = Buffer.concat([name, data]);
    let crc = 0xffffffff;
    for (const byte of crcData) {
      crc ^= byte;
      for (let b = 0; b < 8; b++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, name, data, sum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32);
  header.writeUInt32BE(24, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < 24; y++) {
    const row = Buffer.alloc(129);
    for (let x = 0; x < 32; x++) {
      const offset = 1 + x * 4;
      row[offset + 1] = 200;
      row[offset + 3] = x < 16 ? 255 : 0;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const ffmpeg = process.env.FFMPEG || "ffmpeg";
console.log((await run(ffmpeg, ["-version"])).split("\n")[0]);
const root = await mkdtemp(path.join(tmpdir(), "ktv-poster-runtime-"));
const media = path.join(root, "media");
await mkdir(media);
const picture = png();
let downloaded = picture;
const service = createApp({
  dataDir: path.join(root, "db"),
  roots: [media],
  worker: false,
  discovery: false,
  adminToken: "poster-runtime-password",
  posterOptions: {
    search: async () => [
      {
        title: "合成封面",
        cover: "https://i0.hdslb.com/bfs/archive/fixture.jpg",
        url: "https://www.bilibili.com/video/BV1234567890",
      },
    ],
    download: async () => downloaded,
  },
});
const server = service.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const id = "7".repeat(24),
  source = path.join(media, "audio.wav");
await writeFile(source, "existing audio");
service.store.db
  .prepare(
    "INSERT INTO songs(id,path,title,artist,status,mode,created) VALUES(?,?,?,?,?,?,?)",
  )
  .run(id, source, "合成歌", "测试歌手", "ready", "original", Date.now());
async function call(url, body, type = "application/json") {
  const response = await fetch(base + "/api" + url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer poster-runtime-password",
      "Content-Type": type,
    },
    ...(body === undefined
      ? {}
      : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
  });
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  return value;
}
try {
  const info = await fetch(base + "/api/server-info").then((r) => r.json());
  assert.equal(info.service, "haohaochang");
  const search = await call("/admin/poster-search?q=test&page=1");
  const candidate = search.results[0];
  await call(`/admin/library/${id}/poster/select`, {
    candidateId: candidate.id,
    expectedRevision: 0,
  });
  const poster = service.store.db
    .prepare("SELECT poster FROM songs WHERE id=?")
    .get(id).poster;
  const raw = path.join(root, "pixels.rgb");
  await run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-i",
    poster,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    raw,
  ]);
  const pixels = await readFile(raw);
  assert.equal(pixels.length, 24 * 24 * 3);
  const left = (12 * 24 + 4) * 3,
    right = (12 * 24 + 20) * 3;
  assert.ok(
    pixels[left] < 25 && pixels[left + 1] > 170 && pixels[left + 2] < 25,
    "Opaque green stays green",
  );
  assert.ok(
    [...pixels.subarray(right, right + 3)].every((v) => v > 240),
    "Transparent pixels flatten to white",
  );
  const good = await readFile(poster);
  // A JPEG from a Bilibili candidate exercises the common opaque-image path.
  downloaded = good;
  await call(`/admin/library/${id}/poster/select`, {
    candidateId: candidate.id,
    expectedRevision: 0,
  });
  assert.equal((await readFile(source)).toString(), "existing audio");
  // Verify that the public files used by TV startup are in the final image.
  for (const file of ["/boot.js", "/favicon.png"])
    assert.equal((await fetch(base + file)).status, 200, file);
  console.log(
    "PASS NAS runtime: Bilibili PNG/JPEG cover replacement, white transparency, preserved audio, server identity and TV startup assets",
  );
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await service.close();
  await rm(root, { recursive: true, force: true });
}
