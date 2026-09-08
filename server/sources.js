import {run} from './process.js';
import {mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export function canonicalVideo(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('请输入完整视频链接'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) throw new Error('只支持 HTTPS 平台视频链接');
  const host = url.hostname.toLowerCase();
  if (['www.youtube.com','youtube.com','m.youtube.com','youtu.be'].includes(host)) {
    const id = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
    if (!/^[\w-]{11}$/.test(id || '')) throw new Error('请输入 YouTube watch 视频链接');
    return `https://www.youtube.com/watch?v=${id}`;
  }
  if (['www.bilibili.com','bilibili.com'].includes(host)) {
    const id = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]+|av\d+)\/?$/)?.[1];
    if (!id) throw new Error('请输入 Bilibili /video/BV… 链接');
    return `https://www.bilibili.com/video/${id}`;
  }
  throw new Error('仅支持 Bilibili 和 YouTube 视频');
}
export async function onlineSearch(query, provider) {
  if (provider === 'bilibili') {
    const url = new URL('https://api.bilibili.com/x/web-interface/search/type');
    url.search = new URLSearchParams({ search_type: 'video', keyword: query, page: '1' }).toString();
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Bilibili 搜索暂时不可用，可粘贴视频链接');
    const data = await response.json();
    if (data.code !== 0) throw new Error('Bilibili 拒绝了搜索请求，可粘贴视频链接');
    return (data.data?.result || []).slice(0, 12).map(v => ({ title: v.title.replace(/<[^>]*>/g, ''), artist: v.author, url: `https://www.bilibili.com/video/${v.bvid}`, provider }));
  }
  const data = JSON.parse(await run(process.env.YTDLP || 'yt-dlp', ['--ignore-config', '--flat-playlist', '--dump-single-json', '--no-warnings', '--', `ytsearch12:${query}`], 45000));
  return (data.entries || []).map(v => ({ title: v.title, artist: v.channel || v.uploader || 'YouTube', url: `https://www.youtube.com/watch?v=${v.id}`, provider: 'youtube' }));
}
export async function downloadVideo(url, dir, cookieFile) {
  await mkdir(dir, { recursive: true });
  const id = createHash('sha256').update(canonicalVideo(url)).digest('hex').slice(0, 24);
  const file = path.join(dir, `${id}.mp4`);
  try {await stat(file);return {id,file};}catch{}
  try {
    await run(process.env.YTDLP || 'yt-dlp', [...(cookieFile?['--cookies',cookieFile]:[]),'--ignore-config', '--no-playlist', '--no-warnings', '--socket-timeout', '20', '--retries', '2', '--max-filesize', '2G', '-f', 'bv*[height<=1080]+ba/b[height<=1080]', '--merge-output-format', 'mp4', '--recode-video', 'mp4', '-o', file, '--', canonicalVideo(url)], 1800000);
    await stat(file);return {id,file};
  } catch {
    const audio=path.join(dir,`${id}.m4a`);
    await run(process.env.YTDLP||'yt-dlp',[...(cookieFile?['--cookies',cookieFile]:[]),'--ignore-config','--no-playlist','--socket-timeout','20','--max-filesize','200M','-x','--audio-format','m4a','-o',path.join(dir,`${id}.%(ext)s`),'--',canonicalVideo(url)],1800000);
    await stat(audio);return {id,file:audio};
  }
}
