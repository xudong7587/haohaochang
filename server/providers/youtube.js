import {run} from '../process.js';
const ffmpeg=()=>process.env.YTDLP_FFMPEG?['--ffmpeg-location',process.env.YTDLP_FFMPEG]:[];
export const youtubeProvider={
 async search(query,_cookie='',execute=run){
  const body=JSON.parse(await execute(process.env.YTDLP||'yt-dlp',[...ffmpeg(),'--ignore-config','--flat-playlist','--dump-single-json','--no-warnings','--',`ytsearch12:${query}`],45000));
  return (body.entries||[]).map(row=>({title:row.title,artist:row.channel||row.uploader||'YouTube',uploader:row.uploader||row.channel,url:`https://www.youtube.com/watch?v=${row.id}`,duration:Number(row.duration)||null,provider:'youtube'}));
 },
 async metadata(url,_cookie='',execute=run){
  const row=JSON.parse(await execute(process.env.YTDLP||'yt-dlp',[...ffmpeg(),'--ignore-config','--no-playlist','--skip-download','--dump-single-json','--',url],60000));
  return {url,title:row.title,uploader:row.uploader,duration:row.duration};
 }
};
