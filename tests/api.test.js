import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { canonicalVideo, scanLibrary, searchText, inside } from '../server/media.js';
import { providerConfig, testProvider } from '../server/separation.js';

async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'ktv-test-')),root=path.join(dir,'media');await mkdir(root);
  const service=createApp({dataDir:path.join(dir,'data'),roots:[root],adminToken:'test-password-12345',worker:false});
  const server=service.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{service.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const call=async(url,body,method='GET',token=service.store.get('roomToken'))=>{const r=await fetch(base+'/api'+url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
  const seed=(id,title,status='ready')=>service.store.db.prepare('INSERT INTO songs (id,path,title,artist,search,created,status) VALUES (?,?,?,?,?,?,?)').run(id,path.join(root,id+'.mp4'),title,'测试歌手',searchText(title,'测试歌手'),Date.now(),status);
  return {...service,base,root,dir,call,seed};
}
test('authentication, admin isolation, cross-origin writes and UTF-8 token safety',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('/state',undefined,'GET','')).status,401);
  assert.equal((await fetch(f.base+'/api/state?token='+encodeURIComponent('你'.repeat(48)))).status,401);
  assert.equal((await f.call('/admin')).status,401);
  assert.equal((await f.call('/admin',undefined,'GET','test-password-12345')).status,200);
  assert.equal((await fetch(f.base+'/api/reactions',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json',Authorization:'Bearer '+f.store.get('roomToken')},body:'{"emoji":"👏"}'})).status,403);
});
test('queue deduplicates simultaneous requests and guards stale next',async t=>{
  const f=await fixture(t);f.seed('a','第一首');f.seed('b','第二首');f.seed('c','第三首');
  await Promise.all(Array.from({length:8},()=>f.call('/queue',{songId:'a'},'POST')));
  await f.call('/queue',{songId:'b'},'POST');await f.call('/queue',{songId:'c'},'POST');
  let state=(await f.call('/state')).data;assert.equal(state.queue.length,3);
  await f.call(`/queue/${state.queue[2].id}/top`,{},'POST');
  assert.deepEqual((await f.call('/state')).data.queue.map(q=>q.song_id),['a','c','b']);
  assert.equal((await f.call(`/queue/${state.queue[0].id}`,undefined,'DELETE')).status,409);
  const results=await Promise.all([f.call('/control',{action:'next',entryId:state.queue[0].id},'POST'),f.call('/control',{action:'next',entryId:state.queue[0].id},'POST')]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await f.call('/state')).data.queue.length,2);
});
test('first request prepares once, artist and pinyin search, audio fallback tagging',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.root,'周杰伦 - 晴天.mp3'),'fixture');await writeFile(path.join(f.root,'周杰伦 - 晴天.lrc'),'[00:01.00]测试歌词');
  assert.equal(await scanLibrary(f.store,[f.root]),1);assert.equal(await scanLibrary(f.store,[f.root]),0);
  const songs=(await f.call('/songs?q=qt')).data;assert.equal(songs.length,1);assert.equal(songs[0].needs_video,1);assert.match(songs[0].lyrics,/测试歌词/);
  await f.call('/queue',{songId:songs[0].id},'POST');await f.call('/queue',{songId:songs[0].id,name:'另一人'},'POST');
  const state=(await f.call('/state')).data;assert.equal(state.pending.length,1);assert.equal(state.queue.length,0);
  assert.equal((await f.call('/songs?q=%25')).data.length,0);
});
test('one active TV, ended event is idempotent, original-only cannot toggle',async t=>{
  const f=await fixture(t);f.seed('a','测试');await f.call('/queue',{songId:'a'},'POST');const entry=(await f.call('/state')).data.queue[0];
  assert.equal((await f.call('/player/heartbeat',{id:'tv1'},'POST')).status,200);
  assert.equal((await f.call('/player/heartbeat',{id:'tv2'},'POST')).status,409);
  assert.equal((await f.call('/player/ended',{playerId:'tv2',entryId:entry.id},'POST')).status,409);
  assert.equal((await f.call('/control',{action:'vocal',entryId:entry.id},'POST')).status,409);
  await f.call('/player/ended',{playerId:'tv1',entryId:entry.id},'POST');await f.call('/player/ended',{playerId:'tv1',entryId:entry.id},'POST');assert.equal((await f.call('/state')).data.queue.length,0);
});
test('provider secrets stay server-side and validation rejects malformed modes',async t=>{
  const f=await fixture(t),admin='test-password-12345';
  assert.equal((await f.call('/admin/ai',{enabled:true,endpoint:'http://separator:8000',model:'htdemucs',apiKey:'secret'},'POST',admin)).status,200);
  const data=(await f.call('/admin/ai',undefined,'GET',admin)).data;assert.equal(data.hasKey,true);assert.equal(data.apiKey,undefined);
  await f.call('/admin/ai',{enabled:true,endpoint:'http://separator:8000',model:'htdemucs',apiKey:''},'POST',admin);assert.equal(f.store.get('ai').apiKey,'secret');
  f.seed('a','测试');assert.equal((await f.call('/admin/songs/a',{title:'测试',artist:'我',mode:'channels',backing:0,vocal:0},'PATCH',admin)).status,400);
});
test('media Range streaming, room credential persists across restart',async t=>{
  const f=await fixture(t);const id='a'.repeat(24);f.seed(id,'测试');await writeFile(path.join(f.dir,'data','cache',id+'-vocal.mp4'),'0123456789');
  const response=await fetch(`${f.base}/api/media/${id}/backing?token=${f.store.get('roomToken')}`,{headers:{Range:'bytes=2-5'}});assert.equal(response.status,206);assert.equal(await response.text(),'2345');
  assert.equal((await fetch(`${f.base}/api/media/${id}/vocal`)).status,401);
});
test('URL allowlist and filesystem containment',()=>{
  assert.equal(canonicalVideo('https://youtu.be/abcdefghijk?x=1'),'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(canonicalVideo('https://www.bilibili.com/video/BV123abc/'),'https://www.bilibili.com/video/BV123abc');
  for(const url of ['http://youtube.com/watch?v=abcdefghijk','https://youtube.com.evil.test/watch?v=abcdefghijk','file:///etc/passwd','https://127.0.0.1/a','https://user:pass@youtube.com/watch?v=abcdefghijk','https://youtube.com:443/watch?v=oops'])assert.throws(()=>canonicalVideo(url));
  assert.equal(inside(path.resolve('/media'),path.resolve('/media2/a')),false);
  assert.throws(()=>providerConfig({enabled:true,endpoint:'https://example.com',model:''}));
});
