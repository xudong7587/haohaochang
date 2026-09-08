import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {pinyin} from 'pinyin-pro';
import {run} from './process.js';
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
export async function probe(file) {
  const data = JSON.parse(await run(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  return { hasVideo:!!data.streams?.some(s=>s.codec_type==='video'&&!s.disposition?.attached_pic), videoCodec:data.streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic)?.codec_name,pixelFormat:data.streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic)?.pix_fmt, duration: Number(data.format?.duration || 0), audio: data.streams.filter(s => s.codec_type === 'audio').map((s, i) => ({ index: i, channels: s.channels, codec: s.codec_name, title: s.tags?.title || `音轨 ${i + 1}` })) };
}
