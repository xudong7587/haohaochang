import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,copyFile,stat} from 'node:fs/promises';
import {packageDir,preparePackage,savePackageInfo,present} from './song-package.js';
import {probe} from './media.js';

// Publish a complete new directory only after conversion succeeds. The previous
// package remains available for rollback; replacing an MV keeps the song ID.
export async function replaceVideo(store,song,file,url,cache){
 const info=await probe(file);if(!info.hasVideo||!info.audio.length)throw new Error('新链接必须提供含音轨的视频');
 const oldDir=await packageDir(store,song,cache);
 const keepAudio=song.status==='ready'&&['separated','tracks','channels'].includes(song.mode)&&await present(path.join(oldDir,'原唱.m4a'))&&await present(path.join(oldDir,'伴奏.m4a'));
 if(keepAudio&&song.duration&&Math.abs(info.duration-song.duration)>4)throw new Error('视频与现有音轨时长不匹配，旧版本保持可用；请更换相同录音版本的 MV');
 const base=store.get('package-base:'+song.id,oldDir);
 const next=path.join(base,'资源版本',randomUUID());await mkdir(next,{recursive:true});
 const source=path.join(next,'来源'+path.extname(file));await copyFile(file,source);
 const pending=new Map();
 const staged={db:store.db,get:(key,fallback)=>key==='package:'+song.id?next:pending.has(key)?pending.get(key):['package-fingerprint:'+song.id,'video-source:'+song.id].includes(key)?undefined:store.get(key,fallback),set:(key,value)=>pending.set(key,value)};
 await preparePackage(staged,{...song,path:source,mode:'original'},info,cache);
 if(keepAudio)for(const name of ['原唱.m4a','伴奏.m4a'])await copyFile(path.join(oldDir,name),path.join(next,name));
 const updated={...song,path:keepAudio?song.path:source,mode:keepAudio?song.mode:'original',duration:keepAudio?song.duration:info.duration,needs_video:0,status:'ready',lyrics:keepAudio?song.lyrics:''};
 await savePackageInfo(staged,updated,cache);
 const sourceStat=await stat(updated.path);
 store.db.exec('BEGIN');
 try{
  store.set('package:'+song.id,next);store.set('package-ready:'+song.id,true);
  store.set('package-base:'+song.id,base);
  store.set('package-fingerprint:'+song.id,JSON.stringify([sourceStat.mtimeMs,sourceStat.size,updated.mode,updated.backing,updated.vocal]));
  store.set('video-source:'+song.id,{url,path:source,previousPackage:oldDir,keepAudio,alignment:'needs-review'});
  if(!keepAudio)store.set('lyrics-match:'+song.id,{status:'needs-review',reason:'视频来源已替换，需要重新匹配新音轨的歌词'});
  store.db.prepare('UPDATE songs SET path=?,mode=?,duration=?,needs_video=0,status=?,lyrics=?,error=? WHERE id=?').run(updated.path,updated.mode,updated.duration,updated.status,updated.lyrics,'',song.id);
  store.db.exec('COMMIT');
 }catch(error){store.db.exec('ROLLBACK');throw error;}
 return {keepAudio};
}
