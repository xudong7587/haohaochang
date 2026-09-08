export function lrclibProvider(fetcher=fetch){
 return {id:'lrclib',async search(query){
  const url=new URL('https://lrclib.net/api/search');
  url.searchParams.set('track_name',query.title);url.searchParams.set('artist_name',query.artist);
  const response=await fetcher(url,{headers:{'User-Agent':'Haohaochang/0.1 (local karaoke library)'},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw new Error('LRCLIB 歌词服务暂不可用');
  const rows=await response.json();if(!Array.isArray(rows))throw new Error('LRCLIB 返回格式错误');
  return rows.slice(0,200).map(row=>({title:row.trackName,artist:row.artistName,duration:row.duration,version:row.version||'',lyrics:row.syncedLyrics||'',source:'LRCLIB',sourceId:row.id,sourceUrl:`https://lrclib.net/api/get/${encodeURIComponent(row.id)}`,evidence:[{kind:'lyrics-provider',provider:'lrclib',id:row.id,album:row.albumName||''}]}));
 }};
}
