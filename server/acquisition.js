import path from 'node:path';
import {stat,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {canonicalVideo,onlineSearch,downloadVideo} from './sources.js';
import {run} from './process.js';
import {importMedia,importKey} from './library.js';
import {prepareSong,probe} from './media.js';
import {separateSong} from './separation.js';

const normalized=value=>String(value||'').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
export function matchCandidates(items,title,artist,video=false){
  const song=normalized(title),singer=normalized(artist);
  return items.filter(item=>{
    const name=normalized(item.title);
    return song&&singer&&name.includes(song)&&name.includes(singer)&&
      !/翻唱|串烧|教学|教程|reaction|cover\b/i.test(item.title)&&
      (!video||/\bMV\b|官方.*视频|official.*video|music video/i.test(item.title));
  }).sort((a,b)=>Number(/伴奏|instrumental|karaoke/i.test(b.title))-Number(/伴奏|instrumental|karaoke/i.test(a.title)));
}

async function candidates(title,artist,video,search=onlineSearch){
  const results=await Promise.allSettled(['bilibili','youtube'].map(provider=>search(`${artist} ${title}${video?' 官方 MV':''}`,provider)));
  const items=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
  return matchCandidates(items,title,artist,video);
}

export async function acquireSong(payload,{store,downloads,roots,outputs,search=onlineSearch}){
  const title=String(payload.metadata?.title||payload.title||'').trim();
  const artist=String(payload.metadata?.artist||payload.artist||'').trim();
  if(!title||!artist||artist==='未知歌手')return {review:'请补充歌手与歌名，以免自动下载同名歌曲。',metadata:{title,artist}};
  const found=payload.sourceUrl?[{url:canonicalVideo(payload.sourceUrl),title:`${artist} ${title}`}]:await candidates(title,artist,false,search);
  if(!found.length)return {review:'未找到可靠匹配。请补充资源链接，或检查歌手、歌名后重试。',metadata:{title,artist}};
  let last;
  for(const candidate of found.slice(0,3)){
    try{
      await mkdir(downloads,{recursive:true});const id=createHash('sha256').update(canonicalVideo(candidate.url)).digest('hex').slice(0,24);
      const file=path.join(downloads,id+'.m4a');
      try{await stat(file);}catch{
        await run(process.env.YTDLP||'yt-dlp',['--ignore-config','--no-playlist','--socket-timeout','20','--retries','2','--max-filesize','200M','-x','--audio-format','m4a','-o',path.join(downloads,id+'.%(ext)s'),'--',canonicalVideo(candidate.url)],900000);
      }
      const mode=/伴奏|instrumental|karaoke/i.test(candidate.title)?'instrumental':'original';
      const songId=await importMedia(store,file,downloads,roots[0],{title,artist,tags:[],mode,metadata_source:'点歌信息',needs_review:0});
      store.set('source:'+songId,{url:candidate.url,title:candidate.title});
      await prepareSong(store,songId,[...roots,downloads],outputs);
      const song=store.db.prepare('SELECT * FROM songs WHERE id=?').get(songId);
      if(mode==='original'&&store.get('ai',{}).enabled)await separateSong(store,song,outputs);
      return {id:songId,title,artist};
    }catch(error){last=error;}
  }
  return {review:'资源处理失败：'+(last?.message||'请检查下载源'),metadata:{title,artist}};
}

export async function findVideo(payload,{store,downloads,outputs,search=onlineSearch}){
  const song=store.db.prepare('SELECT * FROM songs WHERE id=?').get(payload.id);
  if(!song||!song.needs_video)return {};
  const found=await candidates(song.title,song.artist,true,search);
  for(const candidate of found.slice(0,2)){
    try{
      const {file}=await downloadVideo(candidate.url,downloads);const info=await probe(file);if(!info.hasVideo)continue;
      const folder=path.join(outputs,'mtv-candidates',song.id);await mkdir(folder,{recursive:true});
      const target=path.join(folder,path.basename(file));await copyFile(file,target);
      store.set(importKey(file,await stat(file)),song.id);
      store.set('mtv-candidate:'+song.id,{path:target,url:candidate.url,duration:info.duration});
      return {review:'已找到 MTV 候选并保存到正式曲库。请试听确认版本与节奏后，在歌曲编辑页关联视频。',metadata:{title:song.title,artist:song.artist},candidatePath:target};
    }catch{}
  }
  return {review:'暂未找到可用 MTV。音频版本已正式入库，可以继续唱；请在歌曲编辑页补充视频。',metadata:{title:song.title,artist:song.artist}};
}
