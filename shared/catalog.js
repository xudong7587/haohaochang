// Discovery metadata only. Lyrics/media are acquired separately, never invented.
const artists={
 '周杰伦':['可爱女人','晴天','七里香','稻香','青花瓷','夜曲','简单爱','星晴','安静','搁浅','告白气球','一路向北','彩虹','晴天','珊瑚海'],
 '林俊杰':['江南','曹操','一千年以后','小酒窝','修炼爱情','可惜没如果','她说','背对背拥抱'],
 '陈奕迅':['十年','好久不见','爱情转移','浮夸','富士山下','K歌之王','你的背包','孤勇者'],
 '孙燕姿':['遇见','天黑黑','我怀念的','开始懂了','绿光'],
 '五月天':['倔强','温柔','突然好想你','知足','恋爱ING'],
 '王菲':['红豆','传奇','我愿意','匆匆那年'],
 '张学友':['吻别','一路上有你','她来听我的演唱会','一千个伤心的理由'],
 '刘德华':['忘情水','冰雨','练习','今天'],
 '张惠妹':['听海','剪爱','记得','如果你也听说'],
 '梁静茹':['勇气','宁夏','可惜不是你','暖暖','分手快乐'],
 '蔡依林':['倒带','日不落','说爱你'],
 '陶喆':['爱很简单','普通朋友','就是爱你'],
 '邓紫棋':['泡沫','光年之外','喜欢你'],
 '李荣浩':['模特','年少有为','李白'],
 '薛之谦':['演员','丑八怪','认真的雪'],
 '毛不易':['消愁','像我这样的人'],
 '许嵩':['有何不可','素颜','清明雨上'],
 '张信哲':['过火','爱如潮水','信仰'],
 '周华健':['朋友','花心','让我欢喜让我忧'],
 '任贤齐':['心太软','伤心太平洋'],
 'Beyond':['海阔天空','光辉岁月','真的爱你'],
 '伍佰':['挪威的森林','突然的自我','泪桥'],
 '张韶涵':['隐形的翅膀','欧若拉'],
 '张碧晨':['年轮'], '汪峰':['春天里','北京北京'], '朴树':['平凡之路','那些花儿']
};
export const catalogSeed=Object.entries(artists).flatMap(([artist,titles])=>[...new Set(titles)].map(title=>({title,artist})));
export function recordingVersion(text){
 const value=String(text||'');
 return [['cover',/翻唱|\bcover\b/i],['live',/现场|演唱会|\blive\b/i],['rerecording',/重录|\brerecording\b/i],['acoustic',/不插电|\bacoustic\b/i],['remix',/混音|\bremix\b/i]].filter(([,pattern])=>pattern.test(value)).map(([name])=>name).join(' / ');
}
export function identifyTitle(text){
 const cleaned=String(text||'').replace(/【[^】]*】|\[[^\]]*\]/g,' ').trim();
 const match=catalogSeed.filter(s=>cleaned.toLowerCase().includes(s.artist.toLowerCase())&&cleaned.includes(s.title)).sort((a,b)=>b.title.length-a.title.length)[0];
 if(match){const version=recordingVersion(text);return {...match,...(version?{version,reviewReasons:['recording-version-needs-review']}:{}),needs_review:version?1:0};}
 const pieces=cleaned.split(/\s*[-–—]\s*/);
 return {artist:pieces.length>1?pieces[0]:'未知歌手',title:pieces.length>1?pieces.slice(1).join(' - '):cleaned,needs_review:1};
}
export function identifyVideo(info){
 const direct=identifyTitle(info.title);
 let result=direct;
 if(direct.needs_review){
  const names=[...new Set(catalogSeed.map(s=>s.artist))].filter(name=>String(info.videoTitle||'').includes(name));
  if(names.length===1){const matched=identifyTitle(names[0]+' - '+info.title);result={...matched,title:matched.needs_review?direct.title:matched.title,artist:names[0]};}
 }
 const version=recordingVersion(`${info.title||''} ${info.videoTitle||''}`);
 return version?{...result,version,needs_review:1,reviewReasons:[...new Set([...(result.reviewReasons||[]),'recording-version-needs-review'])]}:result;
}
