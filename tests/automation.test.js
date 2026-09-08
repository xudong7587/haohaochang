import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {enrichSong,enrichmentConfig} from '../server/enrichment.js';
import {favoritePage,favoriteConfig} from '../server/favorites.js';

test('favorite pagination, credentials and canonical video links',async()=>{
 const config=favoriteConfig({enabled:true,favoriteId:'https://space.bilibili.com/1/favlist?fid=123',cookie:'SESSDATA=test',intervalMinutes:1});assert.equal(config.favoriteId,'123');assert.equal(config.intervalMinutes,5);
 const result=await favoritePage(config,2,async(url,options)=>{assert.equal(url.searchParams.get('pn'),'2');assert.equal(options.headers.Cookie,'SESSDATA=test');return {ok:true,json:async()=>({code:0,data:{has_more:true,medias:[{bvid:'BV1234567890',title:'歌手 - 歌名'},{bvid:'invalid'}]}})};});assert.equal(result.items.length,1);assert.equal(result.hasMore,true);assert.match(result.items[0].url,/^https:\/\/www.bilibili.com\/video\//);
 await assert.rejects(()=>favoritePage(config,1,async()=>({ok:true,json:async()=>({code:-101})})),/Cookie/);
});
test('OpenAI metadata response, provenance and uncertainty review',async t=>{
 let confidence=.95;const app=express();app.use(express.json());app.post('/responses',(req,res)=>{assert.equal(req.get('authorization'),'Bearer test-only');assert.equal(req.body.store,false);assert.equal(req.body.text.format.type,'json_schema');res.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({title:'歌名',artist:'歌手',tags:['港台','女声','not-allowed'],confidence,note:'测试'}),annotations:[{type:'url_citation',url:'https://example.com/song',title:'source'}]}]}]});});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close();});
 const config=enrichmentConfig({enabled:true,endpoint:'http://127.0.0.1:'+server.address().port,model:'test',apiKey:'test-only',webSearch:true});const result=await enrichSong(config,{title:'raw input'});assert.deepEqual(result.tags,['港台','女声']);assert.equal(result.needs_review,0);assert.equal(result.evidence.length,1);
 confidence=.4;assert.equal((await enrichSong(config,{title:'unknown'})).needs_review,1);
});
