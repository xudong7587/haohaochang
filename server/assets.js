import path from 'node:path';
import {mkdir,stat,copyFile,link,unlink,writeFile,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';

export const resourceFolder='好好唱播放资源';
export const resourceRoot=root=>path.join(root,resourceFolder);
const exists=async file=>{try{return await stat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};

async function copyOnce(source,target){
  if(await exists(target))return;
  await mkdir(path.dirname(target),{recursive:true});
  const temporary=target+'.'+randomUUID()+'.tmp';
  try{
    await copyFile(source,temporary);
    if((await stat(source)).size!==(await stat(temporary)).size)throw new Error('资源复制校验失败');
    try{await link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;}
  }finally{await unlink(temporary).catch(()=>{});}
}

export async function migrateSongAssets(id,legacy,permanent){
  if(legacy===permanent)return;
  for(const variant of ['vocal','backing']){
    const file=path.join(legacy,`${id}-${variant}.mp4`);
    if(await exists(file))await copyOnce(file,path.join(permanent,path.basename(file)));
  }
  const stems=path.join(legacy,'stems',id);
  if(await exists(stems))for(const file of await readdir(stems)){
    if(!/\.(wav|m4a|flac|mp3)$/i.test(file))continue;
    await copyOnce(path.join(stems,file),path.join(permanent,'stems',id,file));
  }
}

export async function preserveSource(song,permanent){
  const info=await stat(song.path);
  const signature=createHash('sha256').update(JSON.stringify([song.path,info.size,info.mtimeMs])).digest('hex').slice(0,12);
  const target=path.join(permanent,'sources',song.id,signature+path.extname(song.path));
  await copyOnce(song.path,target);
  await writeFile(path.join(permanent,'sources',song.id,'song.json'),JSON.stringify({id:song.id,title:song.title,artist:song.artist,source:song.path,retained:path.basename(target)},null,2));
}

export async function archiveVersion(file){
  const info=await exists(file);if(!info)return;
  const target=path.join(path.dirname(file),'versions',path.basename(file,path.extname(file)),`${Math.trunc(info.mtimeMs)}-${info.size}${path.extname(file)}`);
  await copyOnce(file,target);
}
