import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {openStore} from '../server/db.js';
import {createApp} from '../server/app.js';
import {createScheduler} from '../server/scheduler.js';
import {withSongWrite, currentSong} from '../server/song-writes.js';
import {stageResources} from '../server/resource-publication.js';
import {saveSongMetadata} from '../server/song-metadata.js';
import {publishBacking} from '../server/song-package.js';
import {resourceManifest, canEnqueue} from '../server/resource-manifest.js';
import {resourceRoot} from '../server/assets.js';
import {importMedia} from '../server/library.js';
import {prepareSong, scanLibrary} from '../server/media.js';
import {probe} from '../server/media-utils.js';
import {run} from '../server/process.js';

process.env.FFMPEG = ffmpeg;
process.env.FFPROBE = ffprobe.path;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
async function until(predicate, description) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail('Timed out waiting for ' + description);
    await pause(5);
  }
}
async function fixture(t, {http = false} = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ktv-contracts-'));
  const root = path.join(dir, 'media'), downloads = path.join(dir, 'downloads'), dataDir = path.join(dir, 'db');
  await Promise.all([mkdir(root), mkdir(downloads)]);
  const cache = resourceRoot(root);
  await mkdir(cache);
  const service = http ? createApp({dataDir, roots:[root], downloads, adminToken:'contracts-test-password', worker:false}) : null;
  let store = service?.store || openStore(dataDir);
  const beforeClose = [];
  let server, base;
  if (http) {
    server = service.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  t.after(async () => {
    for (const cleanup of beforeClose) await cleanup();
    if (service) {service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
    else store.db.close();
    await rm(dir, {recursive:true, force:true});
  });
  const f = {dir, root, downloads, cache, base, beforeClose(action) {beforeClose.push(action);}, get store() {return store;},
    song(id = 'song') {return currentSong(store, id);},
    async audio(file, duration = 1, frequency = 440) {
      await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${duration}`, file]);
      return file;
    },
    seed(id = 'song', file = path.join(root, id + '.wav'), fields = {}) {
      store.db.prepare('INSERT INTO songs(id,path,title,artist,lyrics,created) VALUES(?,?,?,?,?,?)')
        .run(id, file, fields.title || '测试', fields.artist || '测试歌手', fields.lyrics || '[00:00.00]原歌词', Date.now());
      return currentSong(store, id);
    },
    async ready(id = 'song') {
      const file = await this.audio(path.join(root, id + '.wav'));
      this.seed(id, file);
      await prepareSong(store, id, [root], cache);
      return this.song(id);
    },
    reopen() {assert.ok(!service); store.db.close(); store = openStore(dataDir);},
    async request(route, body, method = 'POST') {
      const response = await fetch(base + '/api' + route, {method, headers:{Authorization:'Bearer contracts-test-password', 'Content-Type':'application/json'}, body:JSON.stringify(body)});
      return {status:response.status, data:await response.json()};
    },
    async packageHash(id = 'song') {
      const dir = store.get('package:' + id);
      return Object.fromEntries(await Promise.all(['原唱.m4a','伴奏.m4a','歌词.lrc'].map(async name => {
        try {return [name, createHash('sha256').update(await readFile(path.join(dir, name))).digest('hex')];}
        catch (error) {if (error.code !== 'ENOENT') throw error; return [name, null];}
      })));
    }
  };
  return f;
}
function schedulerFor(t, f, execute) {
  const finished = deferred();
  const scheduler = createScheduler({store:f.store, db:f.store.db, get:f.store.get, set:f.store.set, cache:f.cache, emit:() => {}, enqueue:() => {}}, {execute, onIdle:finished.resolve});
  f.beforeClose(async () => {scheduler.stop(); await finished.promise;});
  return scheduler;
}

test('changed separated source and failed accompaniment publication preserve the old matched pair', {timeout:10000}, async t => {
  const f = await fixture(t);
  await f.ready();
  await publishBacking(f.store, f.song(), f.cache, f.song().path);
  const before = f.song(), directory = f.store.get('package:song'), hashes = await f.packageHash();
  const short = await f.audio(path.join(f.downloads, 'short.wav'), 0.1);
  await assert.rejects(publishBacking(f.store, f.song(), f.cache, short), /时长|资源校验/);
  assert.equal(f.store.get('package:song'), directory);
  assert.deepEqual(await f.packageHash(), hashes);
  await f.audio(f.song().path, 3, 880);
  await assert.rejects(prepareSong(f.store, 'song', [f.root], f.cache), /音频已改变/);
  assert.equal(f.song().resourceRevision, before.resourceRevision);
  assert.equal(f.song().duration, before.duration);
  assert.equal(f.store.get('package:song'), directory);
  assert.deepEqual(await f.packageHash(), hashes);
  const manifest = resourceManifest(f.store, f.song(), f.cache);
  assert.equal(manifest.vocal, true);
  assert.equal(manifest.backing, true);
  assert.equal(manifest.playable, true);
});

test('changed nonempty media is unavailable until prepare repairs and verifies it', {timeout:10000}, async t => {
  const f = await fixture(t);
  await f.ready();
  const old = f.store.get('package:song');
  await writeFile(path.join(old, '原唱.m4a'), 'corrupt media is still a nonempty file');
  assert.equal(resourceManifest(f.store, f.song(), f.cache).playable, false);
  assert.equal(canEnqueue(f.store, f.song(), f.cache), false);
  await prepareSong(f.store, 'song', [f.root], f.cache);
  const repaired = f.store.get('package:song');
  assert.notEqual(repaired, old);
  const info = await probe(path.join(repaired, '原唱.m4a'));
  assert.equal(info.audio.length, 1);
  assert.ok(Math.abs(info.duration - 1) < 0.1);
  assert.equal(resourceManifest(f.store, f.song(), f.cache).playable, true);
});

test('concurrent imports of identical content converge on one song and its correct package pointer', {timeout:10000}, async t => {
  const f = await fixture(t);
  const first = await f.audio(path.join(f.downloads, 'first.wav'));
  const second = path.join(f.downloads, 'second.wav');
  await copyFile(first, second);
  const ids = await Promise.all([
    importMedia(f.store, first, f.downloads, f.root, {title:'FIRST', artist:'Artist', tags:[]}),
    importMedia(f.store, second, f.downloads, f.root, {title:'SECOND', artist:'Artist', tags:[]}),
    importMedia(f.store, first, f.downloads, f.root, {title:'THIRD', artist:'Artist', tags:[]})
  ]);
  assert.equal(new Set(ids).size, 1);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM songs').get().n, 1);
  const song = f.song(ids[0]);
  assert.equal(f.store.get('package:' + song.id), path.dirname(song.path));
  assert.deepEqual(await readFile(song.path), await readFile(first));
});

test('scan waits for an existing song write and saves discovered lyrics through the package service', {timeout:10000}, async t => {
  const f = await fixture(t);
  const file = await f.audio(path.join(f.root, '周杰伦 - 晴天.wav'));
  f.seed('scan', file, {title:'OLD', artist:'OLD'});
  f.store.db.prepare("UPDATE songs SET lyrics='' WHERE id='scan'").run();
  await writeFile(path.join(f.root, '周杰伦 - 晴天.lrc'), '[00:00.00]扫描发现的歌词');
  const entered = deferred(), release = deferred();
  const writing = withSongWrite(f.store, 'scan', async () => {entered.resolve(); await release.promise;});
  await entered.promise;
  let scanned = false;
  const scanning = scanLibrary(f.store, [f.root]).then(() => {scanned = true;});
  try {
    await pause(100);
    assert.equal(scanned, false);
    assert.equal(f.song('scan').title, 'OLD');
  } finally {release.resolve(); await writing; await scanning;}
  assert.equal(f.song('scan').title, '晴天');
  assert.equal(await readFile(path.join(f.store.get('package:scan'), '歌词.lrc'), 'utf8'), f.song('scan').lyrics);
});

test('metadata exports use the committed revision for no-op and provenance-only edits', async t => {
  const f = await fixture(t);
  f.seed();
  const before = f.song().metadataRevision;
  const noop = await saveSongMetadata(f.store, 'song', {title:f.song().title, expectedRevision:before}, f.cache);
  assert.equal(noop.metadataRevision, before);
  const exported = () => readFile(path.join(f.store.get('package:song'), '歌曲信息.json'), 'utf8').then(JSON.parse);
  assert.equal((await exported()).metadataRevision, noop.metadataRevision);
  const changed = await saveSongMetadata(f.store, 'song', {metadata_source:'手动', evidence:'["confirmed"]', expectedRevision:noop.metadataRevision}, f.cache);
  assert.equal(changed.metadataRevision, before + 1);
  assert.equal((await exported()).metadataRevision, changed.metadataRevision);
  assert.equal((await exported()).resourceRevision, changed.resourceRevision);
});

test('scheduler runs different songs concurrently and serializes different tasks for one song', {timeout:10000}, async t => {
  const f = await fixture(t);
  f.seed('a'); f.seed('b');
  const release = deferred(), started = [], running = new Set();
  let peak = 0;
  const scheduler = schedulerFor(t, f, async (job, payload) => {
    assert.equal(running.has(payload.id), false, 'same song must never overlap');
    running.add(payload.id); peak = Math.max(peak, running.size); started.push(job.kind);
    if (job.kind !== 'second-a') await release.promise;
    running.delete(payload.id);
  });
  const ids = [scheduler.addJob('first-a', {id:'a'}), scheduler.addJob('second-a', {id:'a'}), scheduler.addJob('first-b', {id:'b'})];
  try {
    await until(() => started.length === 2, 'two independent songs to start');
    assert.deepEqual(new Set(started), new Set(['first-a', 'first-b']));
    assert.equal(peak, 2);
  } finally {release.resolve();}
  await until(() => ids.every(id => f.store.db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status === 'done'), 'all scheduled jobs to finish');
  assert.equal(started[2], 'second-a');
});

test('failed job retry accepts its own committed revision but rejects a later user edit', {timeout:10000}, async t => {
  const f = await fixture(t);
  f.seed();
  let calls = 0;
  const scheduler = schedulerFor(t, f, async (job, payload) => {
    calls++;
    if (calls === 1 || calls === 3) {
      await saveSongMetadata(f.store, payload.id, {title:'Job edit ' + calls}, f.cache, {required:false, idle:false});
      throw new Error('Simulated provider failure after metadata commit');
    }
  });
  const state = id => f.store.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  const retry = id => {f.store.db.prepare("UPDATE jobs SET status='queued',error='' WHERE id=?").run(id); return scheduler.work();};
  const first = scheduler.addJob('organize-test', {id:'song'});
  await until(() => state(first).status === 'failed', 'first failure');
  assert.equal(JSON.parse(state(first).payload).expectedRevision, f.song().metadataRevision);
  await retry(first);
  assert.equal(state(first).status, 'done');
  assert.equal(calls, 2);
  const second = scheduler.addJob('organize-test', {id:'song'});
  await until(() => state(second).status === 'failed', 'second failure');
  const checkpoint = JSON.parse(state(second).payload).expectedRevision;
  await saveSongMetadata(f.store, 'song', {title:'Later user edit', expectedRevision:checkpoint}, f.cache);
  await retry(second);
  assert.equal(state(second).status, 'failed');
  assert.match(state(second).error, /资料已更新/);
  assert.equal(calls, 3, 'stale retry must stop before executing work');
  assert.equal(JSON.parse(state(second).payload).expectedRevision, checkpoint);
  assert.equal(f.song().title, 'Later user edit');
});

test('reopening a running job resumes committed phases without publishing another resource revision', {timeout:10000}, async t => {
  const f = await fixture(t);
  const file = await f.audio(path.join(f.root, 'song.wav'));
  f.seed('song', file);
  const jobId = 'restart-publication';
  f.store.db.prepare('INSERT INTO jobs(id,kind,payload,status,created) VALUES(?,?,?,?,?)')
    .run(jobId, 'prepare', JSON.stringify({id:'song', expectedRevision:0}), 'running', Date.now());
  const phases = () => withSongWrite(f.store, 'song', async () => {
    await prepareSong(f.store, 'song', [f.root], f.cache);
    await publishBacking(f.store, f.song(), f.cache, file);
  }, {jobId, expectedRevision:JSON.parse(f.store.db.prepare('SELECT payload FROM jobs WHERE id=?').get(jobId).payload).expectedRevision});
  await phases();
  const before = f.song(), directory = f.store.get('package:song'), hashes = await f.packageHash();
  // This is the durable state after publication but before scheduler completion.
  assert.equal(f.store.db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId).status, 'running');
  f.reopen();
  assert.equal(f.store.db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId).status, 'queued');
  await phases();
  assert.equal(f.song().resourceRevision, before.resourceRevision);
  assert.equal(f.song().metadataRevision, before.metadataRevision);
  assert.equal(f.store.get('package:song'), directory);
  assert.deepEqual(await f.packageHash(), hashes);
});

test('stale metadata and a staged publication conflict preserve the current resource pointer', async t => {
  const f = await fixture(t);
  f.seed();
  const before = f.song();
  const newer = await saveSongMetadata(f.store, 'song', {title:'Newer title', expectedRevision:before.metadataRevision}, f.cache);
  const directory = f.store.get('package:song');
  await assert.rejects(saveSongMetadata(f.store, 'song', {title:'Old draft', expectedRevision:before.metadataRevision}, f.cache), error => error.status === 409 && error.code === 'REVISION_CONFLICT');
  const stage = await stageResources(f.store, newer, f.cache);
  try {
    f.store.db.prepare("UPDATE songs SET artist='External writer' WHERE id='song'").run();
    assert.throws(() => stage.publish({status:'ready'}), error => error.status === 409);
    assert.equal(f.store.get('package:song'), directory);
    assert.equal(f.song().title, 'Newer title');
    assert.equal(f.song().resourceRevision, newer.resourceRevision);
  } finally {await stage.abandon();}
});

test('legacy and new lyric APIs update the same files and roll back failed publication', {timeout:10000}, async t => {
  const f = await fixture(t, {http:true});
  await f.ready();
  const legacy = await f.request('/admin/songs/song/lyrics', {lyrics:'[00:00.00]旧入口新歌词', expectedRevision:f.song().metadataRevision}, 'PUT');
  assert.equal(legacy.status, 200);
  const oldRevision = f.song().resourceRevision;
  assert.equal(await readFile(path.join(f.store.get('package:song'), '歌词.lrc'), 'utf8'), f.song().lyrics);
  const updated = await f.request('/admin/library/song/save', {title:f.song().title, artist:f.song().artist, lyrics:'[00:00.00]新入口歌词', expectedRevision:f.song().metadataRevision});
  assert.equal(updated.status, 200);
  assert.equal(f.song().lyrics, '[00:00.00]新入口歌词');
  assert.equal(await readFile(path.join(f.store.get('package:song'), '歌词.lrc'), 'utf8'), f.song().lyrics);
  const oldAsset = await fetch(`${f.base}/api/assets/song/lyrics?r=${oldRevision}`, {headers:{Authorization:'Bearer contracts-test-password'}});
  assert.equal(await oldAsset.text(), '[00:00.00]旧入口新歌词');
  const before = f.song(), directory = f.store.get('package:song'), hashes = await f.packageHash();
  f.store.db.exec("CREATE TEMP TRIGGER reject_test_lyrics BEFORE UPDATE OF lyrics ON songs WHEN NEW.lyrics LIKE '%reject-test%' BEGIN SELECT RAISE(ABORT,'Simulated publication failure'); END;");
  const failed = await f.request('/admin/songs/song/lyrics', {lyrics:'[00:00.00]reject-test', expectedRevision:before.metadataRevision}, 'PUT');
  assert.equal(failed.status, 400);
  assert.match(failed.data.error, /Simulated publication failure/);
  assert.equal(f.store.get('package:song'), directory);
  assert.equal(f.song().lyrics, before.lyrics);
  assert.equal(f.song().resourceRevision, before.resourceRevision);
  assert.deepEqual(await f.packageHash(), hashes);
  assert.equal(resourceManifest(f.store, f.song(), f.cache).lyrics, true);
  const revisions = await readdir(path.join(f.store.get('package-base:song'), '资源版本'));
  assert.equal(revisions.length, 3, 'failed publication must remove its staged directory');
});
