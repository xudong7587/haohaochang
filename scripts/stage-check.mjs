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
 const context=await browser.newContext({viewport:{width:1280,height:720}});const admin=await context.newPage();await admin.goto(base+'/admin');await admin.getByLabel('管理密码').fill('stage-test-password');await admin.getByRole('button',{name:'进入好好唱'}).click();
 const opened=context.waitForEvent('page');await admin.getByRole('link',{name:'打开网页歌房'}).click();const page=await opened;await page.waitForURL(base+'/play');await page.locator('.stage-card').first().waitFor();assert.equal(await page.getByLabel('管理密码').count(),0);
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.currentTime>.1&&!v.paused;});
 assert.match(await page.locator('video').getAttribute('src'),/\/vocal\?/);await page.screenshot({path:path.join(dir,'tv-720.png')});
 await page.getByRole('button',{name:'全屏播放'}).click();await page.getByRole('button',{name:'手机扫码',exact:true}).click();await page.locator('.fullscreen-join img').waitFor();assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true);await page.screenshot({path:path.join(dir,'web-room-fullscreen.png')});await page.getByRole('button',{name:'收起二维码'}).click();await page.getByRole('button',{name:'全屏播放'}).click();
 const second=await context.newPage();await second.goto(base+'/play');await second.getByText('请检查 NAS 连接；如果另一台设备正在播放，关闭那里的歌房后会自动连接。').waitFor();assert.equal(await second.locator('video').evaluate(v=>v.paused),true);await second.close();
 const token=service.store.get('roomToken');service.store.set('publicUrl','https://ktv.example.test:666');const join=await (await fetch(base+'/api/join',{headers:{Authorization:'Bearer '+token}})).json();assert.equal(join.url,'https://ktv.example.test:666/mobile#'+token);
 const phoneContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true});const phone=await phoneContext.newPage();await phone.route('https://ktv.example.test:666/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/api/events')return route.abort();await route.fulfill({response:await route.fetch({url:base+url.pathname+url.search})});});
 await phone.goto(join.url);await phone.getByRole('button',{name:'发送 👏'}).click();await page.locator('.reaction-layer').getByText('👏').waitFor();assert.equal(await phone.getByLabel('管理密码').count(),0);await phoneContext.close();
 await page.locator('.stage-card').first().click();await page.waitForFunction(()=>document.querySelector('video').src.includes('/backing?'));assert.match(await page.locator('.now-playing').innerText(),/伴奏/);
 await admin.getByRole('button',{name:'设置与任务',exact:true}).click();await admin.getByRole('button',{name:'预览整理已有曲库'}).click();await admin.locator('.organize-row').first().waitFor();await admin.screenshot({path:path.join(dir,'organize.png'),fullPage:true});
 console.log('Stage verified: admin opens independent web room without another password; proxy QR mobile joins without password and sends reaction; original playback, backing takeover, organizer and 720p layout.');
}finally{await browser.close();service.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
