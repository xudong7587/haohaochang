import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import {
  migrateSongAssets,
  archiveVersion,
  resourceRoot,
} from "../server/assets.js";
import { matchCandidates, acquireSong } from "../server/acquisition.js";
import { audioVisualArgs } from "../server/visualization.js";

test("permanent resources migrate without deleting source and preserve previous generation", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-assets-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const old = path.join(dir, "cache"),
    formal = resourceRoot(path.join(dir, "library"));
  await mkdir(old);
  const id = "a".repeat(24),
    file = id + "-vocal.mp4";
  await writeFile(path.join(old, file), "original generation");
  await migrateSongAssets(id, old, formal);
  assert.equal(
    await readFile(path.join(formal, file), "utf8"),
    "original generation",
  );
  assert.equal(
    await readFile(path.join(old, file), "utf8"),
    "original generation",
  );
  await archiveVersion(path.join(formal, file));
  await writeFile(path.join(formal, file), "new generation");
  await migrateSongAssets(id, old, formal);
  assert.equal(
    await readFile(path.join(formal, file), "utf8"),
    "new generation",
  );
});

test("automatic matching excludes unrelated songs and leaves unresolved requests for review", async () => {
  const items = [
    { title: "歌手甲 歌曲乙 官方 MV" },
    { title: "歌手甲 歌曲乙 伴奏" },
    { title: "歌手丙 歌曲乙" },
    { title: "歌手甲 歌曲乙 翻唱" },
  ];
  assert.equal(matchCandidates(items, "歌曲乙", "歌手甲").length, 2);
  assert.deepEqual(matchCandidates(items, "歌曲乙", "歌手甲", true), [
    items[0],
  ]);
  const result = await acquireSong(
    { title: "歌曲乙", artist: "歌手甲" },
    {
      search: async () => [],
      store: {},
      downloads: "unused",
      roots: [],
      outputs: "unused",
    },
  );
  assert.match(result.review, /未找到/);
  const args = audioVisualArgs("audio.m4a", ["one.jpg", "two.jpg"], 30);
  assert.ok(args.includes("-filter_complex"));
  assert.match(args[args.indexOf("-filter_complex") + 1], /showfreqs/);
  assert.match(args[args.indexOf("-filter_complex") + 1], /mod\(t,24\)/);
});
