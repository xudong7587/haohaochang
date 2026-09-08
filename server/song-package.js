import path from 'node:path';
import {mkdir,stat,writeFile,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {run} from './process.js';
import {stageResources,requireFiles} from './resource-publication.js';
import {withSongWrite,publicationKey} from './song-writes.js';
import {inspectPackage,requireHealthyPackage} from './resource-health.js';
export const packageFolder='歌曲';
export async function packageDir(store,song,cache){
  let dir=store.get('package:'+song.id);
  if(!dir){dir=path.join(cache,packageFolder,song.id);store.set('package:'+song.id,dir);}
  await mkdir(dir,{recursive:true});return dir;
}
export async function present(file){try{return (await stat(file)).size>0;}catch{return false;}}
// Legacy metadata helper; HTTP classification uses resourceManifest.
export function libraryTier(song){
  if(song.needs_review||!song.title||!song.artist||song.artist==='未知歌手'||!song.lyrics?.trim()||song.status!=='ready'||!['separated','tracks','channels'].includes(song.mode))return 'pending';
  return song.needs_video?'audio':'standard';
}
export async function savePackageInfo(store,song,cache){
  const dir=await packageDir(store,song,cache);
  await writeFile(path.join(dir,'歌词.lrc'),song.lyrics||'');
  await inspectPackage(store,song,dir);
  await writeFile(path.join(dir,'歌曲信息.json'),JSON.stringify({version:2,id:song.id,title:song.title,artist:song.artist,metadataRevision:song.metadataRevision,resourceRevision:song.resourceRevision,tier:libraryTier(song),duration:song.duration,audioSource:song.path,videoSource:store.get('video-source:'+song.id),lyricsSource:store.get('lyrics-match:'+song.id),files:{video:'画面.mp4',original:'原唱.m4a',accompaniment:'伴奏.m4a',lyrics:'歌词.lrc'}},null,2));
}
export async function encodeResource(args,out){
  const temporary=out+'.'+randomUUID()+'.tmp';
  try {
    await run(process.env.FFMPEG||'ffmpeg',['-y','-v','error',...args,'-movflags','+faststart','-f','mp4',temporary],3600000);
    await run(process.env.FFMPEG||'ffmpeg',['-v','error','-xerror','-err_detect','explode','-i',temporary,'-map','0','-f','null','-'],3600000);
    await rename(temporary,out);
  } finally {await rm(temporary,{force:true});}
}
// Internal encoder: its store must point at an unpublished directory.
export async function encodePackage(store,song,info,cache){
  const dir=await packageDir(store,song,cache),sourceStat=await stat(song.path);
  const signature=JSON.stringify([sourceStat.mtimeMs,sourceStat.size,song.mode,song.backing,song.vocal]);
  const priorSignature=store.get('package-fingerprint:'+song.id);
  const same=priorSignature===signature;
  if(song.mode==='separated'&&priorSignature&&JSON.stringify(JSON.parse(priorSignature).slice(0,2))!==JSON.stringify([sourceStat.mtimeMs,sourceStat.size]))throw new Error('原始音频已改变，旧双音轨保持可用；请明确选择新音源并重新分离');
  const health=await inspectPackage(store,song,dir);
  for(const variant of song.mode==='instrumental'?['backing']:['original','separated'].includes(song.mode)?['vocal']:['vocal','backing']){
    const out=path.join(dir,variant==='vocal'?'原唱.m4a':'伴奏.m4a');
    if((same||song.mode==='separated')&&health[variant]?.available)continue;
    const args=['-i',song.path,'-vn','-map','0:a:'+(song.mode==='tracks'?song[variant]:0)];
    if(song.mode==='channels')args.push('-af','pan=stereo|c0=c'+song[variant]+'|c1=c'+song[variant]);
    await encodeResource([...args,'-c:a','aac','-b:a','192k','-ac','2'],out);
  }
  if(!same&&song.mode==='original')await rm(path.join(dir,'伴奏.m4a'),{force:true});
  if(!same&&song.mode==='instrumental')await rm(path.join(dir,'原唱.m4a'),{force:true});
  if(info.hasVideo&&!store.get('video-source:'+song.id)?.keepAudio&&(!same||!health.video?.available)){
    const codec=info.videoCodec==='h264'&&['yuv420p','yuvj420p'].includes(info.pixelFormat)?['-c:v','copy']:['-c:v','libx264','-preset','veryfast','-crf','22','-vf',"scale=w='min(1920,iw)':h=-2",'-pix_fmt','yuv420p'];
    await encodeResource(['-i',song.path,'-map','0:v:0','-an',...codec],path.join(dir,'画面.mp4'));
  }
  if(!info.hasVideo&&!store.get('video-source:'+song.id)?.keepAudio)await rm(path.join(dir,'画面.mp4'),{force:true});
  if(song.mode==='separated'&&!await present(path.join(dir,'伴奏.m4a'))){
    const old=path.join(cache,'stems',song.id,'backing.wav');
    await encodeResource(['-i',await present(old)?old:path.join(cache,song.id+'-backing.mp4'),'-vn','-c:a','aac','-b:a','192k'],path.join(dir,'伴奏.m4a'));
  }
  await requireHealthyPackage(store,song,dir,song.mode==='instrumental'?['backing']:song.mode==='original'?['vocal']:['vocal','backing']);
  store.set('package-fingerprint:'+song.id,signature);store.set('package-ready:'+song.id,true);
}
export async function preparePackage(store,song,info,cache){
  return withSongWrite(store,song.id,async latest=>{
    const key=publicationKey(song.id,'prepare');if(key&&store.get(key))return latest;
    const stage=await stageResources(store,latest,cache,{phase:'prepare'});
    try {
      await encodePackage(stage.store,{...latest,path:song.path},info,cache);
      const patch={duration:info.duration,audio:JSON.stringify(info.audio),needs_video:info.hasVideo?0:1,status:'ready',error:''};
      await savePackageInfo(stage.store,{...latest,...patch,resourceRevision:latest.resourceRevision+1},cache);
      return stage.publish(patch);
    }catch(e){await stage.abandon();throw e;}
  },{wait:true});
}
export async function repairPicture(store,song,cache){
  return withSongWrite(store,song.id,async latest=>{
    const stage=await stageResources(store,latest,cache);
    try {
      await encodeResource(['-i',latest.path,'-map','0:v:0','-an','-c:v','libx264','-preset','veryfast','-crf','22','-vf',"scale=w='min(1920,iw)':h=-2",'-pix_fmt','yuv420p'],path.join(stage.directory,'画面.mp4'));
      await savePackageInfo(stage.store,{...latest,resourceRevision:latest.resourceRevision+1},cache);stage.publish({needs_video:0});
    }catch(e){await stage.abandon();throw e;}
  },{wait:true});
}
export async function publishBacking(store,song,cache,wav){
  return withSongWrite(store,song.id,async latest=>{
    const key=publicationKey(song.id,'backing');if(key&&store.get(key))return latest;
    const stage=await stageResources(store,latest,cache,{phase:'backing'});
    try {
      await encodeResource(['-i',wav,'-vn','-c:a','aac','-b:a','192k'],path.join(stage.directory,'伴奏.m4a'));
      await requireHealthyPackage(stage.store,latest,stage.directory,['vocal','backing']);
      await savePackageInfo(stage.store,{...latest,mode:'separated',status:'ready',metadataRevision:latest.metadataRevision+(latest.mode==='separated'?0:1),resourceRevision:latest.resourceRevision+1},cache);
      stage.publish({mode:'separated',status:'ready',error:''});
    }catch(e){await stage.abandon();throw e;}
  },{wait:true});
}
