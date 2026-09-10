import test from "node:test";
import assert from "node:assert/strict";
import { findLyrics, lyricsMatchReasons } from "../server/lyrics-source.js";
import { lyricsArtist, sameLyricsTitle } from "../shared/lyrics-identity.js";
test("version suffixes and reordered duet performers match, but different songs and singers remain separate", () => {
  assert.ok(sameLyricsTitle("晴天 (Live)", "晴天"));
  assert.ok(sameLyricsTitle("晴天（现场版）", "晴天"));
  assert.ok(!sameLyricsTitle("晴天（另一首）", "晴天"));
  assert.equal(lyricsArtist("林俊杰 周深"), lyricsArtist("周深 & 林俊杰"));
  assert.notEqual(lyricsArtist("周杰伦"), lyricsArtist("周深"));
  assert.deepEqual(
    lyricsMatchReasons(
      {
        title: "晴天 (Live)",
        artist: "周杰伦",
        duration: 210,
        lyrics: "[00:01]词",
      },
      { title: "晴天", artist: "周杰伦", duration: 220 },
    ),
    [],
  );
});
test("manual lyric lookup accepts a duration outlier as a warned candidate while automatic matching rejects it", async () => {
  const providers = [
    {
      id: "fixture",
      search: async () => [
        {
          title: "晴天",
          artist: "周杰伦",
          duration: 200,
          lyrics: "[00:01]测试",
        },
      ],
    },
  ];
  await assert.rejects(findLyrics("晴天", "周杰伦", 500, { providers }), {
    code: "LYRICS_NOT_FOUND",
  });
  const result = await findLyrics("晴天", "周杰伦", 500, {
    providers,
    manual: true,
  });
  assert.match(result.warning, /超过两分钟/);
  assert.ok(result.reviewReasons.includes("duration-mismatch"));
  await assert.rejects(
    findLyrics("晴天", "另一位歌手", 500, { providers, manual: true }),
  );
});
test("connection failures are explained separately from no synced lyrics", async () => {
  await assert.rejects(
    findLyrics("晴天", "周杰伦", 200, {
      providers: [
        {
          id: "offline",
          search: async () => {
            throw Error("offline");
          },
        },
      ],
    }),
    /暂时无法连接/,
  );
  await assert.rejects(
    findLyrics("晴天", "周杰伦", 200, {
      manual: true,
      providers: [{ id: "empty", search: async () => [] }],
    }),
    /带时间戳/,
  );
});
