import {createRequire} from 'node:module';
import {mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=path.resolve('test-results/stage');await mkdir(path.join(dir,'cache'),{recursive:true});
const service=createApp({dataDir:dir,roots:[path.resolve('data-preview/media')],adminToken:'stage-test-password',worker:false});
service.store.db.exec('DELETE FROM queue;DELETE FROM songs;DELETE FROM jobs;');
for(let n=1;n<=3;n++){
 const id=String(n).repeat(24);for(const variant of ['vocal','backing'])await copyFile(path.resolve('data-preview/cache',id+'-'+variant+'.mp4'),path.join(dir,'cache',id+'-'+variant+'.mp4'));
 service.store.db.prepare('INSERT INTO songs (id,path,title,artist,status,mode,created) VALUES (?,?,?,?,?,?,?)').run(id,path.resolve('data-preview/media',n+'.mp4'),'开场试音 '+n,'好好唱实验室','ready','tracks',n);
}
const server=service.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});await page.goto(base+'/tv');await page.getByLabel('管理密码').fill('stage-test-password');await page.getByRole('button',{name:'进入好好唱'}).click();await page.locator('.stage-card').first().waitFor();
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.currentTime>.1&&!v.paused;});
 assert.match(await page.locator('video').getAttribute('src'),/\/vocal\?/);await page.screenshot({path:path.join(dir,'tv-720.png')});
 await page.locator('.stage-card').first().click();await page.waitForFunction(()=>document.querySelector('video').src.includes('/backing?'));assert.match(await page.locator('.now-playing').innerText(),/伴奏/);
 await page.goto(base+'/admin');await page.getByRole('button',{name:'设置与任务',exact:true}).click();await page.getByRole('button',{name:'预览整理已有曲库'}).click();await page.locator('.organize-row').first().waitFor();await page.screenshot({path:path.join(dir,'organize.png'),fullPage:true});
 console.log('Stage verified: automatic original playback, requested song takes over with backing, organizer preview, 720p layout.');
}finally{await browser.close();service.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
