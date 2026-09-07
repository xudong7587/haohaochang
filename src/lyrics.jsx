import React from 'react';
export function parseLyrics(text=''){
  const offset=Number(text.match(/\[offset:([+-]?\d+)\]/)?.[1]||0)/1000;
  return text.split(/\r?\n/).flatMap(line=>{
    const words=line.replace(/\[[^\]]+\]/g,'').trim();if(!words)return [];
    return [...line.matchAll(/\[(\d+):(\d{1,2}(?:\.\d+)?)\]/g)].map(m=>({time:Number(m[1])*60+Number(m[2])-offset,text:words}));
  }).sort((a,b)=>a.time-b.time);
}
export function Lyrics({song,time}){
  const lines=parseLyrics(song.lyrics), index=lines.reduce((found,l,i)=>l.time<=time?i:found,-1);
  return <div className="lyrics-scene"><div className="lyric-orbit" aria-hidden="true">♪</div><small>音频临时播放 · 待补视频</small><h2>{song.title}</h2><p>{song.artist}</p>{lines.length?<div className="lyric-lines"><span>{lines[Math.max(0,index-1)]?.text}</span><strong>{index>=0?lines[index]?.text:'前奏，准备开唱…'}</strong><span>{lines[Math.max(0,index+1)]?.text}</span></div>:<div className="lyric-lines"><strong>{song.lyrics||'跟着熟悉的旋律，自在开唱'}</strong><span>{song.lyrics?'暂无时间轴，可在后台补充 LRC 歌词':'歌词待补充，可在后台导入同名 LRC'}</span></div>}</div>;
}
