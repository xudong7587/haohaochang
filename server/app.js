import {enrichmentConfig,enrichSong} from './enrichment.js';
import {favoriteConfig,favoritePage} from './favorites.js';
import {normalizeTags} from '../shared/tags.js';
import { metadata, filesUnder, importMedia } from './library.js';
import { stat, writeFile } from 'node:fs/promises';
import express from 'express';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { openStore } from './db.js';
import { scanLibrary, prepareSong, canonicalVideo, onlineSearch, downloadVideo, searchText, probe, safeMedia, inside } from './media.js';
import { providerConfig, testProvider, separateSong } from './separation.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const clean = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function createApp(options = {}) {
  const dir = path.resolve(options.dataDir || process.env.DATA_DIR || './data');
  const roots = (options.roots || (process.env.MEDIA_ROOTS || './media').split('|')).map(p => path.resolve(p));
  const downloads = path.resolve(options.downloads || process.env.DOWNLOAD_DIR || path.join(dir, 'downloads')), cache = path.join(dir, 'cache');
  [downloads, cache].forEach(p => mkdirSync(p, { recursive: true }));
  const store = openStore(dir), { db, get, set } = store;
  const adminToken = options.adminToken || process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN;
  if (!adminToken || adminToken.length < 12) throw new Error('请设置至少 12 位的 ADMIN_PASSWORD（管理密码）');
  const app = express();
  const clients = new Set(), limits = new Map();
  let running = 0, stopped = false, player = null, ambient = null;
  app.disable('x-powered-by');
  // Validate only the optional QR origin hint; API access uses explicit credentials.
  function allowedOrigin(req, origin) {
    return typeof origin === 'string' && [
      `${req.protocol}://${req.get('host')}`, `https://${req.get('host')}`,
      get('publicUrl','').replace(/\/$/,'')
    ].filter(Boolean).includes(origin);
  }
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
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
    const pending=db.prepare("SELECT id,kind,payload,status FROM jobs WHERE status IN ('queued','running') AND kind!='scan' ORDER BY created").all().map(j=>{const p=JSON.parse(j.payload);return {id:j.id,title:p.title||(p.id?db.prepare('SELECT title FROM songs WHERE id=?').get(p.id)?.title:path.basename(p.file||''))||'准备歌曲',status:j.status};});
    return { queue, pending, ambient:queue.length?null:ambient, playback: get('playback'), playerOnline: !!player && Date.now() - player.seen < 15000 };
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
    if(['download','favorite-download'].includes(kind)) {
      const duplicate=db.prepare("SELECT id,payload FROM jobs WHERE kind IN ('download','favorite-download') AND status IN ('queued','running')").all().find(j=>JSON.parse(j.payload).url===payload.url);
      if(duplicate){if(payload.enqueue)db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify({...JSON.parse(duplicate.payload),enqueue:true,name:payload.name}),duplicate.id);return duplicate.id;}
    }
    if(kind==='prepare') {
      const duplicate=db.prepare("SELECT id,payload FROM jobs WHERE kind='prepare' AND status IN ('queued','running')").all().find(j=>JSON.parse(j.payload).id===payload.id);
      if(duplicate){if(!payload.ambientOnly)db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify({...JSON.parse(duplicate.payload),ambientOnly:false}),duplicate.id);if(payload.enqueue){const merged={...JSON.parse(duplicate.payload),enqueue:true,name:payload.name,ambientOnly:false};db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(merged),duplicate.id);}return duplicate.id;}
    }
    const existing = db.prepare("SELECT id FROM jobs WHERE kind=? AND payload=? AND status IN ('queued','running')").get(kind, JSON.stringify(payload));
    if (existing) return existing.id;
    const id = randomUUID();
    db.prepare('INSERT INTO jobs (id,kind,payload,status,created) VALUES (?,?,?,?,?)').run(id, kind, JSON.stringify(payload), 'queued', Date.now());
    emit();setImmediate(work);
    return id;
  }
  async function work() {
    if (running >= 2 || stopped || options.worker === false) return;
    const job = db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").get();
    if (!job) return;
    running++;setImmediate(work);
    db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(job.id); emit('library', {});
    const payload = JSON.parse(job.payload);
    try {
      if(job.kind==='enrich'){
        const song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.existingId);if(!song)throw fail(404,'歌曲不存在');
        if(song.metadata_source!=='手动'||payload.approved){
          const meta=payload.approved?payload.metadata:await enrichSong(get('enrichment',{}),{title:song.title,artist:song.artist,tags:JSON.parse(song.tags)});
          if(meta.needs_review){db.prepare("UPDATE jobs SET status='review',payload=?,error=? WHERE id=?").run(JSON.stringify({...payload,metadata:meta}),meta.note||'AI 信息需要核对',job.id);emit('library',{});return;}
          db.prepare('UPDATE songs SET title=?,artist=?,search=?,tags=?,metadata_source=?,needs_review=0,evidence=? WHERE id=?').run(meta.title,meta.artist,searchText(meta.title,meta.artist),JSON.stringify(song.tags_manual?JSON.parse(song.tags):meta.tags),payload.approved?'手动':'AI',JSON.stringify(meta.evidence||[]),song.id);
          if(!db.prepare('SELECT id FROM queue WHERE song_id=?').get(song.id))addJob('prepare',{id:song.id});
        }
      }
      if(job.kind==='favorite-sync'){
        const config=get('favorites',{});if(!config.favoriteId)throw fail(400,'请先配置收藏夹');
        let page=get('favorite-page:'+config.favoriteId,1);
        for(let n=0;n<5;n++){
          const result=await favoritePage(config,page);
          for(const item of result.items){const key='favorite-seen:'+config.favoriteId+':'+item.bvid;if(!get(key)){const id=addJob('favorite-download',item);set(key,id);}}
          page++;if(!result.hasMore){page=1;break;}
        }
        set('favorite-page:'+config.favoriteId,page);set('favorite-last',Date.now());
      }
      if(job.kind==='favorite-download'){
        let cookieFile;const cookie=get('favorites',{}).cookie;
        if(cookie){cookieFile=path.join(dir,'bilibili.cookies.txt');const lines=cookie.split(';').map(v=>v.trim()).filter(v=>v.includes('=')).map(v=>{const n=v.indexOf('=');return '.bilibili.com\tTRUE\t/\tTRUE\t0\t'+v.slice(0,n)+'\t'+v.slice(n+1);});await writeFile(cookieFile,'# Netscape HTTP Cookie File\n'+lines.join('\n'),{mode:0o600});}
        const {file}=await downloadVideo(payload.url,downloads,cookieFile);const info=await stat(file);
        addJob('import',{file,signature:info.size+':'+info.mtimeMs,title:payload.title,sourceUrl:payload.url,enqueue:payload.enqueue,name:payload.name});
      }
      if (job.kind === 'import') {
        const sourceInfo=await stat(payload.file);if(payload.signature!==sourceInfo.size+':'+sourceInfo.mtimeMs)throw fail(409,'下载文件仍在变化，等待下次检查');
        let meta=payload.approved?payload.metadata:await metadata(payload.file,[downloads]);
        if(!payload.approved&&payload.title){const match=payload.title.match(/^(.{1,50}?)\s+[-–—]\s+(.+)$/);meta={...meta,title:match?match[2]:payload.title,artist:match?match[1]:'未知歌手',needs_review:match?0:1};}
        if(!payload.approved&&get('enrichment',{}).enabled)meta={...meta,...await enrichSong(get('enrichment'),{title:payload.title||meta.title,artist:meta.artist,tags:meta.tags,sourceUrl:payload.sourceUrl||''})};
        if(meta.needs_review){db.prepare("UPDATE jobs SET status='review',payload=?,error=? WHERE id=?").run(JSON.stringify({...payload,metadata:meta}),meta.note||'请补充歌手、歌名后继续',job.id);emit('library',{});return;}
        if(payload.isBacking)meta.mode='instrumental';
        const id=await importMedia(store,payload.file,downloads,roots[0],meta);
        db.prepare('UPDATE songs SET evidence=? WHERE id=?').run(JSON.stringify(meta.evidence||[]),id);
        await prepareSong(store,id,[...roots,downloads,path.join(dir,'downloads')],cache);
        const song=db.prepare('SELECT * FROM songs WHERE id=?').get(id);
        if(song.mode==='original'&&get('ai',{}).enabled)await separateSong(store,song,cache);
        if(payload.enqueue)enqueue(id,payload.name||'在线点歌');
      }
      if (job.kind === 'scan') await scanLibrary(store, roots);
      if (job.kind === 'prepare') {
        db.prepare("UPDATE songs SET status='preparing',error='' WHERE id=?").run(payload.id);
        let song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.id);
        await prepareSong(store, payload.id, [...roots, downloads,path.join(dir,'downloads')], cache);
        song=db.prepare('SELECT * FROM songs WHERE id=?').get(payload.id);
        if(song.mode==='original'&&get('ai',{}).enabled&&!JSON.parse(db.prepare('SELECT payload FROM jobs WHERE id=?').get(job.id).payload).ambientOnly) await separateSong(store,song,cache);
        const latest=JSON.parse(db.prepare('SELECT payload FROM jobs WHERE id=?').get(job.id).payload);
        if(latest.enqueue)enqueue(payload.id,latest.name||'家人');
      }
      if (job.kind === 'download') {
        const {file}=await downloadVideo(payload.url,downloads);const info=await stat(file);
        addJob('import',{file,signature:info.size+':'+info.mtimeMs,title:payload.title,sourceUrl:payload.url,enqueue:payload.enqueue,name:payload.name,isBacking:payload.isBacking});
      }
      db.prepare("UPDATE jobs SET status='done',error='' WHERE id=?").run(job.id);
    } catch (e) {
      db.prepare("UPDATE jobs SET status='failed',error=? WHERE id=?").run(e.message.slice(-1800), job.id);
      if (job.kind === 'prepare') db.prepare("UPDATE songs SET status='error',error=? WHERE id=?").run(e.message.slice(-1800), payload.id);
    } finally { running--; emit('library', {});emit(); if(stopped&&!running)db.close();else setImmediate(work); }
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
    res.json(db.prepare("SELECT id,title,artist,duration,mode,status,error,source,backing,vocal,audio,needs_video,lyrics,metadata_source,needs_review,tags,CASE WHEN poster!='' THEN 1 ELSE 0 END AS hasPoster FROM songs WHERE search LIKE ? ESCAPE '!' AND (?='' OR artist=?) AND (?='' OR EXISTS (SELECT 1 FROM json_each(songs.tags) WHERE value=?)) ORDER BY created DESC LIMIT 300").all(`%${q}%`, artist, artist,clean(req.query.tag),clean(req.query.tag)));
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
    if (!current&&ambient&&req.body.entryId===ambient.id) {
      if(action==='next')pickAmbient();else if(action==='pause'){ambient={...ambient,paused:!ambient.paused};emit();}else throw fail(409,'开场音乐固定播放原唱');
      return res.json(snapshot());
    }
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
    player = { id, seen:Date.now() }; if(!snapshot().queue.length&&!ambient)pickAmbient(); res.json({ok:true});
  });
  app.post('/api/player/ended', member, (req,res) => {
    if (!player || player.id !== req.body.playerId || Date.now()-player.seen>15000) throw fail(409,'播放器连接已失效');
    if(ambient?.id===req.body.entryId&&!snapshot().queue.length){pickAmbient();return res.json(snapshot());}
    const current = snapshot().queue[0];
    if(current?.id === req.body.entryId) { db.prepare('DELETE FROM queue WHERE id=?').run(current.id); revise({paused:false,vocal:false}); }
    res.json(snapshot());
  });
  function pickAmbient() {
    const song=db.prepare("SELECT id,title,artist,mode,duration,needs_video,lyrics FROM songs WHERE status='ready' AND mode!='instrumental' ORDER BY (id=?) ASC,RANDOM() LIMIT 1").get(ambient?.song_id||'');
    ambient=song?{...song,song_id:song.id,id:'ambient-'+randomUUID(),ambient:true}:null;emit();
    if(!song&&!db.prepare("SELECT id FROM jobs WHERE kind='prepare' AND status IN ('queued','running') LIMIT 1").get()){const candidate=db.prepare("SELECT id FROM songs WHERE status='new' AND mode!='instrumental' ORDER BY RANDOM() LIMIT 1").get();if(candidate)addJob('prepare',{id:candidate.id,ambientOnly:true});}
  }
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
  app.get('/api/poster/:id',member,async(req,res)=>{const song=db.prepare('SELECT poster FROM songs WHERE id=?').get(req.params.id);if(!song?.poster)throw fail(404,'没有海报');res.sendFile(await safeMedia(song.poster,[...roots,downloads,path.join(dir,'downloads')]));});
  app.get('/api/join', member, async (req,res) => {
    const lan = Object.values(os.networkInterfaces()).flat().find(n=>n?.family==='IPv4' && !n.internal)?.address;
    const configured = get('publicUrl','');
    const browserOrigin = allowedOrigin(req,req.query.origin) ? req.query.origin : '';
    const base = configured || browserOrigin || (req.hostname==='localhost' || req.hostname==='127.0.0.1' ? `http://${lan || req.hostname}:${process.env.PORT || 3210}` : `${req.protocol}://${req.get('host')}`);
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
  app.get('/api/admin', admin, (req,res) => res.json({roots, downloads, cache, autoImport:get('autoImport',true), configPath:store.configPath, publicUrl:get('publicUrl',''), onlineEnabled:get('onlineEnabled',false), songs:db.prepare('SELECT COUNT(*) AS n FROM songs').get().n, ready:db.prepare("SELECT COUNT(*) AS n FROM songs WHERE status='ready'").get().n,jobs:db.prepare('SELECT * FROM jobs ORDER BY created DESC LIMIT 50').all()}));
  app.post('/api/admin/settings', admin, (req,res) => {
    const value=clean(req.body.publicUrl,200);
    if(value) { const url=new URL(value); if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw fail(400,'请输入 NAS 的完整访问地址，不要包含路径'); }
    set('publicUrl',value); set('onlineEnabled',req.body.onlineEnabled===true); res.json({ok:true});
  });
  app.get('/api/admin/ai',admin,(req,res)=>{const config=get('ai',{});res.json({enabled:!!config.enabled,endpoint:config.endpoint||'',model:config.model||'',hasKey:!!config.apiKey,pcEndpoint:config.pcEndpoint||'',pcModel:config.pcModel||'htdemucs',hasPcKey:!!config.pcApiKey});});
  app.post('/api/admin/ai',admin,(req,res)=>{set('ai',providerConfig(req.body,get('ai',{})));res.json({ok:true});});
  app.post('/api/admin/ai/test',admin,async(req,res)=>res.json(await testProvider((()=>{const c=providerConfig(req.body,get('ai',{}));return c.pcEndpoint?{endpoint:c.pcEndpoint,model:c.pcModel,apiKey:c.pcApiKey}:c;})())));
  app.post('/api/admin/enrich',admin,(req,res)=>{if(!get('enrichment',{}).enabled)throw fail(400,'请先配置并启用信息 AI');if(!Array.isArray(req.body.ids)||req.body.ids.length>500)throw fail(400,'每次最多 500 首');res.json({jobs:req.body.ids.map(existingId=>addJob('enrich',{existingId}))});});
  app.get('/api/admin/enrichment',admin,(req,res)=>{const c=get('enrichment',{});res.json({enabled:!!c.enabled,endpoint:c.endpoint||'https://api.openai.com/v1',model:c.model||'',webSearch:!!c.webSearch,hasKey:!!c.apiKey});});
  app.post('/api/admin/enrichment',admin,(req,res)=>{set('enrichment',enrichmentConfig(req.body,get('enrichment',{})));res.json({ok:true});});
  app.post('/api/admin/enrichment/test',admin,async(req,res)=>res.json(await enrichSong(enrichmentConfig(req.body,get('enrichment',{})),{title:'测试标题，请返回低置信度并说明无法确认，不要编造'})));
  app.get('/api/admin/favorites',admin,(req,res)=>{const c=get('favorites',{});res.json({enabled:!!c.enabled,favoriteId:c.favoriteId||'',intervalMinutes:c.intervalMinutes||10,hasCookie:!!c.cookie,lastSync:get('favorite-last',null)});});
  app.post('/api/admin/favorites',admin,(req,res)=>{set('favorites',favoriteConfig(req.body,get('favorites',{})));res.json({ok:true});});
  app.post('/api/admin/favorites/sync',admin,(req,res)=>res.json({id:addJob('favorite-sync',{})}));
  const reviewList=()=>db.prepare("SELECT id,payload,error,created FROM jobs WHERE status='review' ORDER BY created").all().map(j=>{const p=JSON.parse(j.payload);return {id:j.id,title:p.metadata?.title||p.title||'',artist:p.metadata?.artist||'',tags:p.metadata?.tags||[],note:j.error,sourceUrl:p.sourceUrl||'',created:j.created};});
  function resolveReview(req,res){const job=db.prepare("SELECT * FROM jobs WHERE id=? AND status='review'").get(req.params.id);if(!job)throw fail(409,'该任务已处理或不存在');const title=clean(req.body.title),artist=clean(req.body.artist);if(!title||!artist||artist==='未知歌手')throw fail(400,'请填写歌手和歌名');const payload=JSON.parse(job.payload);db.prepare("UPDATE jobs SET status='queued',payload=?,error='' WHERE id=?").run(JSON.stringify({...payload,approved:true,metadata:{...payload.metadata,title,artist,tags:normalizeTags(req.body.tags),needs_review:0,metadata_source:'手动'}}),job.id);setImmediate(work);emit('library',{});res.json({ok:true});}
  app.get('/api/admin/reviews',admin,(req,res)=>res.json(reviewList()));
  app.post('/api/admin/reviews/:id',admin,resolveReview);
  app.get('/api/admin/integration',admin,(req,res)=>{if(!get('integrationToken'))set('integrationToken',randomUUID()+randomUUID());res.json({token:get('integrationToken')});});
  const integration=(req,res,next)=>get('integrationToken')&&equal(req.get('authorization')?.replace(/^Bearer /,''),get('integrationToken'))?next():next(fail(401,'管理集成凭证无效'));
  app.get('/api/integrations/reviews',integration,(req,res)=>res.json(reviewList()));
  app.post('/api/integrations/reviews/:id',integration,resolveReview);
  app.post('/api/admin/import-settings',admin,(req,res)=>{set('autoImport',req.body.enabled===true);res.json({ok:true});});
  app.get('/api/admin/organize',admin,async(req,res)=>{
    const rows=db.prepare('SELECT id,path,title,artist,metadata_source,tags,tags_manual FROM songs ORDER BY created DESC LIMIT 500').all();
    const results=[];for(const song of rows){try{const meta=await metadata(song.path,[...roots,downloads,path.join(dir,'downloads')]);results.push({id:song.id,oldTitle:song.title,oldArtist:song.artist,...meta,tags:song.tags_manual?JSON.parse(song.tags):meta.tags,poster:!!meta.poster});}catch(e){results.push({id:song.id,oldTitle:song.title,oldArtist:song.artist,title:song.title,artist:song.artist,error:e.message});}}
    res.json(results);
  });
  app.post('/api/admin/organize',admin,(req,res)=>{
    const rows=req.body.songs;if(!Array.isArray(rows)||rows.length>500)throw fail(400,'每次最多整理 500 首');
    for(const row of rows){if(!clean(row.title)||!clean(row.artist)||!db.prepare('SELECT id FROM songs WHERE id=?').get(row.id))throw fail(400,'请检查歌手和歌名');}
    db.exec('BEGIN');try{for(const row of rows)db.prepare("UPDATE songs SET title=?,artist=?,search=?,metadata_source='手动',needs_review=?,tags=?,tags_manual=1 WHERE id=?").run(clean(row.title),clean(row.artist),searchText(clean(row.title),clean(row.artist)),clean(row.artist)==='未知歌手'?1:0,JSON.stringify(normalizeTags(row.tags)),row.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    if(req.body.prepare)for(const row of rows)if(!db.prepare('SELECT id FROM queue WHERE song_id=?').get(row.id))addJob('prepare',{id:row.id});
    emit('library',{});res.json({ok:true,count:rows.length});
  });
  app.post('/api/admin/scan', admin, (req,res) => res.json({id:addJob('scan',{})}));
  app.post('/api/admin/jobs/:id/retry', admin, (req,res) => { const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id); if(!job || job.status!=='failed') throw fail(409,'仅失败任务可重试'); db.prepare("UPDATE jobs SET status='queued',error='' WHERE id=?").run(job.id);setImmediate(work);res.json({ok:true}); });
  app.post('/api/admin/songs/:id/probe', admin, async (req,res) => {
    const song=db.prepare('SELECT * FROM songs WHERE id=?').get(req.params.id); if(!song) throw fail(404,'歌曲不存在');
    const info=await probe(await safeMedia(song.path,[...roots,downloads,path.join(dir,'downloads')])); db.prepare('UPDATE songs SET audio=?,duration=? WHERE id=?').run(JSON.stringify(info.audio),info.duration,song.id);res.json(info);
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
    db.prepare("UPDATE songs SET metadata_source='手动',needs_review=? WHERE id=?").run(artist==='未知歌手'?1:0,song.id);
    const changed=song.mode!==mode || song.backing!==backing || song.vocal!==vocal;
    db.prepare('UPDATE songs SET title=?,artist=?,search=?,mode=?,backing=?,vocal=?,status=? WHERE id=?').run(title,artist,searchText(title,artist),mode,backing,vocal,changed?'new':song.status,song.id);res.json({ok:true});
  });
  app.post('/api/admin/songs/:id/prepare', admin, (req,res) => {
    if(!db.prepare('SELECT id FROM songs WHERE id=?').get(req.params.id)) throw fail(404,'歌曲不存在');
    if(db.prepare('SELECT id FROM queue WHERE song_id=?').get(req.params.id)) throw fail(409,'请先从队列移除歌曲');
    res.json({id:addJob('prepare',{id:req.params.id})});
  });
  app.get('/', (req,res) => res.redirect(302,'/admin'));
  app.use(express.static(path.resolve('dist')));
  app.get(['/', '/tv', '/play', '/mobile', '/admin'], (req,res) => existsSync(path.resolve('dist/index.html')) ? res.sendFile(path.resolve('dist/index.html')) : res.status(503).send('请先运行 npm run build，或访问 Vite 开发服务'));
  app.use((err,req,res,next) => { if(res.headersSent) return next(err); res.status(err.status || 400).json({error:err.message || '请求失败'}); });
  const favoritesTimer=setInterval(()=>{const c=get('favorites',{});if(stopped||options.worker===false||!c.enabled)return;const recent=db.prepare("SELECT created FROM jobs WHERE kind='favorite-sync' ORDER BY created DESC LIMIT 1").get();if(!recent||Date.now()-recent.created>c.intervalMinutes*60000)addJob('favorite-sync',{});},30000);favoritesTimer.unref();
  let checking=false;const observed=new Map();
  const importer=setInterval(async()=>{
    if(checking||stopped||options.worker===false||!get('autoImport',true))return;checking=true;
    try{for(const file of await filesUnder(downloads)){
      if(roots.some(root=>inside(root,file))||inside(cache,file))continue;
      const info=await stat(file),signature=info.size+':'+info.mtimeMs,previous=observed.get(file);observed.set(file,signature);
      if(previous!==signature||Date.now()-info.mtimeMs<60000)continue;
      const handled=db.prepare("SELECT payload FROM jobs WHERE kind='import'").all().some(j=>{const p=JSON.parse(j.payload);return p.file===file&&p.signature===signature;});
      if(!handled)addJob('import',{file,signature});
    }}catch(e){console.error('下载目录检查失败:',e.message);}finally{checking=false;}
  },30000);importer.unref();
  const heartbeat = setInterval(()=> { for(const client of clients) client.write(': heartbeat\n\n'); },20000); heartbeat.unref();
  setImmediate(work);
  return {app,store,addJob,close:()=>{stopped=true;clearInterval(heartbeat);clearInterval(importer);clearInterval(favoritesTimer);clients.forEach(c=>c.end());if(!running) db.close();}};
}
