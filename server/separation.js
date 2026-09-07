import { mkdir, rename, stat } from 'node:fs/promises';
import { createWriteStream, openAsBlob } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { run } from './media.js';

// Adapter contract is documented in docs/AI-SEPARATION.md. Never send a room token to providers.
export function providerConfig(input, old = {}) {
  const endpoint = String(input.endpoint || '').trim().replace(/\/$/, '');
  if(endpoint){const url=new URL(endpoint);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('分离服务地址格式错误');}
  if(input.enabled && (!endpoint || !String(input.model||'').trim()))throw new Error('启用 AI 分离前请填写地址和模型');
  return {enabled:input.enabled===true,endpoint,model:String(input.model||'').slice(0,120),apiKey:input.clearKey?'':String(input.apiKey||old.apiKey||'').slice(0,2000)};
}
const headers = config => config.apiKey ? {Authorization:`Bearer ${config.apiKey}`} : {};
export async function testProvider(config) {
  if(!config.endpoint)throw new Error('请先填写分离服务地址');
  const response=await fetch(`${config.endpoint}/health`,{headers:headers(config),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw new Error(`分离服务检测失败 (${response.status})`);
  const data=await response.json();if(data.protocol!=='ktv-separation-v1')throw new Error('服务不是 ktv-separation-v1 协议，请部署适配器');
  return {ok:true,protocol:data.protocol};
}
async function saveResult(value, config, target) {
  const url=new URL(value,config.endpoint+'/');
  // Provider artifacts must come from its configured origin. This also prevents token leakage to redirects/CDNs.
  if(url.origin!==new URL(config.endpoint).origin)throw new Error('分离结果必须由配置的服务同源提供');
  const response=await fetch(url,{headers:headers(config),signal:AbortSignal.timeout(300000),redirect:'error'});
  if(!response.ok||!response.body)throw new Error(`分离结果下载失败 (${response.status})`);
  let total=0;
  const limit=new Transform({transform(chunk,encoding,callback){total+=chunk.length;callback(total>1024*1024*1024?new Error('分离结果超过 1 GB'):null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(target+'.tmp'));
  await rename(target+'.tmp',target);
}
export async function separateSong(store,song,cache){
  const config=store.get('ai',{});if(!config.enabled) return false;
  const dir=path.join(cache,'stems',song.id);await mkdir(dir,{recursive:true});
  const backing=path.join(dir,'backing.wav');
  const vocal=path.join(cache,`${song.id}-vocal.mp4`);
  const source=path.join(dir,'input.m4a');
  await run(process.env.FFMPEG||'ffmpeg',['-y','-v','error','-i',vocal,'-vn','-c:a','aac','-b:a','192k',source],600000);
  if((await stat(source)).size>100*1024*1024)throw new Error('待分离音频超过 100 MB');
  const form=new FormData();form.set('file',await openAsBlob(source,{type:'audio/mp4'}),'input.m4a');form.set('model',config.model);
  const response=await fetch(`${config.endpoint}/separate`,{method:'POST',headers:headers(config),body:form,signal:AbortSignal.timeout(120000),redirect:'error'});
  if(!response.ok)throw new Error(`AI 分离请求失败 (${response.status})`);
  let result=await response.json();const deadline=Date.now()+1800000;
  while(result.status==='queued'||result.status==='running'){
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(result.id||''))throw new Error('分离服务返回了无效任务 ID');
    if(Date.now()>deadline)throw new Error('AI 分离超过 30 分钟，请在后台重试');
    await new Promise(resolve=>setTimeout(resolve,3000));
    const poll=await fetch(`${config.endpoint}/jobs/${result.id}`,{headers:headers(config),signal:AbortSignal.timeout(20000),redirect:'error'});
    if(!poll.ok)throw new Error(`分离任务查询失败 (${poll.status})`);result=await poll.json();
  }
  if(result.status!=='done'||!result.instrumental_url)throw new Error('AI 分离失败或缺少伴奏结果');
  await saveResult(result.instrumental_url,config,backing);
  const output=path.join(cache,`${song.id}-backing.mp4`);
  if(!Number.isFinite(song.duration)||song.duration<=0)throw new Error('无法读取歌曲时长');
  await run(process.env.FFMPEG||'ffmpeg',['-y','-v','error','-i',vocal,'-i',backing,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-af','apad','-t',String(song.duration),'-shortest','-movflags','+faststart','-f','mp4',output+'.tmp'],600000);
  await rename(output+'.tmp',output);
  store.db.prepare("UPDATE songs SET mode='separated',status='ready',error='' WHERE id=?").run(song.id);
  return true;
}
