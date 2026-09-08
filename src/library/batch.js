export async function refreshMetadataBatch(songs,request,onProgress=()=>{}){
 const results=[];
 // Capture revisions before asynchronous work, including items later in the batch.
 const snapshots=songs.map(song=>({...song}));
 for(const song of snapshots){
  let result={id:song.id,title:song.title,artist:song.artist,expectedRevision:song.metadataRevision};
  try{
   const parsed=await request('/admin/refresh-metadata',{id:song.id,expectedRevision:song.metadataRevision},'POST');
   if(parsed.needs_review)result={...result,status:'review',message:parsed.note||'请手动核对歌名、歌手与录音版本'};
   else{
    await request('/admin/library/'+song.id+'/save',{title:parsed.title,artist:parsed.artist,lyrics:song.lyrics||'',lyricsSource:song.lyricsSource,expectedRevision:song.metadataRevision},'POST');
    result={...result,status:'success',message:'资料已更新'};
   }
  }catch(error){result={...result,status:error.code==='REVISION_CONFLICT'?'conflict':'failed',message:error.message};}
  results.push(result);onProgress([...results]);
 }
 return results;
}
