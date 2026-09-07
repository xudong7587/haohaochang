import express from 'express';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { openStore } from './db.js';
import { scanLibrary, prepareSong, canonicalVideo, onlineSearch, downloadVideo, searchText, probe, safeMedia } from './media.js';
import { providerConfig, testProvider, separateSong } from './separation.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const clean = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function createApp(options = {}) {
  const dir = path.resolve(options.dataDir || process.env.DATA_DIR || './data');
  const roots = (options.roots || (process.env.MEDIA_ROOTS || './media').split('|')).map(p => path.resolve(p));
  const downloads = path.join(dir, 'downloads'), cache = path.join(dir, 'cache');
  [downloads, cache].forEach(p => mkdirSync(p, { recursive: true }));
  const store = openStore(dir), { db, get, set } = store;
  const adminToken = options.adminToken || process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN;
  if (!adminToken || adminToken.length < 12) throw new Error('请设置至少 12 位的 ADMIN_PASSWORD（管理密码）');
  const app = express();
  const clients = new Set(), limits = new Map();
  let running = false, stopped = false, player = null;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    if (!['GET','HEAD'].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}`) return next(fail(403, '跨站请求已拒绝'));
    next();
  });
  const token = req => req.get('authorization')?.replace(/^Bearer /, '') || req.query.token;
  const admin = (req, res, next) => equal(token(req), adminToken) ? next() : next(fail(401, '请输入正确的管理密码'));
  const member = (req, res, next) => equal(token(req), get('roomToken')) || equal(token(req), adminToken) ? next() : next(fail(401, '请扫描电视二维码加入客厅'));
  function rate(req, res, next) {
    const key = req.ip, now = Date.now();
    if (limits.size > 1000) for (const [k,v] of limits) if (v.until < now) limits.delete(k);
    const value = limits.get(key) || { n: 0, until: now + 60000 };
    if (value.until < now) { value.n = 0; value.until = now + 60000; }
    value.n++; limits.set(key, value);
    next(value.n > 120 ? fail(429, '操作太快了，请稍后再试') : undefined);
  }
  app.use('/api', rate);
  function snapshot() {
    const queue = db.prepare('SELECT q.*,s.title,s.artist,s.mode,s.duration,s.status,s.needs_video,s.lyrics FROM queue q JOIN songs s ON q.song_id=s.id ORDER BY position').all();
    const pending=db.prepare("SELECT id,kind,payload,status FROM jobs WHERE status IN ('queued','running') AND kind!='scan' ORDER BY created").all().map(j=>{const p=JSON.parse(j.payload);return {id:j.id,title:p.title||db.prepare('SELECT title FROM songs WHERE id=?').get(p.id)?.title||'准备歌曲',status:j.status};});
    return { queue, pending, playback: get('playback'), playerOnline: !!player && Date.now() - player.seen < 15000 };
  }
  function emit(type = 'state', data = snapshot()) { for (const client of clients) client.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
  const revise = (patch = {}) => { const old = get('playback'); set('playback', { ...old, ...patch, revision: old.revision + 1 }); emit(); };
  function enqueue(id, name) {
    const song = db.prepare('SELECT * FROM songs WHERE id=?').get(id);
    if (!song || song.status !== 'ready') throw fail(409, '歌曲尚未就绪，请先在后台准备播放');
    if (db.prepare('SELECT id FROM queue WHERE song_id=?').get(id)) return;
    if (db.prepare('SELECT count(*) AS n FROM queue').get().n >= 100) throw fail(409, '已点列表已满');
    const position = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM queue').get().p;
    db.prepare('INSERT INTO queue VALUES (?,?,?,?)').run(randomUUID(), id, name, position);
    if (snapshot().queue.length === 1) revise({ paused: false, vocal: false }); else emit();
  }
  function addJob(kind, payload) {
    if(kind==='download') {
      const duplicate=db.prepare("SELECT id,payload FROM jobs WHERE kind='download' AND status IN ('queued','running')").all().find(j=>JSON.parse(j.payload).url===payload.url);
      if(duplicate)return duplicate.id;
    }
    if(kind==='prepare') {
      const duplicate=db.prepare("SELECT id,payload FROM jobs WHERE kind='prepare' AND status IN ('queued','running')").all().find(j=>JSON.parse(j.payload).id===payload.id);
      if(duplicate){if(payload.enqueue){const merged={...JSON.parse(duplicate.payload),enqueue:true,name:payload.name};db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(merged),duplicate.id);}return duplicate.id;}
    }
    const existing = db.prepare("SELECT id FROM jobs WHERE kind=? AND payload=? AND status IN ('queued','running')").get(kind, JSON.stringify(payload));
    if (existing) return existing.id;
    const id = randomUUID();
    db.prepare('INSERT INTO jobs (id,kind,payload,status,created) VALUES (?,?,?,?,?)').run(id, kind, JSON.stringify(payload), 'queued', Date.now());
    emit();setImmediate(work);
    return id;
  }
  async function work() {
    if (running || stopped || options.worker === false) return;
    const job = db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").get();
    if (!job) return;
    running = true;
    db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(job.id); emit('library', {});
    const payload = JSON.parse(job.payload);
    try {
      if (job.kind === 'scan') await scanLibrary(store, roots);
      if (job.kind === 'prepare') {
        db.prepare("UPDATE songs SET status='preparing',error='' WHERE id=?").run(payload.id);
        let song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.id);
        await prepareSong(store, payload.id, [...roots, downloads], cache);
        song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.id);
        if(song.mode==='original'&&get('ai',{}).enabled) await separateSong(store,song,cache);
        const latest=JSON.parse(db.prepare('SELECT payload FROM jobs WHERE id=?').get(job.id).payload);
        if(latest.enqueue)enqueue(payload.id,latest.name||'家人');
      }
      if (job.kind === 'download') {
        const { id, file } = await downloadVideo(payload.url, downloads);
        db.prepare('INSERT OR IGNORE INTO songs (id,path,title,artist,search,source,created,mode) VALUES (?,?,?,?,?,?,?,?)').run(id, file, payload.title, payload.artist, searchText(payload.title, payload.artist), payload.url, Date.now(),payload.isBacking?'instrumental':'original');
        await prepareSong(store, id, [...roots, downloads], cache);
        const song=db.prepare('SELECT * FROM songs WHERE id=?').get(id);
        if(song.mode==='original'&&get('ai',{}).enabled&&!payload.isBacking)await separateSong(store,song,cache);
        if (payload.enqueue) enqueue(id, payload.name || '在线点歌');
      }
      db.prepare("UPDATE jobs SET status='done',error='' WHERE id=?").run(job.id);
    } catch (e) {
      db.prepare("UPDATE jobs SET status='failed',error=? WHERE id=?").run(e.message.slice(-1800), job.id);
      if (job.kind === 'prepare') db.prepare("UPDATE songs SET status='error',error=? WHERE id=?").run(e.message.slice(-1800), payload.id);
    } finally { running = false; emit('library', {});emit(); setImmediate(work); }
  }
  app.get('/api/health', (req,res) => res.json({ ok: true }));
  app.post('/api/login', admin, (req,res) => res.json({ token: get('roomToken') }));
  app.get('/api/state', member, (req,res) => res.json(snapshot()));
  app.get('/api/events', member, (req,res) => {
    if (clients.size >= 40) throw fail(429, '连接数过多');
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
    clients.add(res); res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    req.on('close', () => clients.delete(res));
  });
  app.get('/api/songs', member, (req,res) => {
    const q = clean(req.query.q).toLowerCase().replace(/[%_!]/g, '!$&');
    const artist = clean(req.query.artist);
    res.json(db.prepare("SELECT id,title,artist,duration,mode,status,error,source,backing,vocal,audio,needs_video,lyrics FROM songs WHERE search LIKE ? ESCAPE '!' AND (?='' OR artist=?) ORDER BY created DESC LIMIT 300").all(`%${q}%`, artist, artist));
  });
  app.get('/api/artists', member, (req,res) => res.json(db.prepare('SELECT artist,COUNT(*) AS count FROM songs GROUP BY artist ORDER BY artist').all()));
  app.post('/api/queue', member, (req,res) => {
    const id=clean(req.body.songId),name=clean(req.body.name,24)||'家人';
    const song=db.prepare('SELECT * FROM songs WHERE id=?').get(id);if(!song)throw fail(404,'歌曲不存在');
    if(db.prepare('SELECT id FROM queue WHERE song_id=?').get(id))return res.json(snapshot());
    if(song.status!=='ready'||(song.mode==='original'&&get('ai',{}).enabled)) { addJob('prepare',{id,enqueue:true,name});res.json({...snapshot(),preparing:true}); }
    else {enqueue(id,name);res.json(snapshot());}
  });
  app.post('/api/queue/:id/top', member, (req,res) => {
    const queue = snapshot().queue;
    if (!queue.some(q => q.id === req.params.id)) throw fail(404, '歌曲不在队列中');
    const reordered = [queue[0], ...queue.slice(1).filter(q=>q.id === req.params.id), ...queue.slice(1).filter(q=>q.id !== req.params.id)];
    db.exec('BEGIN'); try { reordered.forEach((q,i) => db.prepare('UPDATE queue SET position=? WHERE id=?').run(i,q.id)); db.exec('COMMIT'); } catch(e) { db.exec('ROLLBACK'); throw e; }
    emit(); res.json(snapshot());
  });
  app.delete('/api/queue/:id', member, (req,res) => {
    if (snapshot().queue[0]?.id === req.params.id) throw fail(409, '请使用切歌结束当前歌曲');
    db.prepare('DELETE FROM queue WHERE id=?').run(req.params.id); emit(); res.json(snapshot());
  });
  app.post('/api/control', member, (req,res) => {
    const current = snapshot().queue[0], action = req.body.action;
    if (!current) throw fail(409, '先点一首歌吧');
    if (req.body.entryId !== current.id) throw fail(409, '当前歌曲已改变，请重试');
    if (action === 'next') { db.prepare('DELETE FROM queue WHERE id=?').run(current.id); revise({ paused:false, vocal:false }); }
    else if (action === 'pause') revise({ paused: !get('playback').paused });
    else if (action === 'vocal') { if(['original','instrumental'].includes(current.mode)) throw fail(409,current.mode==='instrumental'?'这首歌只有伴奏版本':'这首歌只有原始音频'); revise({ vocal:!get('playback').vocal }); }
    else throw fail(400, '未知控制');
    res.json(snapshot());
  });
  app.post('/api/player/heartbeat', member, (req,res) => {
    const id = clean(req.body.id,80);
    if(!id) throw fail(400,'缺少播放器标识');
    if(player && player.id !== id && Date.now()-player.seen<15000) throw fail(409,'另一台电视正在播放，请关闭另一台的播放页面后等待 15 秒');
    player = { id, seen:Date.now() }; res.json({ok:true});
  });
  app.post('/api/player/ended', member, (req,res) => {
    if (!player || player.id !== req.body.playerId || Date.now()-player.seen>15000) throw fail(409,'播放器连接已失效');
    const current = snapshot().queue[0];
    if(current?.id === req.body.entryId) { db.prepare('DELETE FROM queue WHERE id=?').run(current.id); revise({paused:false,vocal:false}); }
    res.json(snapshot());
  });
  app.post('/api/reactions', member, (req,res) => {
    if(!['👏','🎉','❤️','🌟'].includes(req.body.emoji)) throw fail(400,'不支持的互动');
    emit('reaction', {emoji:req.body.emoji, id:randomUUID()}); res.json({ok:true});
  });
  app.get('/api/media/:id/:variant', member, (req,res) => {
    if(!/^[a-f0-9]{24}$/.test(req.params.id) || !['backing','vocal'].includes(req.params.variant)) throw fail(404,'资源不存在');
    const song = db.prepare('SELECT * FROM songs WHERE id=?').get(req.params.id);
    if(!song || song.status !== 'ready') throw fail(404,'歌曲未就绪');
    res.sendFile(path.join(cache, `${song.id}-${song.mode === 'original' ? 'vocal' : song.mode==='instrumental'?'backing':req.params.variant}.mp4`));
  });
  app.get('/api/join', member, async (req,res) => {
    const lan = Object.values(os.networkInterfaces()).flat().find(n=>n?.family==='IPv4' && !n.internal)?.address;
    const configured = get('publicUrl','');
    const base = configured || (req.hostname==='localhost' || req.hostname==='127.0.0.1' ? `http://${lan || req.hostname}:${process.env.PORT || 3210}` : `${req.protocol}://${req.get('host')}`);
    const url = `${base.replace(/\/$/,'')}/mobile#${get('roomToken')}`;
    res.json({url, qr:await QRCode.toDataURL(url,{width:220,margin:2}), configured:!!configured});
  });
  app.get('/api/online', member, async (req,res) => {
    if(!get('onlineEnabled',false)) throw fail(403,'请先在后台启用在线资源');
    const query=clean(req.query.q); if(query.length<2) throw fail(400,'至少输入两个字');
    res.json(await onlineSearch(/伴奏|karaoke|instrumental/i.test(query)?query:`${query} 伴奏 KTV`, req.query.provider==='bilibili'?'bilibili':'youtube'));
  });
  app.post('/api/online', member, (req,res) => {
    if(!get('onlineEnabled',false)) throw fail(403,'请先在后台启用在线资源');
    if(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')").get().n>=20) throw fail(429,'后台任务已满');
    const payload = {url:canonicalVideo(req.body.url),title:clean(req.body.title)||'在线歌曲',artist:clean(req.body.artist)||'未知歌手',enqueue:!!req.body.enqueue,name:clean(req.body.name,24)||'家人',isBacking:req.body.isBacking===true};
    res.json({id:addJob('download',payload)});
  });
  app.get('/api/admin', admin, (req,res) => res.json({roots, downloads, cache, configPath:store.configPath, publicUrl:get('publicUrl',''), onlineEnabled:get('onlineEnabled',false), songs:db.prepare('SELECT COUNT(*) AS n FROM songs').get().n, ready:db.prepare("SELECT COUNT(*) AS n FROM songs WHERE status='ready'").get().n,jobs:db.prepare('SELECT * FROM jobs ORDER BY created DESC LIMIT 50').all()}));
  app.post('/api/admin/settings', admin, (req,res) => {
    const value=clean(req.body.publicUrl,200);
    if(value) { const url=new URL(value); if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw fail(400,'请输入 NAS 的完整访问地址，不要包含路径'); }
    set('publicUrl',value); set('onlineEnabled',req.body.onlineEnabled===true); res.json({ok:true});
  });
  app.get('/api/admin/ai',admin,(req,res)=>{const config=get('ai',{});res.json({enabled:!!config.enabled,endpoint:config.endpoint||'',model:config.model||'',hasKey:!!config.apiKey});});
  app.post('/api/admin/ai',admin,(req,res)=>{set('ai',providerConfig(req.body,get('ai',{})));res.json({ok:true});});
  app.post('/api/admin/ai/test',admin,async(req,res)=>res.json(await testProvider(providerConfig(req.body,get('ai',{})))));
  app.post('/api/admin/scan', admin, (req,res) => res.json({id:addJob('scan',{})}));
  app.post('/api/admin/jobs/:id/retry', admin, (req,res) => { const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id); if(!job || job.status!=='failed') throw fail(409,'仅失败任务可重试'); db.prepare("UPDATE jobs SET status='queued',error='' WHERE id=?").run(job.id);setImmediate(work);res.json({ok:true}); });
  app.post('/api/admin/songs/:id/probe', admin, async (req,res) => {
    const song=db.prepare('SELECT * FROM songs WHERE id=?').get(req.params.id); if(!song) throw fail(404,'歌曲不存在');
    const info=await probe(await safeMedia(song.path,[...roots,downloads])); db.prepare('UPDATE songs SET audio=?,duration=? WHERE id=?').run(JSON.stringify(info.audio),info.duration,song.id);res.json(info);
  });
  app.put('/api/admin/songs/:id/lyrics',admin,(req,res)=>{if(!db.prepare('SELECT id FROM songs WHERE id=?').get(req.params.id))throw fail(404,'歌曲不存在');const lyrics=clean(req.body.lyrics,25000);db.prepare('UPDATE songs SET lyrics=? WHERE id=?').run(lyrics,req.params.id);emit();res.json({ok:true});});
  app.post('/api/admin/songs/:id/replace',admin,async(req,res)=>{
    const song=db.prepare('SELECT * FROM songs WHERE id=?').get(req.params.id);if(!song)throw fail(404,'歌曲不存在');
    if(db.prepare('SELECT id FROM queue WHERE song_id=?').get(song.id)||db.prepare("SELECT payload FROM jobs WHERE kind='prepare' AND status IN ('queued','running')").all().some(j=>JSON.parse(j.payload).id===song.id))throw fail(409,'请先结束歌曲排队或后台处理');
    const file=await safeMedia(clean(req.body.path,1000),roots);const info=await probe(file);if(!info.hasVideo)throw fail(400,'补充的文件必须包含视频轨道');
    db.prepare("UPDATE songs SET path=?,needs_video=0,mode='original',status='new',error='' WHERE id=?").run(file,song.id);res.json({ok:true});
  });
  app.patch('/api/admin/songs/:id', admin, (req,res) => {
    const song=db.prepare('SELECT * FROM songs WHERE id=?').get(req.params.id); if(!song) throw fail(404,'歌曲不存在');
    if(db.prepare('SELECT id FROM queue WHERE song_id=?').get(song.id) || db.prepare("SELECT payload FROM jobs WHERE kind='prepare' AND status IN ('queued','running')").all().some(j=>JSON.parse(j.payload).id===song.id)) throw fail(409,'歌曲正在排队或处理中，请结束后再编辑');
    const title=clean(req.body.title), artist=clean(req.body.artist), mode=req.body.mode;
    const backing=Number(req.body.backing),vocal=Number(req.body.vocal);
    if(!title||!artist||!['original','instrumental','tracks','channels','separated'].includes(mode)||(mode==='separated'&&song.mode!=='separated')||![backing,vocal].every(n=>Number.isInteger(n)&&n>=0&&n<32)||(mode==='channels' && (backing>1||vocal>1||backing===vocal))) throw fail(400,'请检查歌曲名称和音轨配置');
    const changed=song.mode!==mode || song.backing!==backing || song.vocal!==vocal;
    db.prepare('UPDATE songs SET title=?,artist=?,search=?,mode=?,backing=?,vocal=?,status=? WHERE id=?').run(title,artist,searchText(title,artist),mode,backing,vocal,changed?'new':song.status,song.id);res.json({ok:true});
  });
  app.post('/api/admin/songs/:id/prepare', admin, (req,res) => {
    if(!db.prepare('SELECT id FROM songs WHERE id=?').get(req.params.id)) throw fail(404,'歌曲不存在');
    if(db.prepare('SELECT id FROM queue WHERE song_id=?').get(req.params.id)) throw fail(409,'请先从队列移除歌曲');
    res.json({id:addJob('prepare',{id:req.params.id})});
  });
  app.use(express.static(path.resolve('dist')));
  app.get(['/', '/tv', '/mobile', '/admin'], (req,res) => existsSync(path.resolve('dist/index.html')) ? res.sendFile(path.resolve('dist/index.html')) : res.status(503).send('请先运行 npm run build，或访问 Vite 开发服务'));
  app.use((err,req,res,next) => { if(res.headersSent) return next(err); res.status(err.status || 400).json({error:err.message || '请求失败'}); });
  const heartbeat = setInterval(()=> { for(const client of clients) client.write(': heartbeat\n\n'); },20000); heartbeat.unref();
  setImmediate(work);
  return {app,store,addJob,close:()=>{stopped=true;clearInterval(heartbeat);clients.forEach(c=>c.end());if(!running) db.close();}};
}
