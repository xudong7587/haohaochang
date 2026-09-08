// All offsets are seconds: media time = song time + resource offset.
export function resourceUrl(url, {token='', revision}={}) {
  const origin=globalThis.location?.origin||'http://localhost',parsed=new URL(url,origin);
  if(parsed.origin===origin&&token)parsed.searchParams.set('token',token);
  if(revision!==undefined&&revision!==null)parsed.searchParams.set('r',String(revision));
  return parsed.origin===origin?parsed.pathname+parsed.search+parsed.hash:parsed.href;
}
export function normalizeManifest(manifest,{songId,token=''}={}) {
  const resources={};
  for(const kind of ['video','vocal','backing','lyrics']) {
    const detail=manifest.resources?.[kind];
    if(detail?.available===false||(!detail?.url&&!manifest[kind]))continue;
    resources[kind]={...detail,url:resourceUrl(detail?.url||`/api/assets/${songId}/${kind}`,{token,revision:detail?.revision??manifest.revision}),offset:Number(detail?.offset)||0,duration:Number(detail?.duration)||0};
  }
  return {...manifest,resources};
}
export function backgroundImages(background,token='') {
  return (background?.images||[]).map(image=>typeof image==='string'?{url:image}:image).filter(image=>image?.url).map(image=>({...image,url:resourceUrl(image.url,{token,revision:image.revision??background.revision})}));
}
