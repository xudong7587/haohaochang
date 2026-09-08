import {saveSongMetadata} from '../song-metadata.js';
import {identifyTitle} from '../../shared/catalog.js';
import {findLyrics} from '../lyrics-source.js';
import {enrichSong} from '../enrichment.js';
import {metadata} from '../library.js';
import {prepareSong} from '../media.js';
import {separateSong} from '../separation.js';


export async function organize(job,payload,context){
  const {db,get,set,store,dir,roots,downloads,cache,legacyCache,emit,addJob,enqueue,fail}=context;
      {
        let song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.id);if(!song)throw fail(404,'歌曲不存在');
        let meta=payload.approved?payload.metadata:{title:song.title,artist:song.artist,lyrics:song.lyrics,needs_review:song.needs_review};
        if(!payload.approved&&(meta.needs_review||meta.artist==='未知歌手')){
          meta={...meta,...identifyTitle(song.artist+' - '+song.title)};
          if(meta.needs_review&&get('enrichment',{}).enabled)meta={...meta,...await enrichSong(get('enrichment'),song)};
        }
        if(!meta.needs_review&&!meta.lyrics){try{const result=await findLyrics(meta.title,meta.artist,song.duration);meta.lyrics=result.lyrics;meta.lyricsSource={...result,lyrics:undefined,status:'candidate'};}catch{}}
        if(meta.needs_review||!meta.lyrics){db.prepare("UPDATE jobs SET status='review',payload=?,error=? WHERE id=?").run(JSON.stringify({...payload,metadata:meta}),meta.needs_review?'请核对歌名和歌手后继续':'未找到匹配歌词，请补充 LRC 后继续',job.id);return 'review';}
        await saveSongMetadata(store,song.id,{title:meta.title,artist:meta.artist,lyrics:meta.lyrics,lyricsSource:meta.lyricsSource,needs_review:0},cache,{required:false,idle:false});
        await prepareSong(store,song.id,[...roots,downloads],cache);song=db.prepare('SELECT * FROM songs WHERE id=?').get(song.id);
        if(song.mode==='original'){if(!get('ai',{}).enabled){db.prepare("UPDATE jobs SET status='review',payload=?,error=? WHERE id=?").run(JSON.stringify({...payload,metadata:meta}),'信息和歌词已整理，请连接 PC 分离服务后继续',job.id);return 'review';}await separateSong(store,song,cache);}
        if(song.needs_video)addJob('find-video',{id:song.id});
      }

}
