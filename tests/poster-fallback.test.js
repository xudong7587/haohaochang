import test from "node:test";
import assert from "node:assert/strict";
import { findPoster, findArtistPoster } from "../server/poster-source.js";
import { needsPoster, posterSearchVersion } from "../server/song-poster.js";

const song = { title: "未收录的演唱会版本", artist: "周深" };
const throttle = async () => {};
test("a duet can use one of its named performers without splitting an English full name", async () => {
  const requested = [];
  const result = await findArtistPoster("林俊杰 周深", {
    throttle,
    fetcher: async (url) => {
      url = new URL(url);
      if (url.hostname === "music.apple.com")
        return new Response(
          '<meta property="og:image" content="https://is1-ssl.mzstatic.com/portrait.jpg">',
        );
      requested.push(url.searchParams.get("term"));
      return Response.json({
        results:
          url.searchParams.get("term") === "林俊杰"
            ? [{ artistName: "林俊杰", artistId: 123 }]
            : [],
      });
    },
  });
  assert.equal(result.artist, "林俊杰");
  assert.equal(result.requestedArtist, "林俊杰 周深");
  requested.length = 0;
  assert.equal(
    await findArtistPoster("Taylor Swift", {
      throttle,
      fetcher: async (url) => {
        requested.push(new URL(url).searchParams.get("term"));
        return Response.json({ results: [] });
      },
    }),
    null,
  );
  assert.deepEqual(requested, ["Taylor Swift", "Taylor Swift"]);
});
test("missing album uses the exact artist's square portrait and records fallback provenance", async () => {
  const requests = [];
  const result = await findPoster(song, {
    throttle,
    fetcher: async (url) => {
      url = new URL(url);
      requests.push(url);
      if (url.hostname === "music.apple.com")
        return new Response(
          '<meta property="og:image" content="https://is1-ssl.mzstatic.com/image/thumb/photo.jpg/1200x630cw.png">',
        );
      return Response.json({
        results:
          url.searchParams.get("entity") === "musicArtist"
            ? [
                { artistName: "其他歌手", artistId: 111 },
                { artistName: "周深", artistId: 222 },
              ]
            : [],
      });
    },
  });
  assert.equal(result.provider, "apple-artist");
  assert.equal(result.fallback, "artist");
  assert.equal(result.album, "");
  assert.ok(result.imageUrl.endsWith("/600x600bb.jpg"));
  assert.ok(result.fallbackImageUrl.endsWith("/1200x630cw.png"));
  assert.ok(requests.some((url) => url.pathname.endsWith("/222")));
  assert.ok(requests.every((url) => !url.pathname.endsWith("/111")));
});
test("unavailable portrait chooses a random image from that artist and rejects unrelated/unsafe images", async () => {
  const result = await findArtistPoster("周深", {
    throttle,
    random: () => 0.99,
    fetcher: async (url) =>
      Response.json({
        results:
          new URL(url).searchParams.get("entity") === "musicArtist"
            ? []
            : [
                {
                  artistName: "其他歌手",
                  artworkUrl100: "https://is1-ssl.mzstatic.com/wrong.jpg",
                },
                {
                  artistName: "周深",
                  artworkUrl100: "https://127.0.0.1/private",
                },
                {
                  artistName: "周深",
                  artworkUrl100:
                    "https://is1-ssl.mzstatic.com/one/100x100bb.jpg",
                },
                {
                  artistName: "周深",
                  artworkUrl100:
                    "https://is1-ssl.mzstatic.com/two/100x100bb.jpg",
                },
              ],
      }),
  });
  assert.equal(result.source, "歌手专辑图片");
  assert.equal(result.artist, "周深");
  assert.ok(result.imageUrl.includes("/two/"));
});
test("exact song artwork takes precedence and a failed source can still find the artist", async () => {
  const exact = await findPoster(song, {
    throttle,
    fetcher: async (url) => {
      assert.equal(new URL(url).searchParams.get("entity"), "song");
      return Response.json({
        results: [
          {
            trackName: song.title,
            artistName: song.artist,
            artworkUrl100: "https://is1-ssl.mzstatic.com/album/100x100bb.jpg",
          },
        ],
      });
    },
  });
  assert.equal(exact.provider, "itunes");
  assert.equal(exact.fallback, undefined);
  const fallback = await findPoster(song, {
    source: {
      url: "https://www.bilibili.com/video/BV1gF4m1K7Aa",
      cover: "http://127.0.0.1/private",
    },
    throttle,
    fetcher: async (url) => {
      url = new URL(url);
      if (url.searchParams.get("term") !== song.artist)
        throw Error("album lookup offline");
      return Response.json({
        results:
          url.searchParams.get("entity") === "musicArtist"
            ? []
            : [
                {
                  artistName: song.artist,
                  artworkUrl100:
                    "https://is1-ssl.mzstatic.com/artist/100x100bb.jpg",
                },
              ],
      });
    },
  });
  assert.equal(fallback.fallback, "artist");
});
test("previous no-match attempts get one retry with the artist policy, new failures retain cooldown", () => {
  let attempt = { status: "failed", at: Date.now() };
  const store = {
    get: (key) => (key.startsWith("poster-attempt:") ? attempt : true),
  };
  const ready = { id: "song", status: "ready", poster: "" };
  assert.equal(needsPoster(store, ready), true);
  attempt = { ...attempt, searchVersion: posterSearchVersion };
  assert.equal(needsPoster(store, ready), false);
  attempt.at -= 25 * 3600000;
  assert.equal(needsPoster(store, ready), true);
});
