import test from "node:test";
import assert from "node:assert/strict";
import { libraryTier } from "../server/song-package.js";
import {
  identifyTitle,
  identifyVideo,
  catalogSeed,
} from "../shared/catalog.js";
import { parseLyrics, progress } from "../shared/lyrics.js";
import { findLyrics } from "../server/lyrics-source.js";
import { favoriteConfig } from "../server/favorites.js";
import { canonicalVideo } from "../server/sources.js";
test("library tiers require identity and both audio versions, with optional lyrics", () => {
  const song = {
    title: "歌曲",
    artist: "歌手",
    mode: "separated",
    status: "ready",
    lyrics: "[00:00]歌词",
    needs_video: 0,
  };
  assert.equal(libraryTier(song), "standard");
  assert.equal(libraryTier({ ...song, needs_video: 1 }), "audio");
  assert.equal(libraryTier({ ...song, lyrics: "" }), "standard");
  for (const patch of [
    { mode: "original" },
    { needs_review: 1 },
    { status: "preparing" },
    { artist: "未知歌手" },
  ])
    assert.equal(libraryTier({ ...song, ...patch }), "pending");
});
test("catalog resolves reversed common titles and keeps ambiguous uploads for review", () => {
  assert.deepEqual(identifyTitle("可爱女人-周杰伦"), {
    title: "可爱女人",
    artist: "周杰伦",
    needs_review: 0,
  });
  assert.equal(identifyTitle("BV1gF4m1K7Aa - S01E14").needs_review, 1);
  assert.equal(identifyTitle("不确定的人 - 不确定的歌").needs_review, 1);
  assert.ok(catalogSeed.length > 80);
  assert.deepEqual(
    identifyVideo({ title: "忍者", videoTitle: "周杰伦MV合集" }),
    { title: "忍者", artist: "周杰伦", needs_review: 1 },
  );
});
test("enhanced LRC preserves word timings, offsets and duplicate timestamps", () => {
  const lines = parseLyrics(
    "[offset:100]\n[00:10.00]<00:10.00>你<00:11.00>好\n[00:20.00][00:30.00]再见",
  );
  assert.equal(lines.length, 3);
  assert.equal(lines[0].text, "你好");
  assert.equal(lines[0].words[1].time, 10.9);
  assert.equal(progress(10.4, 9.9, 10.9), 50);
});
test("lyrics acquisition rejects mismatched singer or recording duration", async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => [
      {
        id: 1,
        trackName: "歌",
        artistName: "歌手",
        duration: 200,
        syncedLyrics: "[00:00]歌词",
      },
    ],
  });
  assert.equal((await findLyrics("歌", "歌手", 201, fetcher)).sourceId, 1);
  await assert.rejects(findLyrics("歌", "翻唱者", 200, fetcher));
  await assert.rejects(findLyrics("歌", "歌手", 240, fetcher));
});
test("bili-sync credentials assemble cookie and preserve explicit episode", () => {
  const config = favoriteConfig({
    favoriteId: "123",
    sessdata: "one",
    bili_jct: "two",
    buvid3: "three",
    dedeuserid: "42",
    ac_time_value: "refresh",
  });
  assert.match(config.cookie, /SESSDATA=one/);
  assert.ok(!config.cookie.includes("refresh"));
  assert.equal(
    favoriteConfig({ favoriteId: "123" }, config).credentials.sessdata,
    "one",
  );
  assert.equal(
    favoriteConfig({ favoriteId: "123", cookie: "SESSDATA=new" }, config)
      .cookie,
    "SESSDATA=new",
  );
  assert.throws(() => favoriteConfig({ sessdata: "a; injected=b" }));
  assert.equal(
    canonicalVideo("https://www.bilibili.com/video/BV1gF4m1K7Aa?p=14"),
    "https://www.bilibili.com/video/BV1gF4m1K7Aa?p=14",
  );
});
