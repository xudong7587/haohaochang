import React,{useState} from 'react';

export function RequestSong({initialTitle='',request,notify}){
  const [title,setTitle]=useState(initialTitle),[artist,setArtist]=useState(''),[busy,setBusy]=useState(false);
  return <section className="settings-card"><h3>曲库没有，也可以试着找</h3><p>先找可用音频并准备开唱，再到后台寻找 MTV。找不到的项目会进入管理员的待处理列表。</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await request({title,artist});notify('已提交自动找歌，准备完成后加入队列；需要补充信息时会通知后台。');}catch(error){notify(error.message);}finally{setBusy(false);}}}><div className="organize-fields"><label>歌名<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="想唱哪首歌"/></label><label>歌手<input required value={artist} onChange={e=>setArtist(e.target.value)} placeholder="填写歌手，避免同名歌曲"/></label></div><button className="primary" disabled={busy||!title.trim()||!artist.trim()}>{busy?'提交中…':'自动找歌并点唱'}</button></form></section>;
}
