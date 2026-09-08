import {packageDir} from './song-package.js';
import {replaceVideo} from './video-replacement.js';
import {identifyTitle} from '../shared/catalog.js';
import {findLyrics} from './lyrics-source.js';
import {sourceMetadata,withBiliCookie} from './sources.js';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {stat,writeFile,copyFile} from 'node:fs/promises';
import {migrateSongAssets} from './assets.js';
import {acquireSong,findVideo} from './acquisition.js';
import {enrichSong} from './enrichment.js';
import {favoritePage} from './favorites.js';
import {metadata,importMedia,importKey} from './library.js';
import {downloadVideo,prepareSong,scanLibrary,searchText} from './media.js';
import {separateSong} from './separation.js';

// Persistent scheduling belongs to app; each domain implements its own operation.
export async function runJob(job,payload,context){
  const {db,get,set,store,dir,roots,downloads,cache,legacyCache,emit,addJob,enqueue,fail}=context;
      if(payload.id)await migrateSongAssets(payload.id,legacyCache,cache);
      if(job.kind==='organize'){
        let song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.id);if(!song)throw fail(404,'歌曲不存在');
        let meta=payload.approved?payload.metadata:{title:song.title,artist:song.artist,lyrics:song.lyrics,needs_review:song.needs_review};
        if(!payload.approved&&(meta.needs_review||meta.artist==='未知歌手')){
          meta={...meta,...identifyTitle(song.artist+' - '+song.title)};
          if(meta.needs_review&&get('enrichment',{}).enabled)meta={...meta,...await enrichSong(get('enrichment'),song)};
        }
        if(!meta.needs_review&&!meta.lyrics){try{const result=await findLyrics(meta.title,meta.artist,song.duration);meta.lyrics=result.lyrics;set('lyrics-match:'+song.id,{...result,lyrics:undefined,status:'candidate'});}catch{}}
        if(meta.needs_review||!meta.lyrics){db.prepare("UPDATE jobs SET status='review',payload=?,error=? WHERE id=?").run(JSON.stringify({...payload,metadata:meta}),meta.needs_review?'请核对歌名和歌手后继续':'未找到匹配歌词，请补充 LRC 后继续',job.id);return 'review';}
        db.prepare('UPDATE songs SET title=?,artist=?,search=?,lyrics=?,needs_review=0 WHERE id=?').run(meta.title,meta.artist,searchText(meta.title,meta.artist),meta.lyrics,song.id);
        await prepareSong(store,song.id,[...roots,downloads],cache);song=db.prepare('SELECT * FROM songs WHERE id=?').get(song.id);
        if(song.mode==='original'){if(!get('ai',{}).enabled){db.prepare("UPDATE jobs SET status='review',payload=?,error=? WHERE id=?").run(JSON.stringify({...payload,metadata:meta}),'信息和歌词已整理，请连接 PC 分离服务后继续',job.id);return 'review';}await separateSong(store,song,cache);}
        if(song.needs_video)addJob('find-video',{id:song.id});
      }
      if(job.kind==='acquire'||job.kind==='find-video'){
        const result=await (job.kind==='acquire'?acquireSong:findVideo)(payload,{store,downloads,roots,outputs:cache});
        if(result.review){db.prepare("UPDATE jobs SET status='review',payload=?,error=? WHERE id=?").run(JSON.stringify({...payload,metadata:result.metadata,candidatePath:result.candidatePath}),result.review,job.id);emit('library',{});emit();return 'review';}
        if(result.id){if(payload.enqueue)enqueue(result.id,payload.name||'在线点歌');addJob('find-video',{id:result.id,title:result.title,artist:result.artist});}
      }
      if(job.kind==='attach-video'){
        const song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.id);if(!song)throw fail(404,'歌曲不存在');
        if(db.prepare('SELECT id FROM queue WHERE song_id=?').get(song.id))throw fail(409,'请先移出播放队列');
        const {file}=await withBiliCookie(get('favorites',{}).cookie,dir,file=>downloadVideo(payload.url,downloads,file));
        const replacement=await replaceVideo(store,song,file,payload.url,cache);
        if(!replacement.keepAudio)addJob('organize',{id:song.id});
      }
      if(job.kind==='enrich'){
        const song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.existingId);if(!song)throw fail(404,'歌曲不存在');
        if(song.metadata_source!=='手动'||payload.approved){
          const meta=payload.approved?payload.metadata:await enrichSong(get('enrichment',{}),{title:song.title,artist:song.artist,tags:JSON.parse(song.tags)});
          if(meta.needs_review){db.prepare("UPDATE jobs SET status='review',payload=?,error=? WHERE id=?").run(JSON.stringify({...payload,metadata:meta}),meta.note||'AI 信息需要核对',job.id);emit('library',{});return 'review';}
          db.prepare('UPDATE songs SET title=?,artist=?,search=?,tags=?,metadata_source=?,needs_review=0,evidence=? WHERE id=?').run(meta.title,meta.artist,searchText(meta.title,meta.artist),JSON.stringify(song.tags_manual?JSON.parse(song.tags):meta.tags),payload.approved?'手动':'AI',JSON.stringify(meta.evidence||[]),song.id);
          if(!db.prepare('SELECT id FROM queue WHERE song_id=?').get(song.id))addJob('prepare',{id:song.id});
        }
      }
      if(job.kind==='favorite-sync'){
        const config=get('favorites',{});if(!config.favoriteId)throw fail(400,'请先配置收藏夹');
        let page=get('favorite-page:'+config.favoriteId,1);
        for(let n=0;n<5;n++){
          const result=await favoritePage(config,page);
          for(const item of result.items){const key='favorite-seen:'+config.favoriteId+':'+item.bvid;if(!get(key)){const id=addJob('favorite-download',item);set(key,id);}}
          page++;if(!result.hasMore){page=1;break;}
        }
        set('favorite-page:'+config.favoriteId,page);set('favorite-last',Date.now());
      }
      if(job.kind==='favorite-download'){
        let cookieFile;const cookie=get('favorites',{}).cookie;
        if(cookie){cookieFile=path.join(dir,'bilibili.cookies.txt');const lines=cookie.split(';').map(v=>v.trim()).filter(v=>v.includes('=')).map(v=>{const n=v.indexOf('=');return '.bilibili.com\tTRUE\t/\tTRUE\t0\t'+v.slice(0,n)+'\t'+v.slice(n+1);});await writeFile(cookieFile,'# Netscape HTTP Cookie File\n'+lines.join('\n'),{mode:0o600});}
        const {file}=await downloadVideo(payload.url,downloads,cookieFile);const info=await stat(file);
        addJob('import',{file,signature:info.size+':'+info.mtimeMs,title:payload.title,sourceUrl:payload.url,enqueue:payload.enqueue,name:payload.name});
      }
      if (job.kind === 'import') {
        if(payload.replacementUrl){
          const originalFile=payload.file,originalInfo=await stat(originalFile);
          const replacement=await withBiliCookie(get('favorites',{}).cookie,dir,cookieFile=>downloadVideo(payload.replacementUrl,downloads,cookieFile));
          const downloaded=await stat(replacement.file);
          set(importKey(originalFile,originalInfo),'replaced-by:'+job.id);
          payload={...payload,file:replacement.file,signature:downloaded.size+':'+downloaded.mtimeMs,sourceUrl:payload.replacementUrl,replacementUrl:undefined,metadata:{...payload.metadata,lyrics:''}};
          db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(payload),job.id);
        }
        const sourceInfo=await stat(payload.file);if(payload.signature!==sourceInfo.size+':'+sourceInfo.mtimeMs)throw fail(409,'下载文件仍在变化，等待下次检查');
        let meta=payload.approved?payload.metadata:await metadata(payload.file,[downloads]);
        if(!payload.approved){
          let videoTitle=payload.title;
          const bv=path.basename(payload.file).match(/(BV[a-zA-Z0-9]+).*S\d+E(\d+)/i);
          if(!videoTitle&&bv){try{const info=await sourceMetadata('https://www.bilibili.com/video/'+bv[1]+'?p='+Number(bv[2]),get('favorites',{}).cookie);videoTitle=info.title;}catch{}}
          if(videoTitle)meta={...meta,...identifyTitle(videoTitle)};
        }
        if(!payload.approved&&get('enrichment',{}).enabled)meta={...meta,...await enrichSong(get('enrichment'),{title:payload.title||meta.title,artist:meta.artist,tags:meta.tags,sourceUrl:payload.sourceUrl||''})};
        let lyrics=meta.lyrics||'';
        if(!lyrics){try{lyrics=await readFile(path.join(path.dirname(payload.file),path.parse(payload.file).name+'.lrc'),'utf8');}catch{}}
        if(!lyrics&&!meta.needs_review){try{lyrics=(await findLyrics(meta.title,meta.artist,(await (await import('./media.js')).probe(payload.file)).duration)).lyrics;}catch{}}
        meta.lyrics=lyrics;
        if(!lyrics){meta.needs_review=1;meta.note='缺少歌词，请自动查找或导入 LRC 后继续';}
        if(meta.needs_review){db.prepare("UPDATE jobs SET status='review',payload=?,error=? WHERE id=?").run(JSON.stringify({...payload,metadata:meta}),meta.note||'请补充歌手、歌名后继续',job.id);emit('library',{});return 'review';}
        if(payload.isBacking)meta.mode='instrumental';
        if((meta.mode==='instrumental'||!get('ai',{}).enabled)&&!['tracks','channels'].includes(meta.mode)){
          db.prepare("UPDATE jobs SET status='review',payload=?,error=? WHERE id=?").run(JSON.stringify({...payload,metadata:meta}),meta.mode==='instrumental'?'仅有伴奏，仍需补充原唱资源':'请先配置 PC 或云端分离服务，再继续制作双版本',job.id);return 'review';
        }
        const id=await importMedia(store,payload.file,downloads,roots[0],meta);
        db.prepare('UPDATE songs SET evidence=?,lyrics=? WHERE id=?').run(JSON.stringify(meta.evidence||[]),meta.lyrics||'',id);
        await prepareSong(store,id,[...roots,downloads,path.join(dir,'downloads')],cache);
        const song=db.prepare('SELECT * FROM songs WHERE id=?').get(id);
        if(song.mode==='original'&&get('ai',{}).enabled)await separateSong(store,song,cache);
        if(payload.enqueue)enqueue(id,payload.name||'在线点歌');
      }
      if (job.kind === 'scan') await scanLibrary(store, roots);
      if (job.kind === 'prepare') {
        db.prepare("UPDATE songs SET status='preparing',error='' WHERE id=?").run(payload.id);
        let song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.id);
        await prepareSong(store, payload.id, [...roots, downloads,path.join(dir,'downloads')], cache);
        song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.id);
        if(song.mode==='original'&&get('ai',{}).enabled&&!JSON.parse(db.prepare('SELECT payload FROM jobs WHERE id=?').get(job.id).payload).ambientOnly) await separateSong(store,song,cache);
        const latest=JSON.parse(db.prepare('SELECT payload FROM jobs WHERE id=?').get(job.id).payload);
        if(latest.enqueue)enqueue(payload.id,latest.name||'家人');
      }
      if (job.kind === 'download') {
        const {file}=await withBiliCookie(get('favorites',{}).cookie,dir,file=>downloadVideo(payload.url,downloads,file));const info=await stat(file);
        addJob('import',{file,signature:info.size+':'+info.mtimeMs,title:payload.title,sourceUrl:payload.url,enqueue:payload.enqueue,name:payload.name,isBacking:payload.isBacking});
      }
}
