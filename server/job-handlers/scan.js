import {scanLibrary} from '../media.js';


export async function scan(job,payload,context){
  const {db,get,set,store,dir,roots,downloads,cache,legacyCache,emit,addJob,enqueue,fail}=context;
      if (job.kind === 'scan') await scanLibrary(store, roots);

}
