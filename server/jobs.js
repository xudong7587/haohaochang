import {migrateSongAssets} from './assets.js';
import {organize} from './job-handlers/organize.js';
import {acquire} from './job-handlers/acquire.js';
import {attach} from './job-handlers/attach.js';
import {enrich} from './job-handlers/enrich.js';
import {favorite_sync} from './job-handlers/favorite-sync.js';
import {favorite_download} from './job-handlers/favorite-download.js';
import {importJob} from './job-handlers/import.js';
import {scan} from './job-handlers/scan.js';
import {prepare} from './job-handlers/prepare.js';
import {download} from './job-handlers/download.js';

const handlers={'organize':organize,'acquire':acquire,'attach':attach,'enrich':enrich,'favorite-sync':favorite_sync,'favorite-download':favorite_download,'import':importJob,'scan':scan,'prepare':prepare,'download':download,'find-video':acquire,'attach-video':attach};
export async function runJob(job,payload,context){
  if(payload.id)await migrateSongAssets(payload.id,context.legacyCache,context.cache);
  const handler=handlers[job.kind];if(!handler)throw new Error('未知任务类型：'+job.kind);
  return handler(job,payload,context);
}

