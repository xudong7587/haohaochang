import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { alignLyrics, autoAlignLyrics } from "../server/lyrics-alignment.js";
import { parseLyrics } from "../shared/lyrics.js";
import { openStore } from "../server/db.js";
import { withSongWrite } from "../server/song-writes.js";
const lyrics =
  "[ar:测试歌手]\n[00:01]作词：测试\n[00:40.00]第一句\n[00:45.00]第二句\n[00:50.00]第三句\n[00:55.00]第四句\n[01:00.00]第五句";
const song = { title: "测试歌", artist: "测试歌手", duration: 100 };
const activity = { version: 1, duration: 100, onsets: [50, 55, 60, 65, 70] };
test("vocal alignment applies one supported shift and rejects weak, drifting, malformed or isolated onsets", () => {
  const aligned = alignLyrics(lyrics, activity, song);
  assert.equal(aligned.shiftMs, 10000);
  assert.equal(aligned.matchedLines, 5);
  assert.equal(
    parseLyrics(aligned.lyrics).find((v) => v.text === "第一句").time,
    50,
  );
  assert.equal(alignLyrics(lyrics, { ...activity, onsets: [50] }, song), null);
  assert.equal(
    alignLyrics(lyrics, { ...activity, onsets: [50, 57, 64, 71, 78] }, song),
    null,
  );
  assert.equal(
    alignLyrics(lyrics, { ...activity, onsets: [1, 50, 55, 60, 65, 70] }, song),
    null,
  );
  assert.equal(
    alignLyrics(lyrics, { ...activity, onsets: [50, NaN, 60] }, song),
    null,
  );
  assert.equal(alignLyrics(lyrics, { ...activity, duration: 120 }, song), null);
  const offset =
    "[offset:2000]\n[00:42]<00:42>第一句\n[00:47]第二句\n[00:52]第三句";
  const result = alignLyrics(
    offset,
    { ...activity, onsets: [50, 55, 60] },
    song,
  );
  assert.equal(parseLyrics(result.lyrics)[0].time, 50);
  assert.equal(parseLyrics(result.lyrics)[0].words[0].time, 50);
});
test("automatic LRC publication retains the original, advances revisions once and respects manual calibration", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-lyric-align-"));
  const store = openStore(path.join(root, "db"));
  t.after(async () => {
    store.db.close();
    await rm(root, { recursive: true, force: true });
  });
  store.db
    .prepare(
      "INSERT INTO songs(id,path,title,artist,duration,lyrics,created) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      "song",
      path.join(root, "source.m4a"),
      song.title,
      song.artist,
      song.duration,
      lyrics,
      Date.now(),
    );
  store.set("lyrics-offset:song", 500);
  assert.equal(await autoAlignLyrics(store, "song", root, activity), false);
  store.set("lyrics-offset:song", 0);
  store.set("lyrics-match:song", { provider: "manual" });
  assert.equal(await autoAlignLyrics(store, "song", root, activity), false);
  store.set("lyrics-match:song", { provider: "local-lrc" });
  assert.equal(
    await withSongWrite(store, "song", () =>
      autoAlignLyrics(store, "song", root, activity),
    ),
    true,
  );
  const current = store.db.prepare("SELECT * FROM songs WHERE id='song'").get();
  const info = JSON.parse(
    await readFile(
      path.join(store.get("package:song"), "歌曲信息.json"),
      "utf8",
    ),
  );
  assert.equal(info.metadataRevision, current.metadataRevision);
  assert.equal(store.get("lyrics-auto:song").original, lyrics);
  assert.equal(await autoAlignLyrics(store, "song", root, activity), false);
});
