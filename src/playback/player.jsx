import React,{useEffect,useRef,useState} from 'react';
import {Mic2,Monitor,Play} from 'lucide-react';
import {useMediaPlayback} from '../media-playback.js';
import {Spectrum} from '../spectrum.jsx';
import {Lyrics} from '../lyrics.jsx';
import {Background} from './background.jsx';
import {usePlayerLease} from './use-player-lease.js';

export function Player({current,playback,notify,reactions=[],join,queue=[],request,token,background}) {
  const video=useRef(),container=useRef(),latest=useRef(current),position=useRef(0),previousEntry=useRef(null);
  latest.current=current;
  const {playerId,lease,leaseError}=usePlayerLease({request,token});
  const playState=useRef({});playState.current={lease,paused:playback.paused,entryId:current?.id};
  const [time,setTime]=useState(0),[showQueue,setShowQueue]=useState(false),[actualVariant,setActualVariant]=useState(null);
  const [blocked,setBlocked]=useState(false),[full,setFull]=useState(false),[error,setError]=useState(''),[warning,setWarning]=useState(''),[pictureError,setPictureError]=useState(false),[reload,setReload]=useState(0);
  const variant=current?.mode==='original'||playback.vocal?'vocal':'backing';
  function ended(entryId){if(!lease||playback.paused||!entryId||latest.current?.id!==entryId)return;request('/player/ended',{entryId,playerId},'POST').catch(e=>notify(e.message));}
  function mediaStatus(status){if('variant'in status)setActualVariant(status.variant);if('blocked'in status)setBlocked(status.blocked);if('error'in status)setError(status.error);if('warning'in status)setWarning(status.warning);if(status.pictureError)setPictureError(true);}
  const manifest=useMediaPlayback({video,current,variant,lease,paused:playback.paused,token,reload,onError:setError,onStatus:mediaStatus,onEnded:ended});
  useEffect(()=>{setError('');setWarning('');setBlocked(false);setPictureError(false);setTime(0);setActualVariant(null);},[current?.id]);
  // Legacy muxed media is isolated from the v2 controller.
  useEffect(()=>{
    const v=video.current;if(!v||!current||manifest?.version!==1)return;
    let alive=true;const entryId=current.id;
    if(previousEntry.current!==entryId){position.current=0;previousEntry.current=entryId;}else position.current=v.currentTime||position.current;
    v.muted=false;v._legacyEntry=entryId;v.src=`/api/media/${current.song_id}/${variant}?token=${encodeURIComponent(token)}`;v.load();
    const ready=()=>{if(!alive)return;v.currentTime=Math.min(position.current,v.duration||0);if(playState.current.lease&&!playState.current.paused)v.play().then(()=>{if(!alive)return;if(!playState.current.lease||playState.current.paused){v.pause();return;}setBlocked(false);}).catch(()=>{if(alive&&playState.current.lease&&!playState.current.paused)setBlocked(true);});};
    v.addEventListener('loadedmetadata',ready);
    return()=>{alive=false;v.removeEventListener('loadedmetadata',ready);v.pause();v._legacyEntry=null;};
  },[current?.id,variant,manifest,token]);
  useEffect(()=>{const v=video.current;if(!v||manifest?.version!==1)return;let alive=true;if(playback.paused||!lease)v.pause();else if(current)v.play().then(()=>{if(alive)setBlocked(false);}).catch(()=>{if(alive)setBlocked(true);});return()=>{alive=false;};},[playback.paused,current?.id,lease,manifest]);
  useEffect(()=>{let raf,last=0;const tick=now=>{if(now-last>32){setTime(video.current?._playback?.getTime()??video.current?.currentTime??0);last=now;}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[]);
  useEffect(()=>{const handler=()=>setFull(document.fullscreenElement===container.current);document.addEventListener('fullscreenchange',handler);return()=>document.removeEventListener('fullscreenchange',handler);},[]);
  useEffect(()=>{if(!full||!queue.length){setShowQueue(false);return;}let hide;const show=()=>{setShowQueue(true);hide=setTimeout(()=>setShowQueue(false),6000);};show();const interval=setInterval(show,30000);return()=>{clearTimeout(hide);clearInterval(interval);};},[full,queue.length>0]);
  async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await container.current.requestFullscreen();}catch{notify('当前浏览器不支持全屏；APK 会自动横屏显示');}}
  function retry(){if(!lease||playback.paused)return;setError('');setWarning('');if(!manifest){setReload(n=>n+1);return;}if(video.current?._playback){void video.current._playback.start({retry:true});return;}position.current=video.current?.currentTime||0;video.current?.load();video.current?.play().then(()=>setBlocked(false)).catch(()=>setBlocked(true));}
  const audioStage=manifest?.version===2&&(!manifest.resources.video||pictureError);
  return <section ref={container} className={`tv-player ${full?'is-full':''}`}>
    <div className="video-stage">
      <video ref={video} playsInline onEnded={()=>{if(manifest?.version===1&&video.current?._legacyEntry===current?.id)ended(current?.id);}} onError={()=>{if(manifest?.version===1&&video.current?._legacyEntry===current?.id)setError('播放失败，请重试或检查 NAS 连接');}}/>
      {audioStage&&<><Background background={background||manifest.background} token={token} time={time}/><Spectrum video={video}/></>}
      {current&&<Lyrics song={current} time={time} token={token} resource={manifest?.resources?.lyrics}/>}
      {!current&&<div className="stage-empty"><Mic2 size={34}/><span>客厅的舞台，留给你</span></div>}
      {warning&&!error&&!blocked&&<div role="status" style={{position:'absolute',top:8,left:8,padding:'4px 8px',background:'#181320cc',color:'#fff',fontSize:12}}>{warning}</div>}
      {(leaseError||(current&&(blocked||error)))&&<div className="video-overlay"><p>{leaseError||error||'点击播放，开启今晚的第一首'}</p>{leaseError?<p>请检查 NAS 连接；另一台设备退出歌房后会自动连接。</p>:<button disabled={!lease||playback.paused} onClick={retry}><Play size={17}/>{playback.paused?'请先恢复播放':error?'重试播放':'开始播放'}</button>}</div>}
      {full&&<div className="fullscreen-sidebar">{join&&<aside className="fullscreen-join"><img src={join.qr} alt="手机扫码加入歌房"/><strong>扫码点歌</strong><span>无需密码 · 手机互动</span></aside>}{showQueue&&queue.length>0&&<aside className="fullscreen-queue" aria-label="已点歌曲预告"><div className="fullscreen-queue-heading"><strong>已点歌曲</strong><span>{queue.length} 首</span></div><ol>{queue.slice(0,4).map((song,index)=><li key={song.id}><span className="queue-order">{index===0?'正在唱':String(index)}</span><div><strong>{song.title}</strong><span>{song.artist}</span></div></li>)}</ol>{queue.length>4&&<p>后面还有 {queue.length-4} 首</p>}</aside>}</div>}
      <div className="reaction-layer" aria-live="polite">{reactions.map((r,i)=><span key={r.id} style={{left:`${15+i*9}%`}}>{r.emoji}</span>)}</div>
    </div>
    <div className="video-caption"><span data-audio-variant={actualVariant||variant}><span className={`dot ${lease?'':'offline'}`}/>{current?.ambient?'随机原唱 · '+current.title:current?'正在舞台上 · '+((actualVariant||variant)==='vocal'?'原唱':'伴奏'):'等待开唱'}</span>{full&&current&&<div className="full-controls">{[['pause',playback.paused?'继续':'暂停'],...(!current.ambient&&!['original','instrumental'].includes(current.mode)?[['vocal',playback.vocal?'切伴奏':'切原唱']]:[]),['next','切歌']].map(([action,label])=><button key={action} onClick={()=>request('/control',{action,entryId:current.id},'POST').catch(e=>notify(e.message))}>{label}</button>)}</div>}<button onClick={fullscreen} aria-label="全屏播放"><Monitor size={16}/>{full?'退出全屏':'全屏'}</button></div>
  </section>;
}
