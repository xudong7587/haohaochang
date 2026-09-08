import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openStore } from "../server/db.js";
import { metadata, importMedia, filesUnder } from "../server/library.js";
import { scanLibrary } from "../server/media.js";

test("NFO and artwork import, duplicate safety and source preservation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktv-library-"));
  const download = path.join(root, "download"),
    media = path.join(root, "media");
  await mkdir(download);
  await mkdir(media);
  const store = openStore(path.join(root, "data"));
  t.after(async () => {
    store.db.close();
    await rm(root, { recursive: true, force: true });
  });
  const source = path.join(download, "untitled.mp4");
  await writeFile(source, "video source");
  await writeFile(
    path.join(download, "untitled.nfo"),
    "<musicvideo><title><![CDATA[晴天 & 雨天]]></title><artist>测试歌手</artist><tag>女声</tag><genre>港台</genre></musicvideo>",
  );
  await writeFile(path.join(download, "untitled-poster.jpg"), "poster");
  const meta = await metadata(source, [download]);
  assert.equal(meta.title, "晴天 & 雨天");
  assert.equal(meta.artist, "测试歌手");
  assert.equal(meta.metadata_source, "NFO");
  assert.ok(meta.poster);
  assert.deepEqual(meta.tags, ["女声", "港台"]);
  const id = await importMedia(store, source, download, media);
  assert.equal(await importMedia(store, source, download, media), id);
  const song = store.db.prepare("SELECT * FROM songs WHERE id=?").get(id);
  assert.match(song.path, /画面.mp4$/);
  assert.equal(await readFile(song.path, "utf8"), "video source");
  assert.equal(await readFile(source, "utf8"), "video source");
  assert.ok((await stat(song.poster)).size);
  assert.equal(
    song.status,
    "preparing",
    "an in-flight import must not be selected by ambient preparation",
  );
  const second = path.join(download, "second.mp4");
  await writeFile(second, "a different performance");
  const other = await importMedia(store, second, download, media, {
    title: meta.title,
    artist: meta.artist,
  });
  assert.notEqual(other, id);
  assert.equal(await readFile(song.path, "utf8"), "video source");
  await scanLibrary(store, [media]);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM songs").get().n, 2);
  await writeFile(path.join(download, "unfinished.mp4.part"), "not done");
  assert.equal((await filesUnder(download)).length, 2);
  await writeFile(path.join(download, "bili.mp4"), "bili");
  await writeFile(
    path.join(download, "bili.nfo"),
    "<movie><title>歌手甲 - 歌曲乙</title><actor><name>123</name><role>搬运UP</role></actor><genre>欧美</genre></movie>",
  );
  const bili = await metadata(path.join(download, "bili.mp4"), [download]);
  assert.equal(bili.artist, "歌手甲");
  assert.equal(bili.title, "歌曲乙");
  assert.deepEqual(bili.tags, ["欧美"]);
  await writeFile(path.join(download, "bad.mp4"), "x");
  await writeFile(
    path.join(download, "bad.nfo"),
    '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><musicvideo><title>&x;</title></musicvideo>',
  );
  assert.equal(
    (await metadata(path.join(download, "bad.mp4"), [download])).title,
    "bad",
  );
});
