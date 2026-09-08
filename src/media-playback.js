import {useEffect,useRef,useState} from 'react';
// Keep both audio timelines alive. Toggling vocals changes gain, not the video URL.
export function useMediaPlayback({video,current,variant,lease,paused,token,onError}){
 const [manifest,setManifest]=useState(null);const tracks=useRef([]);
 useEffect(()=>{let alive=true;setManifest(null);if(!current)return;fetch(`/api/playback-assets/${current.song_id}?token=${encodeURIComponent(token)}`).then(r=>{if(!r.ok)throw new Error('播放资源读取失败');return r.json();}).then(v=>{if(alive)setManifest(v);}).catch(e=>onError(e.message));return()=>{alive=false;};},[current?.id]);
 useEffect(()=>{
  const v=video.current;if(!v||!manifest||manifest.version!==2||!current)return;
  const url=kind=>`/api/assets/${current.song_id}/${kind}?token=${encodeURIComponent(token)}`;
  v.muted=true;v.src=url(manifest.video?'video':manifest.vocal?'vocal':'backing');v.load();
  const context=new AudioContext();v._audioContext=context;
  const audio=['vocal','backing'].filter(k=>manifest[k]).map(kind=>{const el=new Audio(url(kind));el.preload='auto';el.load();const source=context.createMediaElementSource(el),gain=context.createGain(),analyser=context.createAnalyser();analyser.fftSize=128;source.connect(analyser);analyser.connect(gain);gain.connect(context.destination);gain.gain.value=kind===variant?1:0;return {kind,el,gain,analyser};});tracks.current=audio;v._audioTracks=audio;
  let playing=false;
  const sync=()=>{audio.forEach(({el})=>{if(Number.isFinite(v.currentTime)&&Math.abs(el.currentTime-v.currentTime)>.15)try{el.currentTime=v.currentTime;}catch{}});};
  const play=()=>{playing=true;sync();if(context.state!=='running'){context.resume().catch(()=>{});onError('点击开始播放以启用声音');}audio.forEach(({el})=>el.play().catch(()=>onError('音频尚未获准播放，请点击开始播放')));};
  const pause=()=>{playing=false;audio.forEach(({el})=>el.pause());};
  v.addEventListener('playing',play);v.addEventListener('pause',pause);v.addEventListener('waiting',pause);v.addEventListener('seeking',sync);
  const timer=setInterval(()=>{if(playing)sync();},250);
  return()=>{clearInterval(timer);v.removeEventListener('playing',play);v.removeEventListener('pause',pause);v.removeEventListener('waiting',pause);v.removeEventListener('seeking',sync);audio.forEach(({el})=>{el.pause();el.removeAttribute('src');el.load();});tracks.current=[];v._audioTracks=[];context.close().catch(()=>{});v._audioContext=null;v.muted=false;};
 },[current?.id,manifest]);
 useEffect(()=>{tracks.current.forEach(({kind,gain})=>{gain.gain.setTargetAtTime(kind===variant?1:0,gain.context.currentTime,.008);});},[variant,manifest]);
 useEffect(()=>{if(!lease||paused)tracks.current.forEach(({el})=>el.pause());},[lease,paused]);
 return manifest;
}
