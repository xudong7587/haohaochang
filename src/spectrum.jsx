import React,{useEffect,useRef} from 'react';
export function Spectrum({video}){
 const canvas=useRef();
 useEffect(()=>{
  const v=video.current,c=canvas.current;if(!v||!c)return;
  // One audio context per element; the video audio is muted and only used to analyse.
  let raf;const bins=new Uint8Array(64),g=c.getContext('2d');
  const draw=()=>{
   const track=v._audioTracks?.find(t=>t.gain.gain.value>.5);if(track)track.analyser.getByteFrequencyData(bins);

   g.clearRect(0,0,960,180);g.fillStyle='#b5a6ec';for(let i=0;i<bins.length;i++){const h=Math.max(2,bins[i]/255*150);g.fillRect(i*15,180-h,8,h);}raf=requestAnimationFrame(draw);
  };draw();return()=>cancelAnimationFrame(raf);
 },[video]);
 return <canvas className="audio-spectrum" ref={canvas} width="960" height="180" aria-label="音频频谱"/>;
}
