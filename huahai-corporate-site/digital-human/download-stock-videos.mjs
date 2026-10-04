import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';import {execFileSync,spawn} from 'node:child_process';import {once} from 'node:events';
const root=path.dirname(fileURLToPath(import.meta.url)),dest=path.join(root,'media/stock-clips');fs.mkdirSync(dest,{recursive:true});
const candidates=JSON.parse(fs.readFileSync(path.join(root,'build/stock-candidates.json')));
const selected=candidates.filter(c=>{const m=c.url.match(/(?:hd_|uhd_|\/\d+_)(\d+)_(\d+)_/);return !m||Number(m[1])/Number(m[2])>1.3;});
const ffprobe=process.env.HUAHAI_FFPROBE||'ffprobe',ffmpeg=process.env.HUAHAI_FFMPEG||'ffmpeg',sha=b=>crypto.createHash('sha256').update(b).digest('hex');let cursor=0;const records=[];
async function worker(){while(cursor<selected.length){const c=selected[cursor++];
  try{
    if(!['Pexels License','Mixkit Stock Video Free License'].includes(c.license))throw new Error('未核实商业许可');
    const u=new URL(c.url);if(u.protocol!=='https:'||!['videos.pexels.com','assets.mixkit.co'].includes(u.hostname)||!u.pathname.endsWith('.mp4')||u.search)throw new Error('非已观察的公开视频地址');
    if(!/^(pexels|mixkit)-\d+$/.test(c.id))throw new Error('无效素材ID');
    const file=path.join(dest,c.id+'.mp4');
    if(!fs.existsSync(file)){
      // 读取已观察的公开视频，只提取前18秒；无授权头、Cookie或模型凭据。
      const partial=file+'.partial.mp4',child=spawn(ffmpeg,['-y','-v','error','-rw_timeout','180000000','-i',u.toString(),'-t','18','-an','-c:v','copy','-movflags','+faststart',partial],{stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',d=>err=(err+d).slice(-600));const[code]=await once(child,'close');if(code)throw new Error('素材提取失败：'+err);fs.renameSync(partial,file);
    }
    const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate:format=duration','-of','json',file],{encoding:'utf8'}));
    const s=probe.streams[0],duration=Number(probe.format.duration);if(s.width/s.height<1.3||duration<4)throw new Error('非横屏或时长不足');
    records.push({...c,file:'media/stock-clips/'+c.id+'.mp4',sha256:sha(fs.readFileSync(file)),duration,width:s.width,height:s.height,fps:s.avg_frame_rate});console.log(`${c.id} 新镜头就绪 · ${s.width}×${s.height} · ${duration.toFixed(1)}秒`);
  }catch(error){console.log(`${c.id}: ${error.message}`);}
}}
await Promise.all([worker(),worker(),worker(),worker()]);records.sort((a,b)=>a.id.localeCompare(b.id));
fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify({version:1,commercialLicenseVerified:true,clips:records},null,2));console.log(`完成${records.length}段独立授权镜头。`);
