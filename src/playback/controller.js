// React-free lifecycle. One song clock drives audio, picture, lyrics and spectrum.
export function createPlaybackController({video,manifest,createAudio=url=>new Audio(url),createContext=()=>{const C=globalThis.AudioContext||globalThis.webkitAudioContext;return C?new C():null;},onStatus=()=>{},onEnded=()=>{},schedule=setInterval,cancel=clearInterval}) {
  let context=null,disposed=false,epoch=0,lease=false,paused=true,variant='backing',lastTime=0,ended=false,contextBlocked=false;
  const tracks=[],listeners=[];
  const listen=(el,event,fn)=>{el.addEventListener(event,fn);listeners.push(()=>el.removeEventListener(event,fn));};
  const active=()=>tracks.filter(t=>!t.failed&&!t.finished);
  const audible=()=>active().filter(t=>!t.blocked);
  const selected=()=>audible().find(t=>t.kind===variant)||audible()[0]||active().find(t=>t.kind===variant)||active()[0];
  const allowed=()=>lease&&!paused&&!disposed;
  const getTime=()=>{const t=selected();return t&&!t.failed&&Number.isFinite(t.el.currentTime)?Math.max(0,t.el.currentTime-t.offset):lastTime;};
  function status(){if(disposed)return;const chosen=selected();onStatus({blocked:allowed()&&(contextBlocked||(!audible().length&&!!active().length)),error:!active().length?'原唱与伴奏均无法加载，请重试或在后台重新准备资源':'',warning:chosen&&chosen.kind!==variant?`已切换到可用${chosen.kind==='vocal'?'原唱':'伴奏'}`:'',variant:chosen?.kind});}
  function volume(){const chosen=selected();for(const t of tracks){const value=t===chosen&&!t.failed?1:0;if(t.gain)t.gain.gain.setTargetAtTime(value,context.currentTime,.008);else t.el.volume=value;}status();}
  function align(el,time){if(Number.isFinite(time)&&Math.abs((el.currentTime||0)-time)>.12)try{el.currentTime=Math.max(0,time);}catch{}}
  function sync(){if(disposed)return;lastTime=getTime();const master=selected();for(const t of active())if(t!==master)align(t.el,lastTime+t.offset);if(manifest.resources.video)align(video,lastTime+manifest.resources.video.offset);}
  function failure(t){if(disposed)return;const position=lastTime;t.failed=true;t.el.pause();const next=selected();if(next)align(next.el,position+next.offset);volume();}
  try{context=createContext();contextBlocked=!!context&&context.state!=='running';}catch{}
  for(const kind of ['vocal','backing']) {
    const resource=manifest.resources[kind];if(!resource)continue;
    const el=createAudio(resource.url),track={kind,el,offset:resource.offset||0,failed:false,blocked:false,gain:null,analyser:null};
    el.preload='auto';
    if(context)try{const source=context.createMediaElementSource(el),gain=context.createGain(),analyser=context.createAnalyser();analyser.fftSize=128;source.connect(analyser);analyser.connect(gain);gain.connect(context.destination);track.gain=gain;track.analyser=analyser;}catch{track.failed=true;}
    tracks.push(track);
    listen(el,'error',()=>failure(track));
    listen(el,'loadedmetadata',()=>{if(!disposed)align(el,lastTime+track.offset);});
    listen(el,'ended',()=>{if(disposed)return;const wasSelected=track===selected();if(wasSelected)lastTime=getTime();track.finished=true;if(!allowed()||!wasSelected||ended)return;ended=true;onEnded();});
    el.load();
  }
  video.muted=true;
  if(manifest.resources.video){video.src=manifest.resources.video.url;video.load();listen(video,'error',()=>{if(!disposed)onStatus({pictureError:true,warning:'画面加载失败，音频继续播放'});});}
  else{video.pause();video.removeAttribute('src');video.load();}
  async function start({retry=false}={}) {
    if(!allowed())return false;
    const attempt=++epoch;ended=false;
    if(retry){for(const t of tracks){if(t.failed){t.failed=false;t.el.load();align(t.el,lastTime+t.offset);}t.blocked=false;}}
    // Invoke resume and every play synchronously in the click activation window.
    const pending=[];
    if(context&&context.state!=='running')try{pending.push(Promise.resolve(context.resume()).then(()=>{if(!disposed&&attempt===epoch){contextBlocked=context.state!=='running';volume();}},()=>{if(!disposed&&attempt===epoch){contextBlocked=true;volume();}}));}catch{contextBlocked=true;}
    sync();
    for(const t of active())try{pending.push(Promise.resolve(t.el.play()).then(()=>{if(disposed||attempt!==epoch||!allowed()){if(disposed||!allowed())t.el.pause();return;}t.blocked=false;volume();},error=>{if(disposed||attempt!==epoch)return;if(error?.name==='NotAllowedError'){t.blocked=true;volume();}else if(error?.name!=='AbortError')failure(t);}));}catch(error){if(error?.name==='NotAllowedError')t.blocked=true;else failure(t);}
    if(manifest.resources.video)try{pending.push(Promise.resolve(video.play()).catch(()=>{}));}catch{}
    await Promise.allSettled(pending);
    if(disposed||attempt!==epoch)return false;
    if(!allowed()){stop();return false;}volume();return !contextBlocked&&audible().length>0;
  }
  function stop(){epoch++;for(const t of tracks)t.el.pause();video.pause();}
  function setState(state){const was=allowed(),priorVariant=variant;lastTime=getTime();if('lease'in state)lease=!!state.lease;if('paused'in state)paused=!!state.paused;if(state.variant)variant=state.variant;if(priorVariant!==variant){const newTrack=selected();if(newTrack)align(newTrack.el,lastTime+newTrack.offset);}volume();if(!allowed())stop();else if(!was)void start();}
  const timer=schedule(()=>{if(allowed())sync();},100);
  video._audioTracks=tracks;video._audioContext=context;
  const controller={tracks,context,getTime,start,setState,selected,seek(time){lastTime=Math.max(0,Number(time)||0);for(const t of active())align(t.el,lastTime+t.offset);if(manifest.resources.video)align(video,lastTime+manifest.resources.video.offset);},destroy(){if(disposed)return;disposed=true;stop();cancel(timer);listeners.forEach(remove=>remove());tracks.forEach(({el})=>{el.removeAttribute('src');el.load();});if(video._playback===controller){video.pause();video.removeAttribute('src');video.load();video._audioTracks=[];video._audioContext=null;video._playback=null;}context?.close().catch(()=>{});}};
  video._playback=controller;volume();return controller;
}
