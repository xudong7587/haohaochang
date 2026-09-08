import path from 'node:path';
import {prepareSong} from '../media.js';
import {separateSong} from '../separation.js';


export async function prepare(job,payload,context){
  const {db,get,set,store,dir,roots,downloads,cache,legacyCache,emit,addJob,enqueue,fail}=context;
      if (job.kind === 'prepare') {

        let song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.id);
        await prepareSong(store, payload.id, [...roots, downloads,path.join(dir,'downloads')], cache);
        song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.id);
        if(song.mode==='original'&&get('ai',{}).enabled&&!JSON.parse(db.prepare('SELECT payload FROM jobs WHERE id=?').get(job.id).payload).ambientOnly) await separateSong(store,song,cache);
        const latest=JSON.parse(db.prepare('SELECT payload FROM jobs WHERE id=?').get(job.id).payload);
        if(latest.enqueue)enqueue(payload.id,latest.name||'家人');
      }

}
