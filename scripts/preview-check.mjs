import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
await mkdir('test-results/preview',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto('http://127.0.0.1:3210/simulator');const app=page.frameLocator('#screen');await app.getByRole('button',{name:'点歌 客厅试音 · 双版本',exact:true}).waitFor();
  await page.screenshot({path:'test-results/preview/simulator.png',fullPage:true});
  await page.getByRole('button',{name:'遥控器向下'}).click();assert.ok(await app.locator(':focus').count());
  await app.getByRole('button',{name:'点歌 客厅试音 · 双版本',exact:true}).click();
  await app.locator('.now-playing strong').filter({hasText:'客厅试音'}).waitFor();
  const video=app.locator('video');await video.evaluate(v=>{v.muted=true;return v.play();});
  await page.waitForFunction(()=>document.querySelector('#screen').contentDocument.querySelector('video').currentTime>.2);
  await video.evaluate(v=>v.currentTime=10);
  await page.getByRole('button',{name:'原唱 / 伴奏',exact:true}).click();
  await page.waitForFunction(()=>{const v=document.querySelector('#screen').contentDocument.querySelector('video');return v.src.includes('/vocal?')&&v.currentTime>=9;});
  await app.getByRole('button',{name:'点歌 只有音频，也能唱',exact:true}).click();await page.getByRole('button',{name:'下一首',exact:true}).click();
  await app.locator('.lyrics-scene').waitFor();await video.evaluate(v=>v.currentTime=16);
  await app.locator('.lyric-lines strong').filter({hasText:'手机也能为你送上掌声'}).waitFor();await page.screenshot({path:'test-results/preview/audio-lyrics.png',fullPage:true});
  await page.getByRole('button',{name:'后台管理',exact:true}).click();await app.getByRole('button',{name:'曲库管理',exact:true}).waitFor();await page.screenshot({path:'test-results/preview/admin.png',fullPage:true});
  await page.getByRole('button',{name:'手机点歌',exact:true}).click();await app.getByRole('button',{name:'发送 👏',exact:true}).waitFor();await page.screenshot({path:'test-results/preview/mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('Preview passed: virtual remote, actual video playback, track switch preserves time, synced lyrics, admin/mobile switching.');
  // Finish with an idle queue for the user's first visit.
  await page.getByRole('button',{name:'下一首',exact:true}).click();
}finally{await browser.close();}
