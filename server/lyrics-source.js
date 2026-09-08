const normalize=s=>String(s||'').toLowerCase().replace(/[\s\p{P}]/gu,'');
export async function findLyrics(title,artist,duration,fetcher=fetch){
 const url=new URL('https://lrclib.net/api/search');url.searchParams.set('track_name',title);url.searchParams.set('artist_name',artist);
 const response=await fetcher(url,{headers:{'User-Agent':'Haohaochang/0.1 (local karaoke library)'},signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!response.ok)throw new Error('歌词服务暂不可用');
 const rows=await response.json();
 const exact=rows.filter(r=>normalize(r.trackName)===normalize(title)&&normalize(r.artistName)===normalize(artist)&&(!duration||Math.abs(r.duration-duration)<=4)&&r.syncedLyrics);
 if(!exact.length)throw new Error('没有找到歌名、歌手和时长匹配的 LRC，请手动补充');
 return {lyrics:exact[0].syncedLyrics,source:'LRCLIB',sourceId:exact[0].id};
}
