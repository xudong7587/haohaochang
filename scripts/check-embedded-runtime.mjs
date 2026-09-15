// Run inside an isolated CI container started with a fixture KTV_EMBEDDED_KEY.
// Uses the production provider path and pretrained htdemucs, without real songs.
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openStore } from "../server/db.js";
import { run, prepareSong } from "../server/media.js";
import { separateSong } from "../server/separation.js";
import { cpuConfig } from "../server/separation/providers.js";
import { checkProvider } from "../server/separation/protocol.js";

assert.equal(process.env.KTV_EMBEDDED_SEPARATION, "1");
assert.ok(
  process.env.KTV_EMBEDDED_KEY,
  "CI must pass its own ephemeral worker key",
);
const cpu = cpuConfig();
assert.equal((await fetch(cpu.endpoint + "/health")).status, 401);
const health = await checkProvider(cpu);
assert.equal(health.backend, "demucs");
assert.equal(health.device, "cpu");
assert.equal(health.concurrency, 1);
const status = await (
  await fetch(
    `http://127.0.0.1:${process.env.PORT || 3210}/api/admin/separation`,
    {
      headers: { Authorization: "Bearer " + process.env.ADMIN_PASSWORD },
    },
  )
).json();
assert.equal(status.config.embedded, true);
assert.equal(status.providers.find((p) => p.kind === "cpu").ready, true);
assert.equal(status.providers.find((p) => p.kind === "npu").ready, false);

const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-embedded-smoke-"));
let store;
try {
  store = openStore(path.join(dir, "db"));
  const source = path.join(dir, "tone.wav"),
    cache = path.join(dir, "cache");
  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-ac",
    "2",
    source,
  ]);
  store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,created) VALUES (?,?,?,?,?)",
    )
    .run("smoke", source, "CI tone", "fixture", Date.now());
  await prepareSong(store, "smoke", [dir], cache);
  store.set("ai", { enabled: true, npuEnabled: true, cpuEnabled: true });
  const song = store.db.prepare("SELECT * FROM songs WHERE id='smoke'").get();
  assert.equal(await separateSong(store, song, cache), true);
  assert.equal(
    store.db.prepare("SELECT mode FROM songs WHERE id='smoke'").get().mode,
    "separated",
  );
  assert.ok(
    (await stat(path.join(store.get("package:smoke"), "伴奏.m4a"))).size > 100,
  );
  console.log(
    "Embedded CPU pretrained htdemucs separation, NPU absence fallback, authenticated status and output validation passed",
  );
} finally {
  store?.db.close();
  await rm(dir, { recursive: true, force: true });
}
