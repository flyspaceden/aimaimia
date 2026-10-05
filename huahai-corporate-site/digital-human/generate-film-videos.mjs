import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

// 仅生成本任务合成场景，不读取或上传生产、用户或设备数据。
const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(path.join(process.env.HUAHAI_CANVAS_PACKAGES||root,'__film_runtime__.cjs'));
const sharp=require('sharp');
const config=JSON.parse(fs.readFileSync(path.join(root,process.env.HUAHAI_VIDEO_CONFIG||'film-video-config.json')));
const api='https://dashscope.aliyuncs.com/api/v1';
const build=path.join(root,'build/film'), dest=path.join(root,'media/film-clips');
fs.mkdirSync(build,{recursive:true}); fs.mkdirSync(dest,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(!process.env.DASHSCOPE_API_KEY) throw new Error('需要DASHSCOPE_API_KEY进程环境');
if(config.clips.length*config.duration>config.maxGeneratedSeconds) throw new Error('超过本任务生成时长预算');
const headers=extra=>({Authorization:`Bearer ${process.env.DASHSCOPE_API_KEY}`,'Content-Type':'application/json',...extra});
async function request(url,init={}){
  // 创建任务禁止自动重试；查询是只读，可对临时网络失败有限重试。
  for(let attempt=0;attempt<(init.method==='POST'?1:4);attempt++){
    try{
      const res=await fetch(url,{...init,signal:AbortSignal.timeout(init.method==='POST'?240000:45000)});
      const data=await res.json();
      if(!res.ok)throw new Error(`模型HTTP ${res.status} / ${String(data.code||'unknown').replace(/[^\w.-]/g,'')}`);
      return data;
    }catch(error){if(init.method==='POST'||attempt===3)throw error;await new Promise(resolve=>setTimeout(resolve,15000));}
  }
}
function trusted(raw){
  const url=new URL(raw);
  if(!['https:','http:'].includes(url.protocol)||!url.hostname.endsWith('.aliyuncs.com')||(url.port&&url.port!=='443'))throw new Error('模型返回非受信媒体地址');
  url.protocol='https:'; return url.toString();
}
async function generate(clip){
  if(!/^[a-z]+-\d+$/.test(clip.id))throw new Error('无效素材编号');
  const img=fs.readFileSync(path.join(root,clip.image));
  const fingerprint=sha(JSON.stringify({clip,model:config.model,resolution:config.resolution,duration:config.duration,imageHash:sha(img),audio:config.audio,promptExtend:config.promptExtend,...(config.shotType?{shotType:config.shotType}:{})}));
  const stateFile=path.join(build,`${clip.id}.json`), video=path.join(dest,`${clip.id}.mp4`);
  let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):null;
  if(state&&state.fingerprint!==fingerprint)throw new Error(`${clip.id}配置变化，需要新编号以避免重复计费`);
  if(state?.status==='SUCCEEDED'&&fs.existsSync(video)&&sha(fs.readFileSync(video))===state.videoHash){console.log(`${clip.id} 使用已完成缓存`);return;}
  if(state?.status==='SUBMITTING'||state?.status==='FAILED'){console.log(`${clip.id} 结果未知或失败，跳过且不重复创建`);return;}
  if(!state){
    // 原子持久锁：同一ID并发或未知结果重跑，只允许一个进程创建付费任务。
    try{fs.mkdirSync(stateFile+'.submit-lock');}catch(error){if(error.code==='EEXIST')throw new Error(`${clip.id}已有提交锁，禁止重复创建`);throw error;}
    state={fingerprint,status:'SUBMITTING',id:clip.id,model:config.model,imageHash:sha(img),createdAt:new Date().toISOString()};
    fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
    const inputImage=await sharp(img).resize({width:1672,withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
    const submitted=await request(`${api}/services/aigc/video-generation/video-synthesis`,{
      method:'POST',headers:headers({'X-DashScope-Async':'enable'}),
      body:JSON.stringify({model:config.model,input:{prompt:clip.prompt,img_url:`data:image/jpeg;base64,${inputImage.toString('base64')}`,negative_prompt:'静止画面、幻灯片、人物畸变、多余手指、场景变形、物体融化、可读文字、标志、水印'},parameters:{resolution:config.resolution,duration:config.duration,audio:config.audio,watermark:config.watermark,prompt_extend:config.promptExtend,...(config.shotType?{shot_type:config.shotType}:{}),seed:clip.seed}})
    });
    if(!/^[\w-]{20,80}$/.test(submitted.output?.task_id||''))throw new Error('未返回有效任务ID，禁止重复创建');
    Object.assign(state,{taskId:submitted.output.task_id,status:submitted.output.task_status,requestId:submitted.request_id});
    fs.writeFileSync(stateFile,JSON.stringify(state,null,2));console.log(`${clip.id} 已提交15秒动态场景`);
  }
  const deadline=Date.now()+30*60*1000;
  while(Date.now()<deadline){
    const data=await request(`${api}/tasks/${state.taskId}`,{headers:headers()});
    if(['FAILED','CANCELED','UNKNOWN'].includes(data.output?.task_status)){
      state.status=data.output.task_status;state.errorCode=String(data.output.code||data.code||'unknown').replace(/[^\w.-]/g,'');fs.writeFileSync(stateFile,JSON.stringify(state,null,2));throw new Error(`${clip.id}生成失败 / ${state.errorCode}`);
    }
    if(data.output?.task_status==='SUCCEEDED'){
      const res=await fetch(trusted(data.output.video_url),{signal:AbortSignal.timeout(120000),redirect:'error'});
      if(!res.ok)throw new Error(`生成视频下载HTTP ${res.status}`);
      const bytes=Buffer.from(await res.arrayBuffer());
      if(bytes.length<100000||bytes.length>150*1024*1024)throw new Error('生成视频文件大小异常');
      fs.writeFileSync(video+'.partial',bytes);fs.renameSync(video+'.partial',video);
      Object.assign(state,{status:'SUCCEEDED',videoHash:sha(bytes),bytes:bytes.length,usage:data.usage,completedAt:new Date().toISOString()});
      fs.writeFileSync(stateFile,JSON.stringify(state,null,2));console.log(`${clip.id} 动态视频完成 (${(bytes.length/1024/1024).toFixed(1)}MB)`);return;
    }
    await new Promise(resolve=>setTimeout(resolve,15000));
  }
  throw new Error(`${clip.id}仍在处理，保存任务ID后退出，可查询继续`);
}
let cursor=0;
async function worker(){while(cursor<config.clips.length){const clip=config.clips[cursor++];try{await generate(clip);}catch(error){console.log(`${clip.id}: ${String(error.message).slice(0,180)}`);}}}
await Promise.all(Array.from({length:config.concurrency},worker));
const completed=config.clips.filter(clip=>JSON.parse(fs.readFileSync(path.join(build,`${clip.id}.json`))).status==='SUCCEEDED');
const manifest={version:1,model:config.model,referenceImageType:'AI-generated illustrative scene',label:'AI生成场景示意',resolution:config.resolution,generatedSeconds:completed.length*config.duration,clips:completed.map(clip=>{const s=JSON.parse(fs.readFileSync(path.join(build,`${clip.id}.json`)));return{id:clip.id,scene:clip.scene,file:`media/film-clips/${clip.id}.mp4`,sha256:s.videoHash,bytes:s.bytes,duration:config.duration,prompt:clip.prompt,fingerprint:s.fingerprint,usage:s.usage};})};
fs.writeFileSync(path.join(dest,config.manifestName||'manifest.json'),JSON.stringify(manifest,null,2));
console.log('全部连续动态场景完成；不含签名URL或凭据。');
