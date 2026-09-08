import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import ffmpeg from 'ffmpeg-static';import ffprobe from 'ffprobe-static';
import {openStore} from '../server/db.js';import {prepareSong,run} from '../server/media.js';
import {replaceVideo} from '../server/video-replacement.js';
process.env.FFMPEG=ffmpeg;process.env.FFPROBE=ffprobe.path;
test('replacing an MV publishes one active version, preserves usable audio, and rolls back failed candidates',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ktv-replace-'));const cache=path.join(root,'cache');await mkdir(cache);
 const store=openStore(path.join(root,'data'));t.after(()=>store.db.close());
 async function video(name,color,duration=2){const file=path.join(root,name+'.mp4');await run(ffmpeg,['-y','-v','error','-f','lavfi','-i',`color=c=${color}:s=64x64:d=${duration}`,'-f','lavfi','-i',`sine=frequency=440:duration=${duration}`,'-f','lavfi','-i',`sine=frequency=880:duration=${duration}`,'-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-c:a','aac','-shortest',file]);return file;}
 const source=await video('source','red'),candidate=await video('new','blue'),third=await video('third','green');
 const id='a'.repeat(24);store.db.prepare('INSERT INTO songs(id,path,title,artist,mode,backing,vocal,lyrics,created) VALUES(?,?,?,?,?,?,?,?,?)').run(id,source,'歌曲','歌手','tracks',0,1,'[00:00]原歌词',Date.now());
 await prepareSong(store,id,[root],cache);const initialDir=store.get('package:'+id);const original=await readFile(path.join(initialDir,'原唱.m4a')),backing=await readFile(path.join(initialDir,'伴奏.m4a'));
 const current=()=>store.db.prepare('SELECT * FROM songs WHERE id=?').get(id);
 assert.equal((await replaceVideo(store,current(),candidate,'test:new',cache)).keepAudio,true);
 let dir=store.get('package:'+id);assert.notEqual(dir,initialDir);assert.equal(current().path,source);assert.equal(current().mode,'tracks');
 assert.deepEqual(await readFile(path.join(dir,'原唱.m4a')),original);assert.deepEqual(await readFile(path.join(dir,'伴奏.m4a')),backing);assert.equal(current().lyrics,'[00:00]原歌词');
 const picture=await readFile(path.join(dir,'画面.mp4'));await prepareSong(store,id,[root],cache);assert.deepEqual(await readFile(path.join(dir,'画面.mp4')),picture);
 await replaceVideo(store,current(),third,'test:third',cache);dir=store.get('package:'+id);assert.notDeepEqual(await readFile(path.join(dir,'画面.mp4')),picture);assert.deepEqual(await readFile(path.join(dir,'原唱.m4a')),original);
 const mismatched=await video('long','white',8);await assert.rejects(replaceVideo(store,current(),mismatched,'test:wrong',cache),/时长不匹配/);assert.equal(store.get('package:'+id),dir);assert.equal(current().status,'ready');
 const pending='b'.repeat(24);store.db.prepare('INSERT INTO songs(id,path,title,artist,mode,lyrics,created) VALUES(?,?,?,?,?,?,?)').run(pending,third,'待整理','歌手','original','[00:00]旧录音歌词',Date.now());
 await prepareSong(store,pending,[root],cache);const old=store.db.prepare('SELECT * FROM songs WHERE id=?').get(pending);
 assert.equal((await replaceVideo(store,old,candidate,'test:replacement',cache)).keepAudio,false);
 const updated=store.db.prepare('SELECT * FROM songs WHERE id=?').get(pending);assert.notEqual(updated.path,old.path);assert.equal(updated.lyrics,'');assert.equal(updated.mode,'original');
 await assert.rejects(stat(path.join(store.get('package:'+pending),'伴奏.m4a')));assert.ok((await stat(old.path)).size>0);
});
