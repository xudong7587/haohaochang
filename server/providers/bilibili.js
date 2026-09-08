const headers=cookie=>({'User-Agent':'Mozilla/5.0',Referer:'https://www.bilibili.com/',...(cookie?{Cookie:cookie}:{})});
const duration=value=>typeof value==='number'?value:String(value||'').split(':').reduce((total,part)=>total*60+Number(part),0)||null;

export const bilibiliProvider={
 async search(query,cookie='',fetcher=fetch){
  const url=new URL('https://api.bilibili.com/x/web-interface/search/type');
  url.search=new URLSearchParams({search_type:'video',keyword:query,page:'1'}).toString();
  const response=await fetcher(url,{headers:headers(cookie),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw new Error('Bilibili 搜索暂时不可用，可粘贴视频链接');
  const body=await response.json();if(body.code!==0)throw new Error('Bilibili 拒绝了搜索请求，可粘贴视频链接');
  return (body.data?.result||[]).slice(0,12).map(row=>({title:String(row.title||'').replace(/<[^>]*>/g,''),artist:row.author,uploader:row.author,url:`https://www.bilibili.com/video/${row.bvid}`,duration:duration(row.duration),provider:'bilibili'}));
 },
 async metadata(url,cookie='',fetcher=fetch){
  const parsed=new URL(url),id=parsed.pathname.split('/').filter(Boolean).pop();
  const endpoint=new URL('https://api.bilibili.com/x/web-interface/view');
  endpoint.searchParams.set(id.startsWith('BV')?'bvid':'aid',id.replace(/^av/,''));
  const response=await fetcher(endpoint,{headers:headers(cookie),signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw new Error('B站信息读取失败');
  const body=await response.json();if(body.code!==0||!body.data)throw new Error('B站视频不可访问');
  const pageNumber=Number(parsed.searchParams.get('p')||1),pages=body.data.pages||[];
  const page=pages.find(row=>row.page===pageNumber);
  if(!page&&(pageNumber>1||pages.length))throw new Error('请求的 B站分 P 不存在，请重新选择分 P');
  return {url,title:page&&pages.length>1?page.part:body.data.title,videoTitle:body.data.title,uploader:body.data.owner?.name,duration:page?.duration??body.data.duration};
 }
};
