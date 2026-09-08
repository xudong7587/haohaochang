// Isolated component contract test: no real database, downloader, or media requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=`<!doctype html><html><body><div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {LibraryManager} from '/src/library-manager.jsx';
window.songs=[{id:'song-a',title:'初始歌名',artist:'测试歌手',lyrics:'[00:01]测试歌词',metadataRevision:1,tier:'standard',status:'ready',sourceUrl:'',manifest:{vocal:true,backing:true}}];
window.hiddenSongs=[];window.calls=[];window.failSave=false;
window.videoReview={id:'video-review',kind:'find-video',title:'视频候选',artist:'测试歌手',candidatePath:'isolated/candidate.mp4',expectedRevision:7,candidate:{canonicalUrl:'https://www.bilibili.com/video/BV1gF4m1K7Aa?p=14',provider:'bilibili',externalTitle:'第14P',duration:240}};
window.request=async(url,body,method)=>{
 window.calls.push({url,body,method});
 if(url==='/admin/library')return structuredClone(window.songs);
 if(url==='/admin/library?hidden=true')return structuredClone(window.hiddenSongs);
 if(url==='/admin/reviews')return [structuredClone(window.videoReview)];
 if(url==='/admin/inbox')return [];
 if(url==='/admin/source-info')return {title:'可爱女人',artist:'周杰伦',duration:240,candidateId:'retained-preview-id',candidate:{canonicalUrl:body.url,externalTitle:'第14P',page:14}};
 if(url==='/admin/find-lyrics')return {lyrics:'[00:01]本地候选歌词',source:'本地 LRC',provider:'local-lrc',sourceId:'local-1'};
 if(url==='/admin/refresh-metadata')return {title:'识别歌名',artist:'测试歌手',needs_review:body.id==='review'};
 if(url.endsWith('/save')){
  const song=window.songs.find(row=>row.id===url.split('/')[3]);
  if(window.failSave||song.id==='conflict'||body.expectedRevision!==song.metadataRevision){window.failSave=false;throw Object.assign(new Error('资料已更新'),{status:409,code:'REVISION_CONFLICT',currentRevision:song.metadataRevision});}
  if(song.id==='failed')throw new Error('保存失败');
  Object.assign(song,{title:body.title,artist:body.artist,lyrics:body.lyrics,lyricsSource:body.lyricsSource,metadataRevision:song.metadataRevision+1});return {ok:true,metadataRevision:song.metadataRevision};
 }
 if(method==='DELETE'){const id=url.split('/').pop();window.hiddenSongs.push(...window.songs.filter(row=>row.id===id));window.songs=window.songs.filter(row=>row.id!==id);}
 if(url.endsWith('/restore')){const id=url.split('/')[3];window.songs.push(...window.hiddenSongs.filter(row=>row.id===id));window.hiddenSongs=window.hiddenSongs.filter(row=>row.id!==id);}
 return {ok:true};
};
createRoot(document.getElementById('root')).render(React.createElement(LibraryManager,{request:window.request,notify:message=>window.lastNotice=message}));
</script></body></html>`;
const server=await createServer({configFile:false,plugins:[react(),{name:'isolated-library-fixture',configureServer(vite){vite.middlewares.use('/library-fixture',async(_req,res,next)=>{try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/library-fixture',fixture));}catch(error){next(error);}});}}],server:{host:'127.0.0.1',port:0}});
await server.listen();
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/library-fixture');
 await page.getByRole('button',{name:/标准曲库 ·/}).filter({hasText:/^标准/}).click();
 let row=page.locator('[data-song-id="song-a"]');await row.getByRole('button',{name:'编辑歌曲',exact:true}).click();
 const title=row.getByLabel('歌名',{exact:true});
 await page.evaluate(()=>Object.assign(window.songs[0],{title:'后台更新',metadataRevision:2}));await page.getByRole('button',{name:'刷新列表',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-song-id="song-a"] input')?.value==='测试歌手');assert.equal(await title.inputValue(),'后台更新');
 await title.fill('保留我的草稿');await page.evaluate(()=>Object.assign(window.songs[0],{title:'另一窗口更新',metadataRevision:3}));await page.getByRole('button',{name:'刷新列表',exact:true}).click();await row.getByRole('alert').waitFor();assert.equal(await title.inputValue(),'保留我的草稿');assert.equal(await row.getByRole('button',{name:'仅保存信息',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:/^半标准曲库/}).click();await page.getByRole('button',{name:/^标准曲库/}).click();assert.equal(await title.inputValue(),'保留我的草稿');
 await row.getByLabel('我已比较最新资料，确认要保存现有草稿').check();await row.getByRole('button',{name:'保留草稿，按最新修订继续编辑',exact:true}).click();await row.getByRole('button',{name:'仅保存信息',exact:true}).click();
 await page.waitForFunction(()=>window.songs[0].metadataRevision===4);assert.equal((await page.evaluate(()=>window.calls.filter(call=>call.url.endsWith('/save')).at(-1))).body.expectedRevision,3);
 await title.fill('触发服务器冲突');await page.evaluate(()=>Object.assign(window.songs[0],{title:'未刷新后台更新',metadataRevision:5}));await row.getByRole('button',{name:'仅保存信息',exact:true}).click();await row.getByRole('alert').waitFor();assert.equal(await title.inputValue(),'触发服务器冲突');await row.getByRole('button',{name:'采用最新资料，放弃草稿',exact:true}).click();assert.equal(await title.inputValue(),'未刷新后台更新');
 await page.getByLabel('添加下载链接').fill('https://www.bilibili.com/video/BV1gF4m1K7Aa?p=14');await page.getByRole('button',{name:'解析 MV 链接',exact:true}).click();await page.getByRole('button',{name:'下载到待整理',exact:true}).click();assert.equal((await page.evaluate(()=>window.calls.find(call=>call.url==='/admin/inbox-link'))).body.candidateId,'retained-preview-id');
 await row.getByRole('button',{name:'自动找歌词',exact:true}).first().click();await row.getByText(/歌词来源：本地 LRC/).waitFor();await row.getByRole('button',{name:'仅保存信息',exact:true}).click();assert.equal((await page.evaluate(()=>window.calls.filter(call=>call.url.endsWith('/save')).at(-1))).body.lyricsSource.provider,'local-lrc');
 await row.getByLabel('视频链接（B站支持 ?p= 分集）').fill('https://www.bilibili.com/video/BV1gF4m1K7Aa?p=14');await row.getByLabel('我已试听核对，这是与当前音轨对应的录音版本').check();await row.getByLabel('视频相对音轨偏移（秒）').fill('1.2');await row.getByRole('button',{name:'下载并替换当前视频',exact:true}).click();const source=(await page.evaluate(()=>window.calls.find(call=>call.url.endsWith('/source')))).body;assert.equal(source.confirmed,true);assert.equal(source.offset,1.2);assert.equal(source.expectedRevision,6);
 await page.getByRole('button',{name:/^待整理曲库/}).click();const video=page.locator('article').filter({has:page.getByRole('heading',{name:'视频候选 — 测试歌手'})});await video.getByLabel('我已试听核对，这是与当前音轨对应的录音版本').check();await video.getByLabel('视频相对音轨偏移（秒）').fill('0');await video.getByRole('button',{name:'确认候选并关联画面',exact:true}).click();await video.getByRole('button',{name:'拒绝此候选',exact:true}).click();await video.getByRole('button',{name:'重新搜索视频',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.calls.filter(call=>call.url==='/admin/reviews/video-review').map(call=>call.body.action)),['confirm','reject','research']);
 await page.getByRole('button',{name:/^标准曲库/}).click();await row.getByRole('button',{name:'移出曲库',exact:true}).click();await page.getByRole('button',{name:/^已隐藏/}).click();await page.getByRole('button',{name:'恢复歌曲',exact:true}).click();assert.equal(await page.evaluate(()=>window.songs.length),1);
 assert.deepEqual(errors,[]);console.log('Library component browser contracts passed: clean refresh, draft conflicts, stale saves, candidate download, lyric provenance, MV confirmation, review actions, hide/restore.');
}finally{await browser.close();await server.close();}
