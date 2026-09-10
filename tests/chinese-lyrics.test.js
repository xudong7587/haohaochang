import test from "node:test";
import assert from "node:assert/strict";
import { qqLyricsProvider } from "../server/providers/qq-lyrics.js";
import { neteaseLyricsProvider } from "../server/providers/netease-lyrics.js";
import { findLyrics } from "../server/lyrics-source.js";
import { lrclibProvider } from "../server/providers/lrclib.js";
const response = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
const query = {
  title: "测试歌",
  artist: "测试歌手",
  duration: 200,
  manual: true,
};

test("QQ search fetches timed lyrics, decodes text entities, and ranks performer versions ahead of namesakes", async () => {
  const calls = [];
  const provider = qqLyricsProvider(async (url, options) => {
    const u = new URL(url);
    calls.push(u);
    assert.equal(u.protocol, "https:");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Referer, "https://y.qq.com/");
    if (u.pathname.includes("search"))
      return response({
        code: 0,
        data: {
          song: {
            list: [
              {
                songname: "测试歌 (Live)",
                singer: [{ name: "测试歌手" }],
                interval: 200,
                songmid: "001test00001",
                albumname: "现场",
              },
              {
                songname: "测试歌 (Live改编版)",
                singer: [{ name: "测试歌手" }],
                interval: 270,
                songmid: "001test00002",
              },
              {
                songname: "完全不同",
                singer: [{ name: "测试歌手" }],
                interval: 200,
                songmid: "001test00003",
              },
              {
                songname: "测试歌",
                singer: [{ name: "另一个人" }],
                interval: 200,
                songmid: "001test00004",
              },
            ],
          },
        },
      });
    return response({
      code: 0,
      lyric: `&#91;00:01.00&#93;测试 &amp; ${u.searchParams.get("songmid")}`,
    });
  });
  const result = await findLyrics(query.title, query.artist, 200, {
    manual: true,
    providers: [provider],
  });
  assert.equal(result.source, "QQ 音乐");
  assert.equal(result.candidates.length, 3);
  assert.equal(result.selectionRequired, true);
  assert.match(result.lyrics, /\[00:01\.00\]测试 &/);
  assert.equal(result.candidates[0].recording.artist, query.artist);
  assert.ok(
    result.candidates.some((c) => c.reviewReasons.includes("artist-mismatch")),
  );
  assert.ok(
    !calls.some((u) => u.searchParams.get("songmid") === "001test00003"),
  );
  const automatic = await findLyrics(query.title, query.artist, 200, {
    providers: [provider],
  });
  assert.equal(automatic.sourceId, "001test00001");
  assert.equal(automatic.candidates, undefined);
});

test("NetEase uses bounded public search and LRC endpoints and keeps original timed lyrics", async () => {
  const requests = [];
  const provider = neteaseLyricsProvider(async (url, options) => {
    const u = new URL(url);
    requests.push(u);
    assert.equal(u.hostname, "music.163.com");
    assert.equal(options.redirect, "error");
    if (u.pathname.includes("search")) {
      assert.equal(options.method, "POST");
      assert.equal(options.body.get("type"), "1");
      return response({
        code: 200,
        result: {
          songs: [
            {
              id: 123,
              name: "测试歌 (Live)",
              artists: [{ name: query.artist }],
              duration: 201000,
              album: { name: "现场版" },
            },
          ],
        },
      });
    }
    assert.equal(u.searchParams.get("id"), "123");
    return response({
      code: 200,
      lrc: { lyric: "[offset:100]\n[00:01.50]合成歌词" },
    });
  });
  const result = await findLyrics(query.title, query.artist, 200, {
    manual: true,
    providers: [provider],
  });
  assert.equal(result.source, "网易云音乐");
  assert.equal(result.recording.duration, 201);
  assert.equal(result.recording.album, "现场版");
  assert.match(result.lyrics, /offset:100/);
  assert.equal(requests.length, 2);
});

test("unavailable Chinese providers fall back without mistaking plain text for synced LRC", async () => {
  const qq = qqLyricsProvider(async () => {
    throw Error("offline");
  });
  const netease = neteaseLyricsProvider(async (url) =>
    response(
      String(url).includes("search")
        ? {
            code: 200,
            result: {
              songs: [
                {
                  id: 12,
                  name: "测试歌",
                  artists: [{ name: query.artist }],
                  duration: 200000,
                },
              ],
            },
          }
        : { code: 200, lrc: { lyric: "无时间戳" } },
    ),
  );
  const lrc = lrclibProvider(async () =>
    response([
      {
        id: 9,
        trackName: query.title,
        artistName: query.artist,
        duration: 200,
        syncedLyrics: "[00:01]后备测试",
      },
    ]),
  );
  const result = await findLyrics(query.title, query.artist, 200, {
    manual: true,
    providers: [qq, netease, lrc],
  });
  assert.equal(result.provider, "lrclib");
});

test("manual fallback offers namesakes only after trying the requested singer in later sources", async () => {
  const provider = (id, artist) => ({
    id,
    search: async () => [
      {
        title: query.title,
        artist,
        duration: 200,
        lyrics: "[00:01]" + id,
        sourceId: id,
      },
    ],
  });
  const result = await findLyrics(query.title, query.artist, 200, {
    manual: true,
    providers: [
      provider("first", "同名歌手"),
      provider("second", query.artist),
    ],
  });
  assert.equal(result.provider, "second");
  assert.equal(result.selectionRequired, false);
  const only = await findLyrics(query.title, query.artist, 200, {
    manual: true,
    providers: [provider("first", "同名歌手")],
  });
  assert.equal(only.selectionRequired, true);
  assert.match(only.warning, /同名/);
});

test("lyrics providers reject redirects and oversized responses", async () => {
  await assert.rejects(
    qqLyricsProvider(
      async () =>
        new Response("", {
          status: 302,
          headers: { Location: "http://localhost/private" },
        }),
    ).search(query),
    /HTTP 302/,
  );
  await assert.rejects(
    neteaseLyricsProvider(
      async () =>
        new Response("", {
          headers: { "content-length": String(3 * 1024 * 1024) },
        }),
    ).search(query),
    /过大/,
  );
});
