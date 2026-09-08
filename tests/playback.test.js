import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeManifest,resourceUrl,backgroundImages} from '../src/playback/manifest.js';
import {createPlaybackController} from '../src/playback/controller.js';
class Media extends EventTarget {
 constructor(url=''){super();this.src=url;this.currentTime=0;this.paused=true;this.volume=1;this.loads=0;this.failure=null;this.pending=null;}
 play(){this.paused=false;if(this.failure){this.paused=true;return Promise.reject(this.failure);}return this.pending||Promise.resolve();}
 pause(){this.paused=true;}
 load(){this.loads++;}
 removeAttribute(name){if(name==='src')this.src='';}
 emit(name){this.dispatchEvent(new Event(name));}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(options={}) {
 const video=new Media(),events=[],audios=[],manifest=normalizeManifest({version:2,revision:3,vocal:true,backing:true,video:true,...options.manifest},{songId:42,token:'room'});
 let pulse,finished=0;
 const controller=createPlaybackController({video,manifest,createAudio:url=>{const el=new Media(url);audios.push(el);return el;},createContext:()=>null,onStatus:event=>events.push(event),onEnded:()=>finished++,schedule:fn=>{pulse=fn;return 1;},cancel:()=>{},...options.controller});
 return {controller,video,audios,events,pulse:()=>pulse(),finished:()=>finished};
}
test('manifest supports old booleans, detail capability, per-resource revisions and offsets',()=>{
 const result=normalizeManifest({version:2,revision:8,vocal:true,backing:true,resources:{vocal:{url:'/api/assets/1/vocal?x=1',revision:9,offset:1.5},backing:{available:false}}},{songId:1,token:'hello world'});
 assert.equal(result.resources.vocal.url,'/api/assets/1/vocal?x=1&token=hello+world&r=9');assert.equal(result.resources.vocal.offset,1.5);assert.equal(result.resources.backing,undefined);
 assert.equal(resourceUrl('https://images.example/image.jpg',{token:'secret',revision:4}),'https://images.example/image.jpg?r=4');
 assert.equal(backgroundImages({images:['/cover.jpg'],revision:2},'room')[0].url,'/cover.jpg?token=room&r=2');
});
test('one failed track falls back, picture failure preserves sound, retry restores requested audio',async()=>{
 const s=setup();s.audios[1].failure=new Error('corrupt audio');s.controller.setState({lease:true,paused:false,variant:'backing'});await tick();
 assert.equal(s.controller.selected().kind,'vocal');assert.equal(s.audios[0].volume,1);assert.equal(s.audios[0].paused,false);assert.equal(s.events.at(-1).error,'');
 s.video.emit('error');assert.equal(s.audios[0].paused,false);assert.equal(s.events.at(-1).pictureError,true);
 s.audios[1].failure=null;assert.equal(await s.controller.start({retry:true}),true);assert.equal(s.controller.selected().kind,'backing');assert.equal(s.audios[1].volume,1);s.controller.destroy();
});
test('both track failures surface retryable error and successful retry resumes',async()=>{
 const s=setup();s.audios.forEach(el=>el.failure=new Error('missing'));s.controller.setState({lease:true,paused:false});await tick();assert.match(s.events.at(-1).error,/均无法加载/);
 s.audios.forEach(el=>el.failure=null);await s.controller.start({retry:true});assert.equal(s.events.at(-1).error,'');assert.equal(s.audios[1].paused,false);s.controller.destroy();
});
test('autoplay denial is visible and gesture retry starts both media in the same stack',async()=>{
 const s=setup();s.audios.forEach(el=>el.failure=Object.assign(new Error('gesture'),{name:'NotAllowedError'}));s.controller.setState({lease:true,paused:false});await tick();assert.equal(s.events.at(-1).blocked,true);
 s.audios.forEach(el=>el.failure=null);const retry=s.controller.start({retry:true});assert.ok(s.audios.every(el=>!el.paused));assert.equal(await retry,true);assert.equal(s.events.at(-1).blocked,false);s.controller.destroy();
});
test('pause, lease loss and stale play completion cannot restart old audio',async()=>{
 const s=setup();let finish;s.audios[0].pending=new Promise(resolve=>finish=resolve);s.controller.setState({lease:true,paused:false});s.controller.setState({paused:true});finish();await tick();assert.ok(s.audios.every(el=>el.paused));
 s.controller.setState({paused:false});await tick();s.controller.setState({lease:false});assert.ok(s.audios.every(el=>el.paused));assert.equal(await s.controller.start({retry:true}),false);
 s.controller.setState({lease:true});await tick();assert.ok(s.audios.every(el=>!el.paused));s.controller.destroy();assert.ok(s.audios.every(el=>el.paused));s.audios[1].emit('ended');assert.equal(s.finished(),0);
});
test('switching audio preserves song time, aligns resource offsets and selected track alone ends queue',async()=>{
 const s=setup({manifest:{resources:{vocal:{url:'/vocal',offset:2},backing:{url:'/backing',offset:0},video:{url:'/video',offset:1}}}});s.controller.setState({lease:true,paused:false,variant:'backing'});await tick();
 s.audios[1].currentTime=10;s.pulse();assert.equal(s.controller.getTime(),10);assert.equal(s.audios[0].currentTime,12);assert.equal(s.video.currentTime,11);
 s.controller.setState({variant:'vocal'});assert.equal(s.controller.getTime(),10);assert.equal(s.audios[0].volume,1);assert.equal(s.audios[1].volume,0);
 s.audios[1].emit('ended');assert.equal(s.finished(),0);s.audios[0].emit('ended');s.audios[0].emit('ended');assert.equal(s.finished(),1);s.controller.destroy();
});
test('AudioContext resume denial is retried and graph resources close on teardown',async()=>{
 let allow=false,closed=false;const context={state:'suspended',currentTime:0,destination:{},createMediaElementSource:()=>({connect(){}}),createGain:()=>({connect(){},gain:{setTargetAtTime(){}}}),createAnalyser:()=>({connect(){}}),resume(){if(!allow)return Promise.reject(new Error('blocked'));this.state='running';return Promise.resolve();},close(){closed=true;return Promise.resolve();}};
 const s=setup({controller:{createContext:()=>context}});s.controller.setState({lease:true,paused:false});await tick();assert.equal(s.events.at(-1).blocked,true);allow=true;assert.equal(await s.controller.start({retry:true}),true);assert.equal(s.events.at(-1).blocked,false);s.controller.destroy();assert.equal(closed,true);
});
