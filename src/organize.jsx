import {tagOptions} from '../shared/tags.js';
import React,{useState} from 'react';
import {BatchResults} from './library/batch-results.jsx';

export function Organize({request,notify,refresh,downloads,autoImport}) {
  const [rows,setRows]=useState([]),[busy,setBusy]=useState(false),[prepare,setPrepare]=useState(true),[enabled,setEnabled]=useState(autoImport),[results,setResults]=useState([]);
  async function preview(){setBusy(true);try{setRows((await request('/admin/organize')).map(r=>({...r,expectedRevision:r.expectedRevision??r.metadataRevision,selected:!r.error})));setResults([]);}catch(e){notify(e.message);}finally{setBusy(false);}}
  async function apply(){setBusy(true);try{
    const songs=rows.filter(r=>r.selected&&!r.error).map(({id,title,artist,tags,expectedRevision})=>({id,title,artist,tags,expectedRevision}));
    const response=await request('/admin/organize',{songs,prepare},'POST');
    const completed=(response.results||[]).map(result=>{const song=songs.find(value=>value.id===result.id)||{};return {...song,...result,status:result.ok?'success':result.code==='REVISION_CONFLICT'||/修订|资料.*更新|版本.*冲突/.test(result.error||'')?'conflict':'failed',message:result.ok?'资料已保存'+(prepare?'，播放资源在后台准备':''):result.error};});
    setResults(completed);const succeeded=new Set(completed.filter(result=>result.status==='success').map(result=>result.id));
    setRows(current=>current.filter(row=>!succeeded.has(row.id)));notify(`已保存 ${succeeded.size} 首，其余结果和草稿保留在下方`);refresh();
  }catch(e){notify(e.message);}finally{setBusy(false);}}
  return <section className="settings-card organizer"><h3>下载入库与曲库整理</h3><p>可对接 bili-sync 收藏夹下载，将两边映射到同一个 NAS 文件夹。下载暂存：<code>{downloads}</code>。完成并稳定约 60 秒后，自动复制到正式曲库的「歌手 / 歌手 - 歌名」，源文件保留。启用 AI 后自动生成伴奏，原唱也会保存。</p>
    <label className="checkbox"><input type="checkbox" checked={enabled} onChange={async e=>{const value=e.target.checked;try{await request('/admin/import-settings',{enabled:value},'POST');setEnabled(value);}catch(error){notify(error.message);}}}/>自动整理下载文件夹</label>
    <p>已有歌曲读取同名 NFO 和海报，优先采用 NFO 的歌手、歌名。先预览再保存；这里只整理曲库显示信息，不移动现有媒体文件。未识别的歌手会标记待核对。</p>
    <button disabled={busy} onClick={preview}>{busy?'处理中…':'预览整理已有曲库'}</button><BatchResults results={results}/>
    {!!rows.length&&<><div className="organize-list">{rows.map((r,i)=><div className="organize-row" key={r.id}><input aria-label={'选择 '+r.oldTitle} type="checkbox" disabled={!!r.error} checked={r.selected} onChange={e=>setRows(rows.map((v,n)=>n===i?{...v,selected:e.target.checked}:v))}/><div><small>{r.oldArtist} · {r.oldTitle} → {r.error||r.metadata_source}</small><div className="organize-fields"><input aria-label={'歌手 '+r.oldTitle} value={r.artist} onChange={e=>setRows(rows.map((v,n)=>n===i?{...v,artist:e.target.value}:v))}/><input aria-label={'歌名 '+r.oldTitle} value={r.title} onChange={e=>setRows(rows.map((v,n)=>n===i?{...v,title:e.target.value}:v))}/></div><details className="tag-editor"><summary>标签：{r.tags?.length?r.tags.join(' · '):'待补充'}</summary><div>{tagOptions.map(tag=><label key={tag}><input type="checkbox" checked={r.tags?.includes(tag)||false} onChange={e=>setRows(rows.map((v,n)=>n===i?{...v,tags:e.target.checked?[...(v.tags||[]),tag]:(v.tags||[]).filter(t=>t!==tag)}:v))}/>{tag}</label>)}</div></details></div></div>)}</div><label className="checkbox"><input type="checkbox" checked={prepare} onChange={e=>setPrepare(e.target.checked)}/>同时准备播放版本，已启用 AI 时生成原唱 / 伴奏</label><button className="primary" disabled={busy||!rows.some(r=>r.selected)} onClick={apply}>保存选中的整理结果</button><button disabled={busy} onClick={async()=>{setBusy(true);try{await request('/admin/enrich',{ids:rows.filter(r=>r.selected&&!r.error).map(r=>r.id)},'POST');notify('AI 刮削任务已加入后台，人工锁定的信息会保留');}catch(e){notify(e.message);}finally{setBusy(false);}}}>选中歌曲交给 AI 刮削</button><p>每次预览最近 500 首。AI 未配置时先保存原唱，配置后可再次批量准备。</p></>}
  </section>;
}
