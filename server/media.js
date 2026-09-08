import {preparePackage} from './song-package.js';
import {run} from './process.js';
export {run} from './process.js';
import {resourceFolder,preserveSource,archiveVersion} from './assets.js';
import {audioVisualArgs} from './visualization.js';
import { metadata } from './library.js';
import { readdir, realpath, stat, mkdir, rename, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pinyin } from 'pinyin-pro';

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
      if (entry.isSymbolicLink() || entry.name===resourceFolder) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file, root);
      else if (/\.(mp4|mkv|avi|mov|webm|m4v|mpg|mpeg|ts|mp3|flac|wav|m4a|ogg|aac)$/i.test(entry.name)) {
        const id = store.db.prepare('SELECT id FROM songs WHERE path=?').get(file)?.id || createHash('sha256').update(file).digest('hex').slice(0, 24);
        const {artist,title,poster,tags,metadata_source,needs_review}=await metadata(file,[root]);
        count += Number(store.db.prepare('INSERT OR IGNORE INTO songs (id,path,title,artist,search,created) VALUES (?,?,?,?,?,?)').run(id, file, title, artist, searchText(title, artist), Date.now()).changes);
        store.db.prepare("UPDATE songs SET title=?,artist=?,search=?,metadata_source=?,needs_review=? WHERE id=? AND metadata_source NOT IN ('手动','AI')").run(title,artist,searchText(title,artist),metadata_source,needs_review,id);
        store.db.prepare('UPDATE songs SET poster=? WHERE id=?').run(poster,id);
        store.db.prepare("UPDATE songs SET tags=? WHERE id=? AND tags_manual=0 AND metadata_source!='AI'").run(JSON.stringify(tags),id);
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
  return { hasVideo:!!data.streams?.some(s=>s.codec_type==='video'&&!s.disposition?.attached_pic), videoCodec:data.streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic)?.codec_name,pixelFormat:data.streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic)?.pix_fmt, duration: Number(data.format?.duration || 0), audio: data.streams.filter(s => s.codec_type === 'audio').map((s, i) => ({ index: i, channels: s.channels, codec: s.codec_name, title: s.tags?.title || `音轨 ${i + 1}` })) };
}
export async function prepareSong(store, id, roots, cache) {
  const song = store.db.prepare('SELECT * FROM songs WHERE id=?').get(id);
  if (!song) throw new Error('歌曲不存在');
  let file;
  try{file=await safeMedia(song.path,roots);}catch(error){
    // Old installations retained the source separately. Recover only this song's recorded backup.
    try{const folder=path.join(cache,'sources',song.id);const record=JSON.parse(await readFile(path.join(folder,'song.json'),'utf8'));if(path.basename(record.retained)!==record.retained)throw error;file=await safeMedia(path.join(folder,record.retained),[cache]);store.db.prepare('UPDATE songs SET path=? WHERE id=?').run(file,id);}catch{throw error;}
  }
  const info = await probe(file);
  if(store.get('video-source:'+id)?.keepAudio){try{await stat(path.join(store.get('package:'+id),'画面.mp4'));info.hasVideo=true;}catch{}}
  if (!info.audio.length) throw new Error('文件没有音频轨道');
  store.db.prepare('UPDATE songs SET needs_video=? WHERE id=?').run(info.hasVideo?0:1,id);
  if (song.mode === 'tracks' && (!info.audio[song.backing] || !info.audio[song.vocal] || song.backing === song.vocal)) throw new Error('请选择两个不同且有效的原唱/伴奏音轨');
  if (song.mode === 'channels' && info.audio[0].channels < 2) throw new Error('声道切换需要立体声音轨');
  await preparePackage(store,{...song,path:file},info,cache);
  store.db.prepare("UPDATE songs SET duration=?,audio=?,status='ready',error='' WHERE id=?").run(info.duration,JSON.stringify(info.audio),id);
}
export {canonicalVideo,onlineSearch,downloadVideo} from './sources.js';
