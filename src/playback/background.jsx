import React,{useMemo,useState,useEffect} from 'react';
import {backgroundImages} from './manifest.js';
export function Background({background,token,time}) {
  const images=useMemo(()=>backgroundImages(background,token),[background,token]);
  const [failed,setFailed]=useState([]);
  useEffect(()=>setFailed([]),[images]);
  const available=images.filter(image=>!failed.includes(image.url)),seconds=Math.max(3,Number(background?.intervalSeconds)||12);
  const image=available.length?available[Math.floor(Math.max(0,time)/seconds)%available.length]:null;
  if(!image)return null;
  return <img key={image.url} className="playback-background" src={image.url} alt="" onError={()=>setFailed(items=>[...items,image.url])} style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',opacity:.65,pointerEvents:'none'}}/>;
}
