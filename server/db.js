import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'ktv.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL,
      search TEXT NOT NULL DEFAULT '', duration REAL DEFAULT 0, audio TEXT DEFAULT '[]', mode TEXT DEFAULT 'original',
      backing INTEGER DEFAULT 0, vocal INTEGER DEFAULT 0, status TEXT DEFAULT 'new', error TEXT DEFAULT '',
      source TEXT DEFAULT 'local', created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS queue (id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES songs(id), name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, error TEXT DEFAULT '', created INTEGER NOT NULL);
  `);
  const columns=db.prepare('PRAGMA table_info(songs)').all().map(c=>c.name);
  if(!columns.includes('needs_video'))db.exec("ALTER TABLE songs ADD COLUMN needs_video INTEGER DEFAULT 0");
  if(!columns.includes('lyrics'))db.exec("ALTER TABLE songs ADD COLUMN lyrics TEXT DEFAULT ''");
  for(const [name,type] of [['evidence',"TEXT DEFAULT '[]'"],['tags',"TEXT DEFAULT '[]'"],['tags_manual','INTEGER DEFAULT 0'],['poster',"TEXT DEFAULT ''"],['metadata_source',"TEXT DEFAULT '文件名'"],['needs_review','INTEGER DEFAULT 0']])if(!columns.includes(name))db.exec('ALTER TABLE songs ADD COLUMN '+name+' '+type);
  const readDb = (key, fallback) => { const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; };
  const configPath=path.join(dir,'settings.json');
  const defaults={version:1,autoImport:true,publicUrl:'',onlineEnabled:false,ai:{enabled:false,endpoint:'',model:'',apiKey:''}};
  let config;
  try {
    if(existsSync(configPath)){
      config=JSON.parse(readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));
      if(!config || typeof config!=='object' || Array.isArray(config))throw new Error('配置格式错误');
      config={...defaults,...config};
    }else config={...defaults,publicUrl:readDb('publicUrl',''),onlineEnabled:readDb('onlineEnabled',false),ai:readDb('ai',defaults.ai)};
  }catch(e){db.close();throw new Error(`无法读取 ${configPath}：${e.message}。原配置未被覆盖。`);}
  const flush = value => {writeFileSync(configPath+'.tmp',JSON.stringify(value,null,2)+'\n',{encoding:'utf8',mode:0o600});renameSync(configPath+'.tmp',configPath);};
  flush(config);
  const keys=new Set(['publicUrl','onlineEnabled','ai','autoImport','enrichment','favorites']);
  db.prepare("DELETE FROM settings WHERE key IN ('publicUrl','onlineEnabled','ai')").run();
  const get = (key, fallback) => keys.has(key) ? (config[key]??fallback) : readDb(key,fallback);
  const set = (key, value) => {if(keys.has(key)){const next={...config,[key]:value};flush(next);config=next;}else db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key,JSON.stringify(value));};
  if (!get('roomToken')) set('roomToken', randomBytes(24).toString('hex'));
  if (!get('playback')) set('playback', { paused: false, vocal: false, revision: 0 });
  db.prepare("UPDATE jobs SET status='queued',error='' WHERE status='running'").run();
  return { db, get, set, configPath };
}
