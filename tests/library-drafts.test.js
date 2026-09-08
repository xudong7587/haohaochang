import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraft,draftReducer} from '../src/library/draft.js';
import {refreshMetadataBatch} from '../src/library/batch.js';

const song={id:'isolated',title:'原歌名',artist:'歌手',lyrics:'[00:01]原歌词',metadataRevision:2};
test('clean drafts follow refresh, dirty drafts preserve user edits and require explicit conflict resolution',()=>{
 let draft=createDraft(song);
 draft=draftReducer(draft,{type:'refresh',row:{...song,title:'后台标题',metadataRevision:3}});
 assert.equal(draft.values.title,'后台标题');assert.equal(draft.dirty,false);
 draft=draftReducer(draft,{type:'edit',patch:{title:'用户草稿'}});
 draft=draftReducer(draft,{type:'refresh',row:{...song,title:'另一窗口标题',metadataRevision:4}});
 assert.equal(draft.values.title,'用户草稿');assert.equal(draft.revision,3);assert.equal(draft.conflict,true);
 draft=draftReducer(draft,{type:'refresh',row:{...song,title:'第三次后台标题',metadataRevision:5}});
 assert.equal(draft.values.title,'用户草稿');assert.equal(draft.conflict,true);
 const adopted=draftReducer(draft,{type:'adopt'});assert.equal(adopted.values.title,'第三次后台标题');assert.equal(adopted.dirty,false);
 const retained=draftReducer(draft,{type:'rebase'});assert.equal(retained.values.title,'用户草稿');assert.equal(retained.revision,5);assert.equal(retained.dirty,true);assert.equal(retained.conflict,false);
 const saved=draftReducer(retained,{type:'saved',values:retained.values,revision:6});assert.equal(saved.dirty,false);assert.equal(saved.revision,6);
});
test('late refresh and saving an earlier snapshot cannot overwrite newer edits',()=>{
 let draft=draftReducer(createDraft(song),{type:'edit',patch:{title:'先前草稿'}});const submitted=draft.values;
 draft=draftReducer(draft,{type:'edit',patch:{lyrics:'[00:02]保存请求发出后的新输入'}});
 draft=draftReducer(draft,{type:'saved',values:submitted,revision:3});assert.equal(draft.dirty,true);assert.match(draft.values.lyrics,/新输入/);
 const unchanged=draftReducer(draft,{type:'refresh',row:song});assert.equal(unchanged,draft);
});
test('batch metadata refresh preserves original revisions, records each result, and continues after conflict/failure',async()=>{
 const songs=['success','review','conflict','failed','last'].map((id,index)=>({...song,id,metadataRevision:index+2}));
 const calls=[],progress=[];
 const request=async(url,body)=>{
  calls.push({url,body});const id=body.id||url.split('/')[3];
  if(url==='/admin/refresh-metadata'){
   if(id==='failed')throw new Error('提供者不可用');
   if(id==='success')songs[4].metadataRevision=999;
   return {title:'新标题',artist:'歌手',needs_review:id==='review'};
  }
  if(id==='conflict')throw Object.assign(new Error('资料已更新'),{code:'REVISION_CONFLICT'});
  return {ok:true};
 };
 const results=await refreshMetadataBatch(songs,request,value=>progress.push(value));
 assert.deepEqual(results.map(result=>result.status),['success','review','conflict','failed','success']);
 assert.equal(progress.length,5);assert.equal(calls.find(call=>call.url==='/admin/library/last/save').body.expectedRevision,6);
 assert.equal(calls.filter(call=>call.url.endsWith('/review/save')).length,0);
});
