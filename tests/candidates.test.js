import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createSourceCandidate,metadataFromCandidate} from '../shared/source-candidate.js';
import {previewSourceCandidate} from '../server/sources.js';
import {findVideo} from '../server/acquisition.js';
import {bilibiliProvider} from '../server/providers/bilibili.js';

const url='https://www.bilibili.com/video/BV1gF4m1K7Aa?p=14';
test('preview candidate survives JSON/download/import without losing episode identity',async()=>{
 const candidate=await previewSourceCandidate(url,'',{metadata:async()=>({url,title:'可爱女人',videoTitle:'周杰伦 MV 合集',uploader:'某上传者',duration:240})});
 assert.equal(candidate.page,14);assert.equal(candidate.identity.artist,'周杰伦');assert.equal(candidate.externalTitle,'可爱女人');
 assert.equal(candidate.identity.needs_review,0);assert.equal(candidate.duration,240);
 const metadata=metadataFromCandidate(JSON.parse(JSON.stringify(candidate)));
 assert.equal(metadata.artist,'周杰伦');assert.equal(metadata.title,'可爱女人');
 assert.deepEqual(metadata.sourceCandidate,candidate);assert.equal(metadata.evidence[0].videoTitle,'周杰伦 MV 合集');
});
test('live and cover metadata are never silently confirmed from catalog title',()=>{
 for(const suffix of ['现场','翻唱','live','cover']){
  const candidate=createSourceCandidate({url,title:`周杰伦 可爱女人 ${suffix}`});
  assert.equal(candidate.identity.needs_review,1);assert.ok(candidate.reviewReasons.includes('recording-version-needs-review'));
 }
 assert.throws(()=>createSourceCandidate({url:'https://example.com/video.mp4'}));
 const parentLive=createSourceCandidate({url,title:'周杰伦 可爱女人',videoTitle:'现场合集'});
 assert.equal(parentLive.identity.needs_review,1);assert.equal(parentLive.identity.version,'live');
});
test('Bilibili adapter uses the requested episode and rejects a missing page',async()=>{
 const fetcher=async()=>({ok:true,json:async()=>({code:0,data:{title:'周杰伦合集',owner:{name:'上传者'},duration:1000,pages:[{page:1,part:'晴天',duration:200},{page:14,part:'可爱女人',duration:240}]}})});
 const info=await bilibiliProvider.metadata(url,'',fetcher);assert.equal(info.title,'可爱女人');assert.equal(info.duration,240);
 await assert.rejects(bilibiliProvider.metadata(url.replace('p=14','p=15'),'',fetcher),/分 P 不存在/);
});

async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'ktv-candidates-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const downloads=path.join(dir,'downloads'),outputs=path.join(dir,'outputs');await mkdir(downloads);await mkdir(outputs);
 const song={id:'isolated-song',title:'可爱女人',artist:'周杰伦',needs_video:1,duration:240};
 const entries=new Map(),calls={search:0,download:0};
 const store={db:{prepare:()=>({get:()=>song})},get:(key,fallback)=>entries.has(key)?entries.get(key):fallback,set:(key,value)=>entries.set(key,value)};
 const context={store,downloads,outputs,search:async()=>{calls.search++;return [{url,title:'周杰伦 可爱女人 官方 MV'}];},download:async selected=>{calls.download++;assert.equal(selected,url);const file=path.join(downloads,'selected.mp4');await writeFile(file,'isolated fake video');return {file};},inspect:async()=>({duration:240,hasVideo:true})};
 return {dir,song,context,calls,entries};
}
test('explicit URL goes to review once; confirm reuses staged file without searching/downloading',async t=>{
 const {song,context,calls}=await fixture(t);
 const review=await findVideo({id:song.id,url},context);
 assert.equal(calls.search,0);assert.equal(calls.download,1);assert.ok(review.review);assert.equal(review.candidate.page,14);
 const result=await findVideo({id:song.id,candidatePath:review.candidatePath,candidate:review.candidate,action:'confirm',offset:1.25},context);
 assert.equal(result.file,review.candidatePath);assert.equal(result.sourceUrl,url);assert.equal(result.offset,1.25);assert.equal(result.confirmed,true);
 assert.equal(result.review,undefined);assert.equal(calls.search,0);assert.equal(calls.download,1);
});
test('candidate path without source URL is usable and stays within staged/download roots',async t=>{
 const {song,context,calls,dir}=await fixture(t),file=path.join(context.downloads,'local.mp4');await writeFile(file,'video');
 const result=await findVideo({id:song.id,candidatePath:file,approved:true},context);
 assert.equal(result.file,file);assert.equal(result.candidate.provider,'local');assert.equal(calls.search,0);assert.equal(calls.download,0);
 const outside=path.join(dir,'unapproved.mp4');await writeFile(outside,'video');
 await assert.rejects(findVideo({id:song.id,candidatePath:outside,approved:true},context),/挂载目录/);
});
test('reject does no network work; research is a separate action and skips rejected candidate',async t=>{
 const {song,context,calls,entries}=await fixture(t);
 const review=await findVideo({id:song.id,url},context);
 assert.deepEqual(await findVideo({id:song.id,action:'reject'},context),{rejected:true});
 assert.equal(entries.get('mtv-candidate:'+song.id),null);assert.equal(calls.search,0);assert.equal(calls.download,1);
 await assert.rejects(findVideo({id:song.id,action:'confirm'},context),/先选择候选/);
 const research=await findVideo({id:song.id,action:'research',candidate:review.candidate,candidatePath:review.candidatePath},context);
 assert.ok(research.review);assert.equal(research.candidatePath,undefined);assert.ok(calls.search>0);assert.equal(calls.download,1);
});
test('failed explicit URL does not switch silently to a searched recording',async t=>{
 const {song,context,calls}=await fixture(t);context.download=async()=>{throw new Error('download failed');};
 await assert.rejects(findVideo({id:song.id,url,confirmed:true},context),/download failed/);assert.equal(calls.search,0);
});
