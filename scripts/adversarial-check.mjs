// Diagnostic observations, not regression assertions of desired behavior.
// Uses fresh temporary data and loopback mocks; never opens the user's library.
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createApp} from '../server/app.js';import {runJob} from '../server/jobs.js';
import {findVideo} from '../server/acquisition.js';
import {run,prepareSong} from '../server/media.js';import {packageDir} from '../server/song-package.js';
import ffmpeg from 'ffmpeg-static';import ffprobe from 'ffprobe-static';
process.env.FFMPEG=ffmpeg;process.env.FFPROBE=ffprobe.path;
const root=await mkdtemp(path.join(os.tmpdir(),'ktv-adversarial-'));
const media=path.join(root,'media'),downloads=path.join(root,'downloads');await mkdir(media);
const instance=createApp({dataDir:path.join(root,'data'),roots:[media],downloads,adminToken:'isolated-review-password',worker:false});
const {store,addJob}=instance,{db,get,set}=store;const cache=path.join(media,'好好唱播放资源');
const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;const headers={Authorization:'Bearer isolated-review-password','Content-Type':'application/json'};
const observations=[];
const realFetch=globalThis.fetch;
async function api(route,body,method=body?'POST':'GET'){const r=await fetch(base+'/api'+route,{headers,method,...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
function seed(id,mode='separated'){db.prepare('INSERT INTO songs (id,path,title,artist,mode,status,lyrics,duration,created) VALUES (?,?,?,?,?,?,?,?,?)').run(id,path.join(media,id+'.m4a'),'测试歌曲','测试歌手',mode,'ready','[00:00]旧歌词',2,Date.now());return db.prepare('SELECT * FROM songs WHERE id=?').get(id);}
try{
 const id='a'.repeat(24);seed(id);set('package-ready:'+id,true);
 const list=await api('/admin/library'),manifest=await api('/playback-assets/'+id);
 observations.push({id:'R1',case:'missing files',tier:list.data[0].tier,assets:manifest.data});
 await api('/admin/library/'+id,{},'DELETE');const queue=await api('/queue',{songId:id});
 observations.push({id:'R6',case:'hidden song can still enqueue',status:queue.status,queueLength:queue.data.queue?.length});db.exec('DELETE FROM queue');
 const song=seed('b'.repeat(24));const dir=await packageDir(store,song,cache);await writeFile(path.join(dir,'歌词.lrc'),song.lyrics);
 await api('/admin/songs/'+song.id+'/lyrics',{lyrics:'[00:00]新歌词'},'PUT');
 observations.push({id:'R5',case:'legacy lyrics save',dbLyrics:db.prepare('SELECT lyrics FROM songs WHERE id=?').get(song.id).lyrics,fileLyrics:await readFile(path.join(dir,'歌词.lrc'),'utf8')});
 const prepareId=addJob('prepare',{id:song.id});db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(prepareId);
 const edit=await api('/admin/library/'+song.id+'/save',{title:'处理时修改','artist':'测试歌手',lyrics:'[00:00]正在改'});
 const attach=await api('/admin/library/'+song.id+'/source',{url:'https://www.bilibili.com/video/BV1gF4m1K7Aa'});
 observations.push({id:'R2',case:'concurrent mutation admitted',prepareStatus:'running',metadataSave:edit.status,attachAccepted:attach.status,jobs:db.prepare('SELECT kind,status FROM jobs').all()});
 db.exec('DELETE FROM jobs');
 const audio=seed('c'.repeat(24));db.prepare('UPDATE songs SET needs_video=1 WHERE id=?').run(audio.id);
 await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','aac',audio.path]);
 const adir=await packageDir(store,audio,cache);await writeFile(path.join(adir,'伴奏.m4a'),'old backing marker');await prepareSong(store,audio.id,[media],cache);
 const url='https://www.bilibili.com/video/BV1gF4m1K7Aa';const cached=path.join(downloads,createHash('sha256').update(url).digest('hex').slice(0,24)+'.mp4');
 await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=s=64x64:d=2','-f','lavfi','-i','sine=frequency=880:duration=2','-c:v','libx264','-c:a','aac','-shortest',cached]);
 await runJob({kind:'attach-video'},{id:audio.id,url},{db,get,set,store,dir:path.join(root,'data'),roots:[media],downloads,cache,legacyCache:path.join(root,'legacy'),emit:()=>{},addJob:()=>{},fail:(s,m)=>new Error(m)});
 const after=db.prepare('SELECT * FROM songs WHERE id=?').get(audio.id);await prepareSong(store,audio.id,[media],cache);
 observations.push({id:'R3',case:'attach video replaces audio source',pathChanged:after.path!==audio.path,modeAfterAttach:after.mode,statusAfterAttach:after.status,manifestAfterPrepare:(await api('/playback-assets/'+audio.id)).data,backingPreservedUnchanged:(await readFile(path.join(adir,'伴奏.m4a'),'utf8'))==='old backing marker'});
 db.prepare('UPDATE songs SET needs_video=1 WHERE id=?').run(audio.id);const queries=[];
 const retried=await findVideo({id:audio.id,sourceUrl:url,candidatePath:cached,approved:true},{store,downloads,outputs:cache,search:async(q,provider)=>{queries.push(provider);return [];}});
 observations.push({id:'R4',case:'reviewed MV link ignored on retry',searches:queries,stillReview:!!retried.review});
 globalThis.fetch=(input,options)=>String(input).startsWith('https://api.bilibili.com/x/web-interface/view')?Promise.resolve(Response.json({code:0,data:{title:'周杰伦MV合集',duration:4,owner:{name:'上传者'},pages:[{page:1,part:'可爱女人',duration:2},{page:2,part:'其他分集',duration:2}]}})):realFetch(input,options);
 const preview=await api('/admin/source-info',{url});const added=await api('/admin/inbox-link',{url});
 const queuedPayload=JSON.parse(db.prepare('SELECT payload FROM jobs WHERE id=?').get(added.data.id).payload);
 const importPayload={file:cached,title:queuedPayload.title,sourceUrl:url,signature:''};
 const {stat}=await import('node:fs/promises');const fileInfo=await stat(cached);importPayload.signature=fileInfo.size+':'+fileInfo.mtimeMs;
 const importId=addJob('import',importPayload);
 await runJob({id:importId,kind:'import'},importPayload,{db,get,set,store,dir:path.join(root,'data'),roots:[media],downloads,cache,legacyCache:path.join(root,'legacy'),emit:()=>{},addJob:()=>{},fail:(s,m)=>new Error(m)});
 const review=JSON.parse(db.prepare('SELECT payload FROM jobs WHERE id=?').get(importId).payload);
 observations.push({id:'R7',case:'MV preview identity lost during download/import',previewArtist:preview.data.artist,previewNeedsReview:preview.data.needs_review,importArtist:review.metadata.artist,importNeedsReview:review.metadata.needs_review});
 if(process.env.PLAYWRIGHT_MODULE){
  const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  try{
   const draft=seed('d'.repeat(24),'original');db.prepare('UPDATE songs SET title=? WHERE id=?').run('浏览器草稿旧',draft.id);
   const p=await browser.newPage();await p.addInitScript(({admin,room})=>{sessionStorage.setItem('adminToken',admin);localStorage.setItem('roomToken',room);},{admin:'isolated-review-password',room:get('roomToken')});
   await p.goto(base+'/admin');await p.locator('article').filter({hasText:'浏览器草稿旧'}).getByRole('button',{name:'编辑歌曲',exact:true}).click();
   db.prepare('UPDATE songs SET title=? WHERE id=?').run('后台刷新后',draft.id);await p.getByRole('button',{name:'刷新列表',exact:true}).click();await p.getByText('后台刷新后',{exact:true}).waitFor();
   const value=await p.getByLabel('歌名',{exact:true}).inputValue();await p.getByRole('button',{name:'仅保存信息',exact:true}).click();await p.getByText('已保存信息',{exact:true}).waitFor();
   observations.push({id:'R9',case:'refreshed header retains stale editable draft',headerAfterRefresh:'后台刷新后',draftAfterRefresh:value,dbAfterSave:db.prepare('SELECT title FROM songs WHERE id=?').get(draft.id).title});
  }finally{await browser.close();}
 }
 const report={scope:'isolated diagnostic; observations are current defects, not passing acceptance tests',observations};
 await mkdir('test-results',{recursive:true});await writeFile('test-results/adversarial-review.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{globalThis.fetch=realFetch;instance.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
