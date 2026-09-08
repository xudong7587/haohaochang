import React,{useEffect,useState} from 'react';

export function BackgroundSettings({request,notify=()=>{}}) {
  const [paths,setPaths]=useState(''),[interval,setInterval]=useState(12),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{
    let alive=true;setLoading(true);setLoadError('');
    request('/admin/background').then(value=>{if(alive){setPaths((value.paths||[]).join('\n'));setInterval(value.intervalSeconds||12);}}).catch(error=>{if(alive)setLoadError(error.message);}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[reload]);
  async function save(clear=false){
    const images=clear?[]:paths.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    if(images.length>20){notify('最多可设置 20 张背景图片');return;}
    setBusy(true);
    try{const value=await request('/admin/background',{images,intervalSeconds:Number(interval)},'POST');setPaths((value.paths||[]).join('\n'));setInterval(value.intervalSeconds);setLoadError('');notify(clear?'背景轮播已关闭，原始图片保留':'背景轮播已保存，下一首歌曲或重新打开歌房时生效');}
    catch(error){notify(error.message);}
    finally{setBusy(false);}
  }
  return <form className="settings-card" onSubmit={event=>{event.preventDefault();void save();}}>
    <h3>纯音频背景画面</h3>
    <p>先把图片放入 NAS 的媒体或下载映射目录，再填写容器内的完整路径，每行一张。例如 /media/背景/客厅.jpg。支持 JPEG、PNG、WebP，每张不超过 10 MB，最多 20 张。</p>
    <p>没有 MV 的歌曲会在频谱与歌词后显示这些图片。保存时复制图片，原文件会保留。</p>
    {loadError&&<p role="alert" className="error">读取已有背景失败：{loadError} <button type="button" onClick={()=>setReload(value=>value+1)}>重新读取</button></p>}
    <label>背景图片路径<textarea aria-label="背景图片路径" value={paths} rows={6} disabled={loading||busy} placeholder={'/media/背景/客厅.jpg\n/media/背景/旅行.png'} onChange={event=>setPaths(event.target.value)} style={{width:'100%'}}/></label>
    <label>轮播间隔（秒）<input aria-label="轮播间隔（秒）" type="number" min="3" max="3600" step="1" value={interval} disabled={loading||busy} onChange={event=>setInterval(event.target.value)} required/></label>
    <div className="actions" style={{display:'flex',gap:8,marginTop:16}}><button className="primary" disabled={loading||busy||!!loadError}>{loading?'正在读取…':busy?'正在保存…':'保存背景轮播'}</button><button type="button" disabled={loading||busy||!!loadError} onClick={()=>save(true)}>禁用并清空轮播</button></div>
  </form>;
}
