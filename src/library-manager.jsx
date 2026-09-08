import React,{useEffect,useState} from 'react';
import {ResourceRow} from './library/resource-row.jsx';
import {VideoReview} from './library/video-review.jsx';
import {CatalogImport} from './library/catalog-import.jsx';
import {SourceImport} from './library/source-import.jsx';
import {BatchResults} from './library/batch-results.jsx';
import {refreshMetadataBatch} from './library/batch.js';
export {LyricsSettings} from './library/lyrics-settings.jsx';

export function LibraryManager({request,notify,onEdit}){
 const [songs,setSongs]=useState([]),[hiddenSongs,setHiddenSongs]=useState([]),[reviews,setReviews]=useState([]);
 const [tab,setTab]=useState('pending'),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[results,setResults]=useState([]);
 async function refresh(){
  const [library,pending,inbox,hidden]=await Promise.all([request('/admin/library'),request('/admin/reviews'),request('/admin/inbox'),request('/admin/library?hidden=true')]);
  setSongs(library);setReviews([...pending,...inbox]);setHiddenSongs(hidden);
 }
 useEffect(()=>{refresh().catch(error=>notify(error.message));const timer=setInterval(()=>refresh().catch(error=>notify(error.message)),10000);return()=>clearInterval(timer);},[]);
 async function action(fn){setBusy(true);try{return await fn();}catch(error){notify(error.message);}finally{try{await refresh();}catch(error){notify(error.message);}setBusy(false);}}
 const matches=row=>(String(row.title||'')+' '+String(row.artist||'')).toLowerCase().includes(query.toLowerCase());
 const visibleCount=tab==='hidden'?hiddenSongs.filter(matches).length:songs.filter(song=>song.tier===tab&&matches(song)).length+(tab==='pending'?reviews.filter(matches).length:0);
 return <section>
  <div className="section-heading"><div><h2>曲库工作台</h2><p>按歌曲整理信息、MV、原唱、伴奏和歌词。</p></div><div className="actions"><button disabled={busy||!songs.length} onClick={()=>action(async()=>{setResults([]);const completed=await refreshMetadataBatch(songs,request,setResults);notify(`本批已处理 ${completed.length} 首，请查看逐项结果`);})}>刷新曲库元数据</button><button disabled={busy} onClick={()=>action(async()=>{})}>刷新列表</button></div></div>
  <BatchResults results={results}/><SourceImport {...{request,action,busy,notify}}/>
  <details className="library-tools"><summary>旧曲库工具</summary><button disabled={busy} onClick={()=>action(async()=>{const result=await request('/admin/migrate-packages',{},'POST');notify('已提交 '+result.count+' 首旧资源迁移，旧文件保留');})}>迁移旧播放资源</button></details>
  <div className="library-tabs">{[['pending','待整理曲库'],['audio','半标准曲库'],['standard','标准曲库'],['hidden','已隐藏']].map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label} · {id==='hidden'?hiddenSongs.length:songs.filter(song=>song.tier===id).length+(id==='pending'?reviews.length:0)}</button>)}</div>
  <input aria-label="筛选曲库" placeholder="筛选歌名或歌手" value={query} onChange={event=>setQuery(event.target.value)}/><p>{tab==='pending'?'缺信息、歌词或双版本的资源。补齐后再继续整理。':tab==='audio'?'原唱、伴奏和歌词齐全，可直接唱；等待补充匹配视频。':tab==='hidden'?'已隐藏歌曲保留媒体文件，恢复后重新按资源能力分类。':'画面、原唱、伴奏和歌词齐全。'}</p>
  {reviews.map(row=>row.kind==='find-video'?<VideoReview key={'review'+row.id} {...{row,request,action,busy,notify}} hidden={tab!=='pending'||!matches(row)}/>:<ResourceRow key={'review'+row.id} {...{row,request,action,busy,notify}} review hidden={tab!=='pending'||!matches(row)}/>)}
  {songs.map(row=><ResourceRow key={row.id} {...{row,request,action,busy,notify}} hidden={row.tier!==tab||!matches(row)} onEdit={onEdit?()=>onEdit(row):undefined}/>)}
  {tab==='hidden'&&hiddenSongs.filter(matches).map(song=><article className="workbench-row" key={song.id}><strong>{song.title} — {song.artist}</strong><div className="actions"><button disabled={busy} onClick={()=>action(async()=>{await request('/admin/library/'+song.id+'/restore',{},'POST');notify('歌曲已恢复');})}>恢复歌曲</button></div></article>)}
  {!visibleCount&&<p>这个分类暂时没有匹配歌曲。</p>}<CatalogImport {...{request,notify}}/>
 </section>;
}
