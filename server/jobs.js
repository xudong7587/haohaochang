import path from 'node:path';
import {stat,writeFile} from 'node:fs/promises';
import {migrateSongAssets} from './assets.js';
import {acquireSong,findVideo} from './acquisition.js';
import {enrichSong} from './enrichment.js';
import {favoritePage} from './favorites.js';
import {metadata,importMedia} from './library.js';
import {downloadVideo,prepareSong,scanLibrary,searchText} from './media.js';
import {separateSong} from './separation.js';

// Persistent scheduling belongs to app; each domain implements its own operation.
export async function runJob(job,payload,context){
  const {db,get,set,store,dir,roots,downloads,cache,legacyCache,emit,addJob,enqueue,fail}=context;
      if(payload.id)await migrateSongAssets(payload.id,legacyCache,cache);
      if(job.kind==='acquire'||job.kind==='find-video'){
        const result=await (job.kind==='acquire'?acquireSong:findVideo)(payload,{store,downloads,roots,outputs:cache});
        if(result.review){db.prepare("UPDATE jobs SET status='review',payload=?,error=? WHERE id=?").run(JSON.stringify({...payload,metadata:result.metadata,candidatePath:result.candidatePath}),result.review,job.id);emit('library',{});emit();return 'review';}
        if(result.id){if(payload.enqueue)enqueue(result.id,payload.name||'在线点歌');addJob('find-video',{id:result.id,title:result.title,artist:result.artist});}
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
        const sourceInfo=await stat(payload.file);if(payload.signature!==sourceInfo.size+':'+sourceInfo.mtimeMs)throw fail(409,'下载文件仍在变化，等待下次检查');
        let meta=payload.approved?payload.metadata:await metadata(payload.file,[downloads]);
        if(!payload.approved&&payload.title){const match=payload.title.match(/^(.{1,50}?)\s+[-–—]\s+(.+)$/);meta={...meta,title:match?match[2]:payload.title,artist:match?match[1]:'未知歌手',needs_review:match?0:1};}
        if(!payload.approved&&get('enrichment',{}).enabled)meta={...meta,...await enrichSong(get('enrichment'),{title:payload.title||meta.title,artist:meta.artist,tags:meta.tags,sourceUrl:payload.sourceUrl||''})};
        if(meta.needs_review){db.prepare("UPDATE jobs SET status='review',payload=?,error=? WHERE id=?").run(JSON.stringify({...payload,metadata:meta}),meta.note||'请补充歌手、歌名后继续',job.id);emit('library',{});return 'review';}
        if(payload.isBacking)meta.mode='instrumental';
        const id=await importMedia(store,payload.file,downloads,roots[0],meta);
        db.prepare('UPDATE songs SET evidence=? WHERE id=?').run(JSON.stringify(meta.evidence||[]),id);
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
        const {file}=await downloadVideo(payload.url,downloads);const info=await stat(file);
        addJob('import',{file,signature:info.size+':'+info.mtimeMs,title:payload.title,sourceUrl:payload.url,enqueue:payload.enqueue,name:payload.name,isBacking:payload.isBacking});
      }
}
