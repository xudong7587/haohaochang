import path from 'node:path';
import {stat,writeFile} from 'node:fs/promises';
import {downloadVideo} from '../media.js';


export async function favorite_download(job,payload,context){
  const {db,get,set,store,dir,roots,downloads,cache,legacyCache,emit,addJob,enqueue,fail}=context;
      {
        let cookieFile;const cookie=get('favorites',{}).cookie;
        if(cookie){cookieFile=path.join(dir,'bilibili.cookies.txt');const lines=cookie.split(';').map(v=>v.trim()).filter(v=>v.includes('=')).map(v=>{const n=v.indexOf('=');return '.bilibili.com\tTRUE\t/\tTRUE\t0\t'+v.slice(0,n)+'\t'+v.slice(n+1);});await writeFile(cookieFile,'# Netscape HTTP Cookie File\n'+lines.join('\n'),{mode:0o600});}
        const {file}=await downloadVideo(payload.url,downloads,cookieFile);const info=await stat(file);
        addJob('import',{file,signature:info.size+':'+info.mtimeMs,title:payload.title,sourceUrl:payload.url,enqueue:payload.enqueue,name:payload.name});
      }

}
