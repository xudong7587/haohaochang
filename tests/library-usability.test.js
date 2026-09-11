import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesResourceFilters,
  videoResolution,
} from "../src/library/filters.js";
import { horizontalPhotoBounds } from "../src/artist-crop.js";

test("resource filters combine missing fields and actual resolution bands", () => {
  const row = {
    lyrics: " ",
    hasPoster: false,
    videoInfo: { available: true, height: 2160 },
  };
  assert.equal(matchesResourceFilters(row, ["lyrics", "poster"], "2160"), true);
  assert.equal(matchesResourceFilters(row, ["video"], ""), false);
  assert.equal(
    matchesResourceFilters({ ...row, lyrics: "[00:01]歌词" }, ["lyrics"], ""),
    false,
  );
  assert.equal(
    videoResolution({ videoInfo: { available: false, height: 2160 } }),
    "none",
  );
  assert.equal(videoResolution({ videoInfo: { available: true } }), "unknown");
  assert.equal(videoResolution({ videoInfo: { height: 800 } }), "720");
  assert.equal(videoResolution({ videoInfo: { height: 240 } }), "low");
});

test("photo crops symmetric black bars, preserves dark photos and single shadows", () => {
  const make = (top, bottom) => {
    const width = 160,
      height = 100;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] =
          data[i + 1] =
          data[i + 2] =
            y < top || y >= height - bottom ? 8 : 180;
        data[i + 3] = 255;
      }
    return { data, width, height };
  };
  assert.deepEqual(horizontalPhotoBounds(make(20, 20)), {
    top: 20,
    bottom: 20,
  });
  for (const [top, bottom] of [
    [0, 0],
    [20, 0],
    [100, 100],
    [25, 10],
  ])
    assert.deepEqual(horizontalPhotoBounds(make(top, bottom)), {
      top: 0,
      bottom: 0,
    });
});
