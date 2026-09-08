import path from 'node:path';
import {stat} from 'node:fs/promises';
import {libraryTier,packageDir,present,savePackageInfo} from './song-package.js';
import {sourceMetadata,canonicalVideo} from './sources.js';
import {catalogSeed,identifyTitle,identifyVideo} from '../shared/catalog.js';
import {findLyrics} from './lyrics-source.js';
import {searchText,safeMedia} from './media.js';
import {filesUnder,importKey,metadata} from './library.js';
import {enrichSong} from './enrichment.js';
export function libraryApi({app,admin,member,store,cache,downloads,addJob,emit}){
 const {db,get,set}=store;
 const assertIdle=id=>{if(db.prepare("SELECT payload FROM jobs WHERE status IN ('queued','running')").all().some(j=>{const p=JSON.parse(j.payload);return p.id===id||p.existingId===id;}))throw new Error('歌曲正在整理，请等待当前任务结束');};
 app.post('/api/admin/library/:id/organize',admin,(req,res)=>{
  const song=db.prepare('SELECT * FROM songs WHERE id=?').get(req.params.id);if(!song)throw new Error('歌曲不存在');assertIdle(song.id);
  if(db.prepare('SELECT id FROM queue WHERE song_id=?').get(song.id))throw new Error('请先移出播放队列');
  res.json({id:addJob('organize',{id:song.id})});
 });
 app.post('/api/admin/refresh-metadata',admin,async(req,res)=>{
  const song=req.body.id?db.prepare('SELECT * FROM songs WHERE id=?').get(req.body.id):null;
  const title=String(req.body.title||song?.title||'').trim(),artist=String(req.body.artist||song?.artist||'').trim();
  let result;
  if(req.body.url){const source=await sourceMetadata(req.body.url,get('favorites',{}).cookie);result={...identifyVideo(source),sourceTitle:source.title,duration:source.duration};}
  else result=identifyTitle(title+' - '+artist);
  if(result.needs_review&&get('enrichment',{}).enabled)result=await enrichSong(get('enrichment'),{title,artist,sourceUrl:req.body.url||''});
  res.json({...result,note:result.needs_review?'无法可靠确认，请手动核对歌名和歌手':'已匹配歌名与歌手，保存后生效'});
 });
 app.get('/api/admin/library',admin,(req,res)=>res.json(db.prepare('SELECT * FROM songs ORDER BY created DESC').all().filter(s=>!get('hidden:'+s.id)).map(s=>({...s,tier:libraryTier(s),sourceUrl:get('video-source:'+s.id)?.url||get('source:'+s.id)?.url||'',folder:get('package:'+s.id,'尚未生成新格式')}))));
 app.get('/api/catalog',member,(req,res)=>{
  const q=String(req.query.q||'').toLowerCase();
  const entries=[...catalogSeed,...get('catalog',[])];
  const unique=[...new Map(entries.map(s=>[s.artist+'\0'+s.title,s])).values()];
  res.json(unique.filter(s=>searchText(s.title,s.artist).includes(q)).slice(0,300).map(s=>({...s,localId:db.prepare('SELECT id FROM songs WHERE title=? AND artist=? AND status=?').get(s.title,s.artist,'ready')?.id||null})));
 });
 app.post('/api/admin/catalog',admin,(req,res)=>{
  const rows=req.body.songs;if(!Array.isArray(rows)||rows.length>1000||rows.some(s=>typeof s.title!=='string'||typeof s.artist!=='string'||!s.title.trim()||!s.artist.trim()))throw new Error('请导入包含 title、artist 的 JSON 数组，每批最多 1000 首');
  set('catalog',[...get('catalog',[]),...rows.map(s=>({title:s.title.trim().slice(0,120),artist:s.artist.trim().slice(0,120)}))]);res.json({ok:true});
 });
 app.post('/api/admin/source-info',admin,async(req,res)=>{const info=await sourceMetadata(req.body.url,get('favorites',{}).cookie);let parsed=identifyVideo(info);if(parsed.needs_review&&get('enrichment',{}).enabled)parsed=await enrichSong(get('enrichment'),{title:info.title,sourceUrl:info.url});res.json({...info,...parsed});});
 app.get('/api/admin/inbox',admin,async(req,res)=>{
  const handled=db.prepare("SELECT payload FROM jobs WHERE kind='import' AND status IN ('review','running','queued')").all().map(j=>JSON.parse(j.payload).file);
  const rows=[];for(const file of (await filesUnder(downloads)).slice(0,500)){
   const info=await stat(file);if(get(importKey(file,info))||handled.includes(file))continue;
   rows.push({id:importKey(file,info),file,inbox:true,...await metadata(file,[downloads]),note:'下载工作区 · 等待信息完整和文件稳定',lyrics:''});
  }res.json(rows);
 });
 app.post('/api/admin/inbox',admin,async(req,res)=>{
  const file=await safeMedia(String(req.body.file||''),[downloads]),info=await stat(file);
  const title=String(req.body.title||'').trim().slice(0,120),artist=String(req.body.artist||'').trim().slice(0,120);
  if(!title||!artist||artist==='未知歌手')throw new Error('请填写歌名和歌手');
  const replacementUrl=req.body.sourceUrl?canonicalVideo(req.body.sourceUrl):undefined;
  res.json({id:addJob('import',{file,signature:info.size+':'+info.mtimeMs,replacementUrl,approved:true,metadata:{title,artist,lyrics:replacementUrl?'':String(req.body.lyrics||'').slice(0,25000),tags:[],needs_review:0,metadata_source:'手动'}})});
 });
 app.post('/api/admin/inbox-link',admin,async(req,res)=>{
  const url=canonicalVideo(req.body.url),info=await sourceMetadata(url,get('favorites',{}).cookie);
  res.json({id:addJob('download',{url,title:info.title,enqueue:false})});
 });
 app.post('/api/admin/migrate-packages',admin,(req,res)=>{
  const rows=db.prepare("SELECT id FROM songs WHERE status='ready'").all().filter(s=>!get('package-ready:'+s.id)&&!db.prepare('SELECT id FROM queue WHERE song_id=?').get(s.id));
  for(const row of rows)addJob('prepare',{id:row.id});res.json({count:rows.length});
 });
 app.post('/api/admin/find-lyrics',admin,async(req,res)=>res.json(await findLyrics(req.body.title,req.body.artist,Number(req.body.duration)||0)));
 app.get('/api/lyrics-style',member,(req,res)=>res.json(get('lyricsStyle',{font:'sans-serif',size:48,color:'#ffd66e',offset:0})));
 app.post('/api/admin/lyrics-style',admin,(req,res)=>{const v=req.body;const value={font:String(v.font||'sans-serif').replace(/[^\p{L}\p{N}\s,_-]/gu,'').slice(0,120),size:Math.max(24,Math.min(90,Number(v.size)||48)),color:/^#[a-f0-9]{6}$/i.test(v.color)?v.color:'#ffd66e',offset:Math.max(-10,Math.min(10,Number(v.offset)||0))};set('lyricsStyle',value);res.json(value);});
 app.get('/api/playback-assets/:id',member,async(req,res)=>{
  const song=db.prepare('SELECT * FROM songs WHERE id=?').get(req.params.id);if(!song)throw new Error('歌曲不存在');
  if(!get('package-ready:'+song.id))return res.json({version:1});
  const dir=await packageDir(store,song,cache);
  res.json({version:2,video:!song.needs_video&&await present(path.join(dir,'画面.mp4')),vocal:await present(path.join(dir,'原唱.m4a')),backing:await present(path.join(dir,'伴奏.m4a'))});
 });
 app.get('/api/assets/:id/:kind',member,async(req,res)=>{
  const names={video:'画面.mp4',vocal:'原唱.m4a',backing:'伴奏.m4a',lyrics:'歌词.lrc'};
  const song=db.prepare('SELECT * FROM songs WHERE id=?').get(req.params.id);if(!song||!names[req.params.kind])throw new Error('资源不存在');
  res.sendFile(await safeMedia(path.join(await packageDir(store,song,cache),names[req.params.kind]),[cache]));
 });
 app.post('/api/admin/library/:id/save',admin,async(req,res)=>{
  const song=db.prepare('SELECT * FROM songs WHERE id=?').get(req.params.id);if(!song)throw new Error('歌曲不存在');
  assertIdle(song.id);
  if(db.prepare('SELECT id FROM queue WHERE song_id=?').get(song.id))throw new Error('请先将歌曲移出播放队列');
  const title=String(req.body.title||'').trim().slice(0,120),artist=String(req.body.artist||'').trim().slice(0,120),lyrics=String(req.body.lyrics||'').slice(0,25000);
  if(!title||!artist)throw new Error('请填写歌名和歌手');
  db.prepare("UPDATE songs SET title=?,artist=?,search=?,lyrics=?,metadata_source='手动',needs_review=0 WHERE id=?").run(title,artist,searchText(title,artist),lyrics,song.id);
  await savePackageInfo(store,{...song,title,artist,lyrics},cache);
  if(req.body.prepare){if(!lyrics)throw new Error('信息已保存，请补充歌词后继续整理');addJob('prepare',{id:song.id});}
  emit('library',{});res.json({ok:true});
 });
 app.post('/api/admin/library/:id/source',admin,(req,res)=>{
  const song=db.prepare('SELECT * FROM songs WHERE id=?').get(req.params.id);if(!song)throw new Error('歌曲不存在');
  assertIdle(song.id);const url=canonicalVideo(req.body.url);
  if(db.prepare('SELECT id FROM queue WHERE song_id=?').get(song.id))throw new Error('请先移出播放队列');
  res.json({id:addJob('attach-video',{id:song.id,url})});
 });
 app.delete('/api/admin/library/:id',admin,(req,res)=>{
  if(db.prepare('SELECT id FROM queue WHERE song_id=?').get(req.params.id))throw new Error('请先移出播放队列');
  set('hidden:'+req.params.id,true);res.json({ok:true,note:'已从曲库隐藏，原始媒体保留，可恢复'});
 });
}
