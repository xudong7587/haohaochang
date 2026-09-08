import path from 'node:path';
import fs from 'node:fs/promises';
import {createApp} from '../server/app.js';
import {run,searchText} from '../server/media.js';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
process.env.FFMPEG=ffmpeg;process.env.FFPROBE=ffprobe.path;
try{await fs.access(path.resolve('.tools/yt-dlp.exe'));process.env.YTDLP=path.resolve('.tools/yt-dlp.exe');}catch{}
if(process.platform==='win32'){const bin=path.resolve('.tools/media-bin');await fs.mkdir(bin,{recursive:true});await fs.copyFile(ffmpeg,path.join(bin,'ffmpeg.exe'));await fs.copyFile(ffprobe.path,path.join(bin,'ffprobe.exe'));process.env.YTDLP_FFMPEG=bin;}
const dataDir=path.resolve('data-preview'),media=path.join(dataDir,'media'),cache=path.join(dataDir,'cache');
await fs.mkdir(media,{recursive:true});await fs.mkdir(cache,{recursive:true});
const downloads=path.join(dataDir,'downloads');
const {app,store}=createApp({adminToken:'preview-ktv-2026',dataDir,roots:[media],downloads});
store.set('publicUrl','http://127.0.0.1:3210');
const samples=[
  {title:'客厅试音 · 双版本',artist:'好好唱实验室',color:'0x514368',mode:'tracks'},
  {title:'晚风练习曲',artist:'合成音频',color:'0x314b50',mode:'tracks'},
  {title:'周末的小舞台',artist:'好好唱实验室',color:'0x645245',mode:'tracks'},
  {title:'只有音频，也能唱',artist:'合成音频',color:'0x37364e',mode:'original',audio:true},
  {title:'一首纯伴奏',artist:'好好唱实验室',color:'0x414e67',mode:'instrumental'},
  {title:'第一次点歌才准备',artist:'合成音频',color:'0x5a3f52',mode:'original',unprepared:true},
];
let seeding=false;
async function seed(){
  if(seeding)throw new Error('测试资源正在生成，请稍候');seeding=true;
  try{
    for(const [i,song] of samples.entries()){
      const id=(i+1).toString(16).repeat(24),source=path.join(media,`${song.artist} - ${song.title}${song.audio?'.wav':'.mp4'}`);
      try{await fs.stat(source);}catch{
        const args=['-y','-v','error'];
        if(!song.audio)args.push('-f','lavfi','-i',`color=c=${song.color}:s=1280x720:r=15:d=45`);
        args.push('-f','lavfi','-i',`sine=frequency=${220+i*55}:duration=45`);
        if(!song.audio)args.push('-f','lavfi','-i',`sine=frequency=${440+i*55}:duration=45`,'-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart');
        args.push(source);await run(ffmpeg,args,120000);
      }
      const lyrics='[00:00.00]欢迎来到你的客厅舞台\n[00:05.00]这是一段合成试音，不是真实歌曲\n[00:10.00]拿起遥控器，试着切换音轨\n[00:15.00]手机也能为你送上掌声\n[00:20.00]下一句歌词，会跟随播放出现\n[00:25.00]原唱按钮会切到另一种测试音\n[00:30.00]切歌以后，下一位准备开唱\n[00:38.00]好好唱，把快乐留在客厅';
      store.db.prepare('INSERT OR IGNORE INTO songs (id,path,title,artist,search,mode,backing,vocal,status,duration,needs_video,lyrics,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,source,song.title,song.artist,searchText(song.title,song.artist),song.mode,0,song.mode==='tracks'?1:0,song.unprepared?'new':'ready',45,song.audio?1:0,lyrics,Date.now()-i);
      if(!song.unprepared){
        const variants=song.mode==='original'?['vocal']:song.mode==='instrumental'?['backing']:['backing','vocal'];
        for(const variant of variants){
          const output=path.join(cache,`${id}-${variant}.mp4`);try{await fs.stat(output);continue;}catch{}
          const args=['-y','-v','error','-i',source];if(song.audio)args.push('-f','lavfi','-i',`color=c=${song.color}:s=1280x720:r=15:d=45`);
          args.push('-map',song.audio?'1:v:0':'0:v:0','-map',`0:a:${song.mode==='tracks'&&variant==='vocal'?1:0}`,'-c:v',song.audio?'libx264':'copy','-c:a','aac','-shortest','-movflags','+faststart',output);await run(ffmpeg,args,120000);
        }
      }
    }
  }finally{seeding=false;}
}
if(process.env.KTV_DEMO_FIXTURES==='1'){console.log('Preparing independent preview fixtures…');await seed();}
app.get('/simulator',(req,res)=>res.sendFile(path.resolve('preview/index.html')));
app.get('/preview-info',(req,res)=>res.json({mode:'local-preview',password:'preview-ktv-2026',media,downloads,seeding}));
app.post('/preview-fixtures',async(req,res)=>{if(req.get('origin')&&req.get('origin')!=='http://127.0.0.1:3210')return res.status(403).json({error:'本机预览接口'});try{await seed();res.json({ok:true});}catch(e){res.status(409).json({error:e.message});}});
app.listen(3210,'127.0.0.1',()=>console.log('Preview ready: http://127.0.0.1:3210/simulator'));
