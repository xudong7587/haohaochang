export function favoriteConfig(input,old={}){
 let id=String(input.favoriteId||'').trim();if(id.startsWith('http')){const url=new URL(id);id=url.searchParams.get('fid')||'';}
 if(id&&!/^\d{1,24}$/.test(id))throw new Error('请填写收藏夹 ID 或带 fid 的收藏夹链接，不是用户 UID');
 if(input.enabled&&!id)throw new Error('请填写要监控的收藏夹');
 const cookie=input.clearCookie?'':String(input.cookie||old.cookie||'').slice(0,16000);if(/[\r\n]/.test(cookie))throw new Error('Cookie 不能包含换行');
 return {enabled:input.enabled===true,favoriteId:id,cookie,intervalMinutes:Math.max(5,Math.min(1440,Number(input.intervalMinutes)||10))};
}
export async function favoritePage(config,page=1,fetcher=fetch){
 const url=new URL('https://api.bilibili.com/x/v3/fav/resource/list');for(const [k,v]of Object.entries({media_id:config.favoriteId,pn:page,ps:20,order:'mtime',type:0,tid:0}))url.searchParams.set(k,String(v));
 const r=await fetcher(url,{headers:{'User-Agent':'Mozilla/5.0',Referer:'https://www.bilibili.com/',...(config.cookie?{Cookie:config.cookie}:{})},signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!r.ok)throw new Error('收藏夹访问失败（'+r.status+'）');const body=await r.json();if(body.code!==0)throw new Error('收藏夹不可访问，请检查权限或 Cookie（'+body.code+'）');
 return {items:(body.data?.medias||[]).filter(m=>/^BV[0-9a-z]+$/i.test(m.bvid||'')).map(m=>({bvid:m.bvid,title:String(m.title||'').slice(0,200),url:'https://www.bilibili.com/video/'+m.bvid})),hasMore:body.data?.has_more===true};
}
