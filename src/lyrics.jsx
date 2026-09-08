import React,{useEffect,useState} from 'react';
import {parseLyrics,progress} from '../shared/lyrics.js';
export {parseLyrics} from '../shared/lyrics.js';
export function Lyrics({song,time,token}){
 const [style,setStyle]=useState({font:'sans-serif',size:48,color:'#ffd66e',offset:0});
 useEffect(()=>{fetch('/api/lyrics-style?token='+encodeURIComponent(token)).then(r=>r.ok?r.json():null).then(v=>{if(v)setStyle(v);}).catch(()=>{});},[song.id]);
 const clock=time+(style.offset||0),lines=parseLyrics(song.lyrics),index=lines.reduce((found,l,i)=>l.time<=clock?i:found,-1),line=lines[index],end=lines[index+1]?.time||song.duration;
 return <div className="lyrics-scene" style={{fontFamily:style.font,'--karaoke-size':style.size+'px','--karaoke-color':style.color}}>{!!song.needs_video&&<div className="audio-title"><small>音频舞台 · 待补 MTV</small><h2>{song.title}</h2><p>{song.artist}</p></div>}{lines.length?<div className="lyric-lines"><strong className={line?.words?.length?'':'karaoke-line'} style={{'--lyric-fill':progress(clock,line?.time||0,end)+'%'}}>{!line?'前奏，准备开唱…':line.words.length?line.words.map((word,i)=><span key={i} className="karaoke-line" style={{'--lyric-fill':progress(clock,word.time,line.words[i+1]?.time||end)+'%'}}>{word.text}</span>):line.text}</strong><span>{lines[Math.max(0,index+1)]?.text}</span></div>:<div className="lyric-lines"><strong>{song.lyrics||'歌词待补充'}</strong><span>{song.lyrics?'纯文本歌词 · 暂无时间轴':'请在后台自动查找或导入 LRC'}</span></div>}</div>;
}
