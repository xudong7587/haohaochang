import { spawn } from 'node:child_process';
import { readdir, realpath, stat, mkdir, rename, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pinyin } from 'pinyin-pro';

export function run(binary, args, timeout = 120000, maxOutput = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', failure;
    const timer = setTimeout(() => { failure = new Error('处理超时，请稍后重试'); child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', d => { out += d; if (out.length > maxOutput) { failure = new Error('工具输出过大'); child.kill('SIGKILL'); } });
    child.stderr.on('data', d => { err = (err + d).slice(-4000); });
    child.on('error', e => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? `${binary} 未安装；请使用 Docker 运行完整媒体功能` : e.message)); });
    child.on('close', code => { clearTimeout(timer); code === 0 && !failure ? resolve(out) : reject(failure || new Error(err || `${binary} 处理失败 (${code})`)); });
  });
}
export function searchText(title, artist) {
  const text = `${title} ${artist}`;
  return `${text} ${pinyin(text, { toneType: 'none' })} ${pinyin(text, { pattern: 'first', toneType: 'none' }).replaceAll(' ', '')}`.toLowerCase();
}
export function inside(root, candidate) { const rel = path.relative(root, candidate); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }
export async function safeMedia(file, roots) {
  const actual = await realpath(file);
  for (const root of roots) { try { if (inside(await realpath(root), actual)) return actual; } catch {} }
  throw new Error('媒体文件不在挂载目录内');
}
export async function scanLibrary(store, roots) {
  let count = 0;
  async function walk(dir, root) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file, root);
      else if (/\.(mp4|mkv|avi|mov|webm|m4v|mpg|mpeg|ts|mp3|flac|wav|m4a|ogg|aac)$/i.test(entry.name)) {
        const id = createHash('sha256').update(file).digest('hex').slice(0, 24);
        const parts = path.parse(entry.name).name.split(' - ');
        const artist = parts.length > 1 ? parts.shift() : '未知歌手';
        const title = parts.join(' - ');
        count += Number(store.db.prepare('INSERT OR IGNORE INTO songs (id,path,title,artist,search,created) VALUES (?,?,?,?,?,?)').run(id, file, title, artist, searchText(title, artist), Date.now()).changes);
        if(/\.(mp3|flac|wav|m4a|ogg|aac)$/i.test(entry.name))store.db.prepare('UPDATE songs SET needs_video=1 WHERE id=?').run(id);
        try {const lrc=await safeMedia(path.join(dir,path.parse(entry.name).name+'.lrc'),[root]);if((await stat(lrc)).size<100000)store.db.prepare("UPDATE songs SET lyrics=? WHERE id=? AND lyrics=''").run(await readFile(lrc,'utf8'),id);}catch{}
      }
    }
  }
  for (const root of roots) await walk(root, root);
  return count;
}
export async function probe(file) {
  const data = JSON.parse(await run(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  return { hasVideo:!!data.streams?.some(s=>s.codec_type==='video'&&!s.disposition?.attached_pic), duration: Number(data.format?.duration || 0), audio: data.streams.filter(s => s.codec_type === 'audio').map((s, i) => ({ index: i, channels: s.channels, codec: s.codec_name, title: s.tags?.title || `音轨 ${i + 1}` })) };
}
export async function prepareSong(store, id, roots, cache) {
  const song = store.db.prepare('SELECT * FROM songs WHERE id=?').get(id);
  if (!song) throw new Error('歌曲不存在');
  const file = await safeMedia(song.path, roots);
  const fileStat=await stat(file);
  const fingerprint=JSON.stringify([fileStat.size,fileStat.mtimeMs,song.mode,song.backing,song.vocal]);
  if(store.get(`cache:${id}`)===fingerprint || song.mode==='separated') {
    try { if(song.mode!=='instrumental')await stat(path.join(cache,`${id}-vocal.mp4`));if(song.mode!=='original')await stat(path.join(cache,`${id}-backing.mp4`));store.db.prepare("UPDATE songs SET status='ready',error='' WHERE id=?").run(id);return; } catch {if(song.mode==='separated')throw new Error('分离缓存缺失，请将资源类型改为普通 MV 后重新准备');}
  }
  const info = await probe(file);
  if (!info.audio.length) throw new Error('文件没有音频轨道');
  store.db.prepare('UPDATE songs SET needs_video=? WHERE id=?').run(info.hasVideo?0:1,id);
  if (song.mode === 'tracks' && (!info.audio[song.backing] || !info.audio[song.vocal] || song.backing === song.vocal)) throw new Error('请选择两个不同且有效的原唱/伴奏音轨');
  if (song.mode === 'channels' && info.audio[0].channels < 2) throw new Error('声道切换需要立体声音轨');
  await mkdir(cache, { recursive: true });
  for (const variant of song.mode === 'original' ? ['vocal'] : song.mode==='instrumental'?['backing']:['backing', 'vocal']) {
    const track = song.mode === 'tracks' ? song[variant] : 0;
    const output = path.join(cache, `${id}-${variant}.mp4`);
    const args = ['-y', '-v', 'error', '-i', file];
    if(!info.hasVideo){
      let cover;
      for(const candidate of [path.join(path.dirname(file),path.parse(file).name+'.jpg'),path.join(path.dirname(file),'cover.jpg')]){try{cover=await safeMedia(candidate,roots);break;}catch{}}
      if(cover)args.push('-loop','1','-i',cover);else args.push('-f','lavfi','-i','color=c=0x272433:s=1280x720:r=15');
    }
    args.push('-map',info.hasVideo?'0:v:0':'1:v:0','-map', `0:a:${track}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-vf', "scale=w='min(1920,iw)':h=-2", '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k');
    if(!info.hasVideo)args.push('-shortest');
    if (song.mode === 'channels') args.push('-af', `pan=stereo|c0=c${song[variant]}|c1=c${song[variant]}`);
    args.push('-movflags', '+faststart', '-f', 'mp4', output + '.tmp');
    await run(process.env.FFMPEG || 'ffmpeg', args, 3600000);
    await rename(output + '.tmp', output);
  }
  store.db.prepare("UPDATE songs SET duration=?,audio=?,status='ready',error='' WHERE id=?").run(info.duration, JSON.stringify(info.audio), id);
  store.set(`cache:${id}`,fingerprint);
}
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
export async function downloadVideo(url, dir) {
  await mkdir(dir, { recursive: true });
  const id = createHash('sha256').update(canonicalVideo(url)).digest('hex').slice(0, 24);
  const file = path.join(dir, `${id}.mp4`);
  try {await stat(file);return {id,file};}catch{}
  try {
    await run(process.env.YTDLP || 'yt-dlp', ['--ignore-config', '--no-playlist', '--no-warnings', '--socket-timeout', '20', '--retries', '2', '--max-filesize', '2G', '-f', 'bv*[height<=1080]+ba/b[height<=1080]', '--merge-output-format', 'mp4', '--recode-video', 'mp4', '-o', file, '--', canonicalVideo(url)], 1800000);
    await stat(file);return {id,file};
  } catch {
    const audio=path.join(dir,`${id}.m4a`);
    await run(process.env.YTDLP||'yt-dlp',['--ignore-config','--no-playlist','--socket-timeout','20','--max-filesize','200M','-x','--audio-format','m4a','-o',path.join(dir,`${id}.%(ext)s`),'--',canonicalVideo(url)],1800000);
    await stat(audio);return {id,file:audio};
  }
}
