import {archiveVersion} from './assets.js';
// One picture stream, independent original/accompaniment audio, and portable metadata.
import path from 'node:path';
import {mkdir,stat,writeFile,rename,copyFile} from 'node:fs/promises';
import {run} from './process.js';
export const packageFolder='歌曲';
const part=s=>String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,70)||'未知';
export async function packageDir(store,song,cache){
  let dir=store.get('package:'+song.id);
  if(!dir){dir=path.join(cache,packageFolder,`${part(song.artist)} - ${part(song.title)} [${song.id.slice(0,8)}]`);store.set('package:'+song.id,dir);}
  await mkdir(dir,{recursive:true});return dir;
}
export async function present(file){try{return (await stat(file)).size>0;}catch{return false;}}
export function libraryTier(song){
  if(song.needs_review||!song.title||!song.artist||song.artist==='未知歌手'||!song.lyrics?.trim()||song.status!=='ready'||!['separated','tracks','channels'].includes(song.mode))return 'pending';
  return song.needs_video?'audio':'standard';
}
export async function savePackageInfo(store,song,cache){
  const dir=await packageDir(store,song,cache);
  await writeFile(path.join(dir,'歌曲信息.json'),JSON.stringify({version:2,id:song.id,title:song.title,artist:song.artist,tier:libraryTier(song),duration:song.duration,source:song.path,files:{video:'画面.mp4',original:'原唱.m4a',accompaniment:'伴奏.m4a',lyrics:'歌词.lrc'},note:'画面只有一份；原唱包含歌声和音乐。原始媒体保留在来源路径。'},null,2));
  await writeFile(path.join(dir,'歌词.lrc'),song.lyrics||'');
}
async function encode(args,out){await run(process.env.FFMPEG||'ffmpeg',['-y','-v','error',...args,'-movflags','+faststart','-f','mp4',out+'.tmp'],3600000);await archiveVersion(out);await rename(out+'.tmp',out);}
export async function preparePackage(store,song,info,cache){
  const dir=await packageDir(store,song,cache);
  const signature=JSON.stringify([(await stat(song.path)).mtimeMs,(await stat(song.path)).size,song.mode,song.backing,song.vocal]);
  const same=store.get('package-fingerprint:'+song.id)===signature;
  for(const variant of song.mode==='instrumental'?['backing']:song.mode==='original'||song.mode==='separated'?['vocal']:['vocal','backing']){
    const out=path.join(dir,variant==='vocal'?'原唱.m4a':'伴奏.m4a');
    if(same&&await present(out))continue;
    const track=song.mode==='tracks'?song[variant]:0;
    const args=['-i',song.path,'-vn','-map',`0:a:${track}`];
    if(song.mode==='channels')args.push('-af',`pan=stereo|c0=c${song[variant]}|c1=c${song[variant]}`);
    args.push('-c:a','aac','-b:a','192k','-ac','2');await encode(args,out);
  }
  // Compatible video is copied without decoding or re-encoding.
  if(info.hasVideo&&!store.get('video-source:'+song.id)?.keepAudio&&(!same||!await present(path.join(dir,'画面.mp4')))){
    const args=['-i',song.path,'-map','0:v:0','-an'];
    if(info.videoCodec==='h264'&&['yuv420p','yuvj420p'].includes(info.pixelFormat))args.push('-c:v','copy');
    else args.push('-c:v','libx264','-preset','veryfast','-crf','22','-vf',"scale=w='min(1920,iw)':h=-2",'-pix_fmt','yuv420p');
    const output=path.join(dir,'画面.mp4');
    if(path.resolve(song.path)!==path.resolve(output))await encode(args,output);
    else if(info.videoCodec!=='h264'||!['yuv420p','yuvj420p'].includes(info.pixelFormat)){
      const original=await archiveVersion(output);args[1]=original;await encode(args,output);
      store.db.prepare('UPDATE songs SET path=? WHERE id=?').run(original,song.id);song.path=original;
    }
  }
  if(song.mode==='separated'&&!await present(path.join(dir,'伴奏.m4a'))){
    const old=path.join(cache,'stems',song.id,'backing.wav');
    const source=await present(old)?old:path.join(cache,`${song.id}-backing.mp4`);
    await encode(['-i',source,'-vn','-c:a','aac','-b:a','192k'],path.join(dir,'伴奏.m4a'));
  }
  store.set('package-fingerprint:'+song.id,signature);
  store.set('package-ready:'+song.id,true);
  await savePackageInfo(store,{...song,duration:info.duration,needs_video:info.hasVideo?0:1,status:'ready'},cache);
}
export async function publishBacking(store,song,cache,wav){
  const dir=await packageDir(store,song,cache);
  await encode(['-i',wav,'-vn','-af','apad','-t',String(song.duration),'-c:a','aac','-b:a','192k'],path.join(dir,'伴奏.m4a'));
  await savePackageInfo(store,{...song,mode:'separated',status:'ready'},cache);
}
