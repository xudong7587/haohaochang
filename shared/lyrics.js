export function parseLyrics(text=''){
 const offset=Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1]||0)/1000;
 const seconds=(m,s)=>Number(m)*60+Number(s)-offset;
 return text.split(/\r?\n/).flatMap(line=>{
  const words=[...line.matchAll(/<(\d+):(\d{1,2}(?:\.\d+)?)>([^<]*)/g)].map(m=>({time:seconds(m[1],m[2]),text:m[3]}));
  const plain=line.replace(/\[[^\]]+\]|<[^>]+>/g,'').trim();if(!plain)return [];
  return [...line.matchAll(/\[(\d+):(\d{1,2}(?:\.\d+)?)\]/g)].map(m=>({time:seconds(m[1],m[2]),text:plain,words}));
 }).sort((a,b)=>a.time-b.time);
}
export const progress=(time,start,end)=>end>start?Math.max(0,Math.min(100,(time-start)/(end-start)*100)):time>=start?100:0;
