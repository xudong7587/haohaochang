import test from "node:test";
import assert from "node:assert/strict";
import { compareLibraryEntries } from "../src/library/sorting.js";
import { videoQuality } from "../src/library/video-quality.js";

test("library sorting supports both directions and stable artist groups before pagination", () => {
  const entries = [
    { key: "a", row: { title: "爱", artist: "周杰伦", created: 30 } },
    { key: "b", row: { title: "晴", artist: "陈奕迅", created: 10 } },
    { key: "c", row: { title: "雨", artist: "周杰伦", created: 20 } },
  ];
  const sorted = (sort, grouped = false) =>
    [...entries]
      .sort((a, b) => compareLibraryEntries(a, b, sort, grouped))
      .map((e) => e.key);
  assert.deepEqual(sorted("artist"), ["b", "a", "c"]);
  assert.deepEqual(sorted("artist-desc"), ["c", "a", "b"]);
  assert.deepEqual(sorted("title"), ["a", "b", "c"]);
  assert.deepEqual(sorted("title-desc"), ["c", "b", "a"]);
  assert.deepEqual(sorted("created"), ["b", "c", "a"]);
  assert.deepEqual(sorted("created-desc"), ["a", "c", "b"]);
  assert.deepEqual(sorted("created", true), ["b", "c", "a"]);
  assert.deepEqual(sorted("created-desc", true), ["b", "a", "c"]);
  entries.push({ key: "unknown", row: { title: "缺日期", created: null } });
  assert.equal(sorted("created").at(-1), "unknown");
  assert.equal(sorted("created-desc").at(-1), "unknown");
  assert.equal(
    compareLibraryEntries(
      { key: "a", row: { created: "2026-01-01" } },
      { key: "b", row: { created: "2026-02-01" } },
      "created",
    ) < 0,
    true,
  );
});

test("video labels include SD and HD, distinguish audio-only and unknown", () => {
  for (const height of [360, 480, 720, 1080, 2160])
    assert.equal(
      videoQuality({ videoInfo: { available: true, height } }),
      height + "p",
    );
  assert.equal(
    videoQuality({
      manifest: { resources: { video: { available: true, height: 480 } } },
    }),
    "480p",
  );
  assert.equal(videoQuality({ videoInfo: { available: false } }), "无视频");
  assert.equal(
    videoQuality({ videoInfo: { available: true } }),
    "分辨率待识别",
  );
});
