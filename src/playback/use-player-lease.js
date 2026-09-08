import {useEffect,useRef,useState} from 'react';

export function usePlayerLease({request,token}) {
  const playerId=useRef(sessionStorage.getItem('playerId')||`tv-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [lease,setLease]=useState(false),[leaseError,setLeaseError]=useState('正在连接 NAS 播放会话');
  const latestRequest=useRef(request);latestRequest.current=request;
  useEffect(()=>{
    sessionStorage.setItem('playerId',playerId.current);setLease(false);setLeaseError('正在连接 NAS 播放会话');
    let alive=true,inFlight=false,lastSuccess=0,deadline;
    const beat=async()=>{
      if(inFlight||!alive)return;inFlight=true;
      try {
        await Promise.race([latestRequest.current('/player/heartbeat',{id:playerId.current},'POST'),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('与 NAS 的播放连接超时，正在重连')),8000);})]);
        if(alive){lastSuccess=Date.now();setLease(true);setLeaseError('');}
      }catch(error){if(alive){setLease(false);setLeaseError(error.message);}}
      finally{clearTimeout(deadline);inFlight=false;}
    };
    void beat();
    const interval=setInterval(beat,5000),watchdog=setInterval(()=>{if(lastSuccess&&Date.now()-lastSuccess>10000){setLease(false);setLeaseError('与 NAS 的播放连接已中断，正在重连');}},1000);
    return()=>{alive=false;clearInterval(interval);clearInterval(watchdog);clearTimeout(deadline);};
  },[token]);
  return {playerId:playerId.current,lease,leaseError};
}
