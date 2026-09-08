import test from "node:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import { openStore } from "../server/db.js";
import { backgroundApi } from "../server/background-api.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6lcAAAAASUVORK5CYII=",
  "base64",
);
const jpeg = Buffer.from([
  255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255,
  217,
]);
const webp = Buffer.from(
  "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
  "base64",
);
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ktv-background-")),
    root = path.join(directory, "media"),
    downloads = path.join(directory, "downloads"),
    cache = path.join(directory, "cache");
  await Promise.all([root, downloads, cache].map((folder) => mkdir(folder)));
  const store = openStore(path.join(directory, "db")),
    app = express();
  app.use(express.json());
  const auth = (token) => (req, res, next) =>
    req.headers.authorization === "Bearer " + token
      ? next()
      : res.status(401).json({ error: "Unauthorized" });
  backgroundApi({
    app,
    store,
    roots: [root],
    downloads,
    cache,
    admin: auth("admin"),
    member: auth("member"),
  });
  app.use((error, _req, res, _next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.db.close();
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("ktv-background-"));
    await rm(directory, { recursive: true, force: true });
  });
  const call = async (body, token = "admin") => {
    const response = await fetch(base + "/api/admin/background", {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  return { directory, root, downloads, cache, store, base, call };
}
test("background configuration copies validated formats, protects images and preserves old revisions", async (t) => {
  const f = await fixture(t),
    files = [
      path.join(f.root, "第一张.png"),
      path.join(f.root, "第二张.jpg"),
      path.join(f.downloads, "第三张.webp"),
    ];
  await Promise.all(
    files.map((file, index) => writeFile(file, [png, jpeg, webp][index])),
  );
  assert.equal((await f.call(undefined, "member")).status, 401);
  assert.equal(
    (await f.call({ images: files, intervalSeconds: 8 }, "member")).status,
    401,
  );
  const result = await f.call({ images: files, intervalSeconds: 8 });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { paths: files, intervalSeconds: 8 });
  const value = f.store.get("background");
  assert.equal(value.images.length, 3);
  assert.equal(value.paths, undefined);
  assert.ok(!JSON.stringify(value).includes(f.root));
  assert.deepEqual((await f.call()).data, result.data);
  for (const [index, type] of [
    "image/png",
    "image/jpeg",
    "image/webp",
  ].entries()) {
    const url = f.base + value.images[index].url;
    assert.equal((await fetch(url)).status, 401);
    const image = await fetch(url, {
      headers: { Authorization: "Bearer member" },
    });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("Content-Type"), type);
    assert.equal(image.headers.get("X-Content-Type-Options"), "nosniff");
    assert.deepEqual(
      Buffer.from(await image.arrayBuffer()),
      [png, jpeg, webp][index],
    );
  }
  await writeFile(files[0], Buffer.from("source changed"));
  const prior = await fetch(f.base + value.images[0].url, {
    headers: { Authorization: "Bearer member" },
  });
  assert.deepEqual(Buffer.from(await prior.arrayBuffer()), png);
  const cleared = await f.call({ images: [], intervalSeconds: 12 });
  assert.equal(cleared.status, 200);
  assert.deepEqual(f.store.get("background").images, []);
  assert.deepEqual((await f.call()).data, { paths: [], intervalSeconds: 12 });
  assert.equal(
    (
      await fetch(f.base + value.images[0].url, {
        headers: { Authorization: "Bearer member" },
      })
    ).status,
    200,
  );
  assert.equal(await readFile(files[1], "hex"), jpeg.toString("hex"));
});
test("invalid content, size, paths and lists retain the previous complete background", async (t) => {
  const f = await fixture(t),
    good = path.join(f.root, "good.png"),
    fake = path.join(f.root, "fake.jpg"),
    wrong = path.join(f.root, "wrong.jpg"),
    large = path.join(f.root, "large.png"),
    outside = path.join(f.directory, "private.png");
  await Promise.all([
    writeFile(good, png),
    writeFile(fake, "this is not an image at all"),
    writeFile(wrong, png),
    writeFile(large, Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)])),
    writeFile(outside, png),
  ]);
  await f.call({ images: [good], intervalSeconds: 12 });
  const previous = f.store.get("background"),
    before = await readdir(path.join(f.cache, "backgrounds"));
  const invalid = [
    { images: [good, fake], intervalSeconds: 12 },
    { images: [wrong], intervalSeconds: 12 },
    { images: [large], intervalSeconds: 12 },
    { images: [outside], intervalSeconds: 12 },
    { images: ["relative.png"], intervalSeconds: 12 },
    { images: Array(21).fill(good), intervalSeconds: 12 },
    { images: [good], intervalSeconds: 2 },
    { images: [good], intervalSeconds: 3601 },
    { images: [42], intervalSeconds: 12 },
  ];
  for (const body of invalid) {
    assert.equal((await f.call(body)).status, 400);
    assert.deepEqual(f.store.get("background"), previous);
  }
  assert.deepEqual(await readdir(path.join(f.cache, "backgrounds")), before);
  for (const suffix of [
    "../0",
    "bad/0",
    previous.revision + "/20",
    previous.revision + "/01",
    previous.revision + "/%2e%2e%2Fprivate.png",
  ])
    assert.equal(
      (
        await fetch(f.base + "/api/backgrounds/" + suffix, {
          headers: { Authorization: "Bearer member" },
        })
      ).status,
      404,
    );
});
test("source and published-directory links cannot escape configured roots", async (t) => {
  const f = await fixture(t),
    outside = path.join(f.directory, "outside"),
    alias = path.join(f.root, "alias");
  await mkdir(outside);
  await writeFile(path.join(outside, "private.png"), png);
  await symlink(
    outside,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(
    (
      await f.call({
        images: [path.join(alias, "private.png")],
        intervalSeconds: 12,
      })
    ).status,
    400,
  );
  assert.equal(f.store.get("background"), undefined);
  const revision = randomUUID();
  await mkdir(path.join(f.cache, "backgrounds"));
  await writeFile(path.join(outside, "0"), png);
  await symlink(
    outside,
    path.join(f.cache, "backgrounds", revision),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(
    (
      await fetch(f.base + "/api/backgrounds/" + revision + "/0", {
        headers: { Authorization: "Bearer member" },
      })
    ).status,
    404,
  );
});
test("failed publication removes only its new directory and keeps the previous pointer", async (t) => {
  const f = await fixture(t),
    good = path.join(f.root, "good.png");
  await writeFile(good, png);
  await f.call({ images: [good], intervalSeconds: 12 });
  const previous = f.store.get("background"),
    folders = await readdir(path.join(f.cache, "backgrounds")),
    originalSet = f.store.set;
  f.store.set = (key, value) => {
    if (key === "background") throw new Error("Simulated storage failure");
    return originalSet(key, value);
  };
  assert.equal(
    (await f.call({ images: [good, good], intervalSeconds: 20 })).status,
    400,
  );
  assert.deepEqual(f.store.get("background"), previous);
  assert.deepEqual(await readdir(path.join(f.cache, "backgrounds")), folders);
  assert.equal(
    (
      await fetch(f.base + previous.images[0].url, {
        headers: { Authorization: "Bearer member" },
      })
    ).status,
    200,
  );
});
test("concurrent background saves publish complete immutable revisions", async (t) => {
  const f = await fixture(t),
    one = path.join(f.root, "one.png"),
    two = path.join(f.root, "two.png");
  await writeFile(one, png);
  await writeFile(two, png);
  const results = await Promise.all([
    f.call({ images: [one], intervalSeconds: 7 }),
    f.call({ images: [two, one], intervalSeconds: 9 }),
  ]);
  assert.ok(results.every((result) => result.status === 200));
  const value = f.store.get("background"),
    config = (await f.call()).data;
  assert.ok(
    results.some(
      (result) => JSON.stringify(result.data) === JSON.stringify(config),
    ),
  );
  assert.equal(value.images.length, config.paths.length);
  for (const image of value.images)
    assert.equal(
      (
        await fetch(f.base + image.url, {
          headers: { Authorization: "Bearer member" },
        })
      ).status,
      200,
    );
});
test("background settings component compiles independently for integration", async () => {
  const result = await build({
    entryPoints: ["src/background-settings.jsx"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  });
  assert.ok(result.outputFiles[0].text.includes("BackgroundSettings"));
});
