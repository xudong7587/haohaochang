import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../server/db.js';
test('settings.json initializes, migrates legacy values, persists changes and fails closed on corrupt files',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'ktv-config-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const old=new DatabaseSync(path.join(dir,'ktv.sqlite'));old.exec('CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL)');old.prepare('INSERT INTO settings VALUES (?,?)').run('publicUrl',JSON.stringify('http://192.168.1.10:8888'));old.close();
  let store=openStore(dir);assert.equal(store.get('publicUrl'),'http://192.168.1.10:8888');
  store.set('onlineEnabled',true);store.set('ai',{enabled:true,endpoint:'http://separator:8000',model:'htdemucs',apiKey:'test-only'});
  const file=store.configPath;const saved=JSON.parse(await readFile(file,'utf8'));assert.equal(saved.onlineEnabled,true);assert.equal(saved.ai.model,'htdemucs');assert.equal(saved.ai.apiKey,'test-only');
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key='ai'").get().n,0);
  store.db.close();store=openStore(dir);assert.equal(store.get('ai').apiKey,'test-only');store.db.close();
  await writeFile(file,'invalid-json');assert.throws(()=>openStore(dir),/原配置未被覆盖/);assert.equal(await readFile(file,'utf8'),'invalid-json');
});
