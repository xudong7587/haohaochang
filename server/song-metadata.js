import {withSongWrite,publicationKey,metadataRevisionFor} from './song-writes.js';
import {stageResources} from './resource-publication.js';
import {savePackageInfo} from './song-package.js';
import {searchText} from './media-utils.js';
export async function saveSongMetadata(store,id,input,cache,{required=true,idle=true}={}){
  return withSongWrite(store,id,async song=>{
    const key=publicationKey(id,'metadata');if(key&&store.get(key))return song;
    if(store.db.prepare('SELECT id FROM queue WHERE song_id=?').get(id))throw Object.assign(new Error('请先将歌曲移出播放队列'),{status:409});
    const patch={};
    for(const key of ['title','artist'])if(input[key]!==undefined){patch[key]=String(input[key]).trim().slice(0,120);if(!patch[key])throw new Error('请填写歌名和歌手');}
    if(input.lyrics!==undefined)patch.lyrics=String(input.lyrics).slice(0,25000);
    for(const key of ['tags','tags_manual','mode','backing','vocal','status','needs_review','metadata_source','evidence'])if(input[key]!==undefined)patch[key]=input[key];
    if(patch.title||patch.artist)patch.search=searchText(patch.title||song.title,patch.artist||song.artist);
    const stage=await stageResources(store,song,cache,{phase:'metadata'});
    try{
      if(input.lyricsSource)stage.store.set('lyrics-match:'+id,input.lyricsSource);
      await savePackageInfo(stage.store,{...song,...patch,metadataRevision:metadataRevisionFor(song,patch),resourceRevision:song.resourceRevision+1},cache);
      return stage.publish(patch);
    }catch(e){await stage.abandon();throw e;}
  },{expectedRevision:input.expectedRevision,required,idle});
}
