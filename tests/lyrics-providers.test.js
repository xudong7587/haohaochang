import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { findLyrics, lyricsMatchReasons } from "../server/lyrics-source.js";
import { localLyricsProvider } from "../server/providers/local-lyrics.js";

async function fixture(t, rows) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ktv-lrc-provider-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const localIndex = path.join(dir, "index.json");
  await writeFile(localIndex, JSON.stringify(rows));
  await writeFile(
    path.join(dir, "中文.lrc"),
    "[offset:100]\n[00:10.00]<00:10.00>你<00:11.00>好",
  );
  return { dir, localIndex };
}
const row = {
  id: "local-001",
  title: "中文歌曲",
  artist: "实际歌手",
  duration: 200,
  file: "中文.lrc",
  sourceUrl: "https://example.org/authorized-source",
};
test("configured local Chinese enhanced LRC is preferred and records origin, offset units and hash", async (t) => {
  const { localIndex } = await fixture(t, [row]);
  let fetched = false;
  const result = await findLyrics(row.title, row.artist, 202, {
    localIndex,
    fetcher: async () => {
      fetched = true;
      throw new Error("must not fetch");
    },
  });
  assert.equal(fetched, false);
  assert.equal(result.provider, "local-lrc");
  assert.equal(result.sourceId, row.id);
  assert.equal(result.sourceUrl, row.sourceUrl);
  assert.equal(result.offsetUnit, "milliseconds");
  assert.match(result.lyrics, /<00:11.00>/);
  assert.match(result.evidence[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.status, "candidate");
  assert.ok(result.reviewReasons.includes("recording-alignment-needs-review"));
});
test("same name, cover artist, missing duration and recording version do not auto-match", async (t) => {
  const { localIndex } = await fixture(t, [{ ...row, version: "live" }]);
  for (const [artist, duration, options] of [
    [row.artist, 200, {}],
    ["翻唱歌手", 200, { version: "live" }],
    [row.artist, 205, { version: "live" }],
  ]) {
    await assert.rejects(
      findLyrics(row.title, artist, duration, {
        localIndex,
        lrclib: false,
        ...options,
      }),
      { code: "LYRICS_NOT_FOUND" },
    );
  }
  assert.equal(
    (
      await findLyrics(row.title, row.artist, 200, {
        localIndex,
        lrclib: false,
        version: "live",
      })
    ).recording.version,
    "live",
  );
  assert.ok(
    lyricsMatchReasons(
      { ...row, lyrics: "[00:00]词", duration: 0 },
      { ...row, duration: 200 },
    ).includes("duration-mismatch"),
  );
});
test("same-duration matching lyrics select a candidate without blocking", async (t) => {
  const { dir, localIndex } = await fixture(t, [
    row,
    { ...row, id: "other", file: "other.lrc" },
  ]);
  await writeFile(path.join(dir, "other.lrc"), "[00:09]另一版本");
  const result = await findLyrics(row.title, row.artist, 200, {
    localIndex,
    lrclib: false,
  });
  assert.equal(result.candidateCount, 2);
  assert.equal(result.selection, "closest-duration");
  assert.ok(result.lyrics);
});
test("local provider rejects paths escaping its index directory", async (t) => {
  const { localIndex } = await fixture(t, [{ ...row, file: "../outside.lrc" }]);
  await assert.rejects(localLyricsProvider(localIndex).search(row));
});
test("provider failure falls back to LRCLIB while retaining backwards-compatible fetch injection", async () => {
  const fetcher = async (requested) => {
    assert.equal(
      new URL(requested).searchParams.get("artist_name"),
      row.artist,
    );
    return {
      ok: true,
      json: async () => [
        {
          id: 42,
          trackName: row.title,
          artistName: row.artist,
          duration: 200,
          syncedLyrics: "[00:01]中文歌词",
        },
      ],
    };
  };
  const result = await findLyrics(row.title, row.artist, 200, fetcher);
  assert.equal(result.source, "LRCLIB");
  assert.equal(result.sourceId, 42);
  const fallback = await findLyrics(row.title, row.artist, 200, {
    localIndex: path.join(os.tmpdir(), "missing-ktv-index.json"),
    fetcher,
  });
  assert.equal(fallback.sourceId, 42);
});
