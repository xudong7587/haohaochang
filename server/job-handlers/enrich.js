import {saveSongMetadata} from '../song-metadata.js';
import {enrichSong} from '../enrichment.js';
import {metadata} from '../library.js';


export async function enrich(job,payload,context){
  const {db,get,set,store,dir,roots,downloads,cache,legacyCache,emit,addJob,enqueue,fail}=context;
      {
        const song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.existingId);if(!song)throw fail(404,'歌曲不存在');
        if(song.metadata_source!=='手动'||payload.approved){
          const meta=payload.approved?payload.metadata:await enrichSong(get('enrichment',{}),{title:song.title,artist:song.artist,tags:JSON.parse(song.tags)});
          if(meta.needs_review){db.prepare("UPDATE jobs SET status='review',payload=?,error=? WHERE id=?").run(JSON.stringify({...payload,metadata:meta}),meta.note||'AI 信息需要核对',job.id);emit('library',{});return 'review';}
          await saveSongMetadata(store,song.id,{title:meta.title,artist:meta.artist,tags:JSON.stringify(song.tags_manual?JSON.parse(song.tags):meta.tags),metadata_source:payload.approved?'手动':'AI',needs_review:0,evidence:JSON.stringify(meta.evidence||[])},cache,{required:false,idle:false});
          if(!db.prepare('SELECT id FROM queue WHERE song_id=?').get(song.id))addJob('prepare',{id:song.id});
        }
      }

}
