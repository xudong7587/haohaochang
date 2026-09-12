import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rm,
} from "node:fs/promises";
import ffmpeg from "ffmpeg-static";
import { openStore } from "../server/db.js";
import {
  findAlbumPoster,
  albumTitle,
  findPoster,
} from "../server/poster-source.js";
import {
  stageLocalFile,
  intakeKey,
  intakeCleanupSources,
} from "../server/local-intake.js";
import { importKey, importMedia } from "../server/library.js";
import { completeMetadataBatch } from "../src/library/batch.js";
import { run } from "../server/process.js";

test("album artwork requires an unambiguous exact album and artist; generic collections are skipped", async () => {
  const album = {
    collectionId: 1,
    collectionName: "范特西",
    artistName: "周杰伦",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/100x100bb.jpg",
  };
  let rows = [album],
    calls = 0;
  const options = {
    throttle: async () => {},
    fetcher: async (url) => {
      calls++;
      assert.equal(url.searchParams.get("entity"), "album");
      return Response.json({ results: rows });
    },
  };
  assert.equal(albumTitle("周杰伦《范特西》全专辑", "周杰伦"), "范特西");
  assert.equal(
    (await findAlbumPoster("周杰伦", "周杰伦《范特西》全专辑", options))
      .provider,
    "itunes-album",
  );
  assert.equal(await findAlbumPoster("周杰伦", "精选合集", options), null);
  assert.equal(calls, 1);
  rows = [{ ...album, artistName: "其他歌手" }];
  assert.equal(await findAlbumPoster("周杰伦", "范特西", options), null);
  rows = [album, { ...album, collectionId: 2 }];
  assert.equal(await findAlbumPoster("周杰伦", "范特西", options), null);
  rows = [album];
  const source = await findPoster(
    { title: "爱在西元前", artist: "周杰伦" },
    {
      ...options,
      albumHint: "范特西",
      sourceUrl: "https://www.bilibili.com/video/BV123",
    },
  );
  assert.equal(
    source.provider,
    "itunes-album",
    "album hint takes precedence over the upload cover",
  );
});

test("bili-sync NFO collection inherits album, singer restaging preserves titles and all cleanup records", async (t) => {
  process.env.FFMPEG = ffmpeg;
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-album-intake-"));
  const downloads = path.join(root, "downloads"),
    media = path.join(root, "media");
  const season = path.join(downloads, "album", "Season 1");
  await mkdir(season, { recursive: true });
  await mkdir(media);
  const store = openStore(path.join(root, "data"));
  t.after(async () => {
    store.db.close();
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(
    path.join(path.dirname(season), "tvshow.nfo"),
    "<tvshow><title>歌手甲《唱片乙》全专辑</title></tvshow>",
  );
  const file = path.join(season, "第一首 - S01E01.mp4");
  await writeFile(file, "recording for intake");
  await writeFile(
    file.replace(".mp4", ".nfo"),
    "<episodedetails><title>第一首</title><director>上传者不能当歌手</director></episodedetails>",
  );
  const image = path.join(root, "cover.png");
  await run(ffmpeg, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x64",
    "-frames:v",
    "1",
    image,
  ]);
  let lookupCalls = 0;
  const context = {
    store,
    downloads,
    localMetadataSearch: async () => [],
    albumPosterFind: async (artist, hint) => {
      lookupCalls++;
      assert.equal(artist, "歌手甲");
      assert.match(hint, /唱片乙/);
      return {
        provider: "itunes-album",
        album: "唱片乙",
        imageUrl: "https://is1-ssl.mzstatic.com/cover.png",
      };
    },
    albumPosterDownload: async () => readFile(image),
  };
  const stage = async (source, artistOverride) => {
    const info = await stat(source);
    await stageLocalFile(
      { id: "test" },
      {
        file: source,
        signature: info.size + ":" + info.mtimeMs,
        artistOverride,
      },
      context,
    );
    return store.get(intakeKey(source));
  };
  const unknown = await stage(file);
  assert.equal(lookupCalls, 0);
  const known = await stage(unknown.file, "歌手甲");
  assert.equal(known.metadata.title, "第一首");
  assert.equal(known.metadata.albumPoster.album, "唱片乙");
  assert.equal((await readFile(known.metadata.poster))[0], 0xff);
  await assert.rejects(stat(unknown.file), { code: "ENOENT" });
  const same = await stage(known.file, "歌手甲");
  assert.equal(same.file, known.file);
  const cleanup = await intakeCleanupSources(store, same.file, downloads);
  assert.equal(
    cleanup.length,
    2,
    "NFO plus album image, with no duplicate cleanup entry",
  );
  assert.equal(
    store.get(importKey(same.file, await stat(same.file))),
    undefined,
    "same-path restage must remain visible and importable",
  );
  const id = await importMedia(
    store,
    same.file,
    downloads,
    media,
    same.metadata,
  );
  const song = store.db.prepare("SELECT * FROM songs WHERE id=?").get(id);
  assert.equal((await readFile(song.poster))[0], 0xff);
});

test("bulk singer applies only to the submitted eligible snapshot and reports individual failures", async () => {
  const entries = [
    { row: { id: "a", file: "/download/a.mp4", inbox: true } },
    {
      row: { id: "b", file: "/download/b.mp4", inbox: true, processing: true },
    },
    { row: { id: "online", file: "/download/online.mp4" } },
    { row: { id: "c", file: "/download/c.mp4", localIntakeAvailable: true } },
  ];
  const calls = [];
  const result = await completeMetadataBatch(
    entries,
    "统一歌手",
    async (url, body) => {
      calls.push({ url, body });
      entries[3].row.file = "/changed-after-start.mp4";
      if (body.reviewId) throw new Error("正在处理");
    },
  );
  assert.deepEqual(
    calls.map((c) => c.body.file),
    ["/download/a.mp4", "/download/c.mp4"],
  );
  assert.ok(calls.every((c) => c.body.artistOverride === "统一歌手"));
  assert.deepEqual(
    result.map((r) => r.status),
    ["success", "skipped", "skipped", "failed"],
  );
});
