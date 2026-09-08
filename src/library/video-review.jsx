import React,{useEffect,useState} from 'react';
import {VideoConfirmation,validOffset} from './video-confirmation.jsx';
export function VideoReview({row,request,action,busy,notify,hidden}){
 const [confirmed,setConfirmed]=useState(false),[offset,setOffset]=useState('');
 const url=row.candidate?.canonicalUrl||row.sourceUrl;
 useEffect(()=>{setConfirmed(false);setOffset('');},[row.candidatePath,url]);
 async function resolve(kind){await action(async()=>{await request('/admin/reviews/'+row.id,{title:row.title,artist:row.artist,candidate:row.candidate,candidatePath:row.candidatePath,sourceUrl:url,expectedRevision:row.expectedRevision??row.metadataRevision,action:kind,confirmed:kind==='confirm',...(kind==='confirm'?{offset:Number(offset)}:{})},'POST');notify(kind==='confirm'?'已确认候选并提交画面关联':kind==='reject'?'已拒绝此候选，原音轨保持可用':'已提交重新搜索');});}
 return <article className="workbench-row" hidden={hidden}><h3>{row.title||'待补充视频'} — {row.artist}</h3><p>{row.note}</p>{url&&<a href={url} target="_blank" rel="noreferrer">打开候选视频试听</a>}{row.candidate&&<p>来源：{row.candidate.provider} · {row.candidate.externalTitle}{row.candidate.duration?` · ${Math.round(row.candidate.duration)} 秒`:''}</p>}{row.candidatePath&&<details><summary>候选文件位置</summary><code>{row.candidatePath}</code></details>}<VideoConfirmation {...{confirmed,setConfirmed,offset,setOffset,busy}}/><div className="actions"><button className="primary" disabled={busy||!confirmed||!validOffset(offset)||(!row.candidatePath&&!url)} onClick={()=>resolve('confirm')}>确认候选并关联画面</button><button disabled={busy} onClick={()=>resolve('reject')}>拒绝此候选</button><button disabled={busy} onClick={()=>resolve('research')}>重新搜索视频</button></div></article>;
}
