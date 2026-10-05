import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';import {spawn,execFileSync} from 'node:child_process';import {once} from 'node:events';
import {synthesizeChapter} from './natural-voice.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),build=path.join(root,'build/promo-consistent');fs.mkdirSync(build,{recursive:true});
const ffmpeg=process.env.HUAHAI_FFMPEG||'ffmpeg',ffprobe=process.env.HUAHAI_FFPROBE||'ffprobe';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=f=>fs.readFileSync(f);
const knowledge=JSON.parse(read(path.join(root,'promo-knowledge.json'))),old=JSON.parse(read(path.join(root,'build/promo/voice-manifest.json')));
const initial=old.paragraphs[0],cache=path.join(root,'build/promo',initial.wav),meta=JSON.parse(read(cache.replace(/\.wav$/,'.json'))),cue=meta.cues[0];
async function convert(args){const c=spawn(ffmpeg,args,{stdio:['ignore','ignore','pipe']});let err='';c.stderr.on('data',d=>err=(err+d).slice(-1000));const[code]=await once(c,'close');if(code)throw new Error(err);}
const reference=path.join(build,'female-reference.wav');
await convert(['-y','-v','error','-ss',String(cue.start),'-i',cache,'-t',String(cue.end-cue.start+.15),'-ar','24000','-ac','1','-c:a','pcm_s16le',reference]);
const referenceHash=sha(read(reference)),targetModel='qwen3-tts-vc-2026-01-22',profileFile=path.join(build,'voice-profile.json');
let profile=fs.existsSync(profileFile)?JSON.parse(read(profileFile)):null;
if(profile&&(profile.referenceHash!==referenceHash||profile.targetModel!==targetModel))throw new Error('固定声线参考发生变化，需要新的音色版本');
if(!profile){
  try{fs.mkdirSync(profileFile+'.submit-lock');}catch(error){if(error.code==='EEXIST')throw new Error('固定声线已有未知提交，禁止重建');throw error;}
  if(!process.env.DASHSCOPE_API_KEY)throw new Error('需要模型进程凭据');
  const response=await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization',{method:'POST',headers:{Authorization:`Bearer ${process.env.DASHSCOPE_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:'qwen-voice-enrollment',input:{action:'create',target_model:targetModel,preferred_name:'huahaiwarm',language:'zh',audio:{data:`data:audio/wav;base64,${read(reference).toString('base64')}`},text:cue.text}}),signal:AbortSignal.timeout(120000)});
  const result=await response.json();if(!response.ok)throw new Error(`音色固定失败HTTP${response.status}/${String(result.code||'unknown').replace(/[^\w.-]/g,'')}`);
  if(!result.output?.voice||result.output?.fallback_mode)throw new Error('音色参考未能可靠提取，禁止把回退声线用于成片');
  profile={voice:result.output.voice,targetModel,referenceHash,referenceText:cue.text,referenceType:'本任务已生成的温暖女声，不是真人身份克隆',requestId:result.request_id};fs.writeFileSync(profileFile,JSON.stringify(profile,null,2));
  console.log('单一参考女声音色已固定。');
}
const config={...JSON.parse(read(path.join(root,'voice-config.json'))),model:targetModel,voice:profile.voice,optimizeInstructions:false,instructions:'',maxParagraphBytes:480,paragraphPauseSeconds:.2,referenceHash};
const entries=knowledge.chapters.flatMap((ch,chapter)=>ch.narration.map(text=>({text,chapter}))),texts=entries.map(e=>e.text);
const getDuration=file=>Number(execFileSync(ffprobe,['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file],{encoding:'utf8'}));
const generated=await synthesizeChapter(texts,config,build,(raw,out)=>convert(['-y','-v','error','-i',raw,'-ar','24000','-ac','1','-c:a','pcm_s16le',out]),getDuration);
function samples(file){const b=read(file);let p=12;while(p+8<=b.length){const n=b.readUInt32LE(p+4);if(b.toString('ascii',p,p+4)==='data')return b.subarray(p+8,p+8+n);p+=8+n+(n%2);}throw new Error('无PCM');}
const buffers=[Buffer.alloc(24000*2*2)];for(let i=0;i<generated.parts.length;i++){buffers.push(samples(generated.parts[i].wav));if(i<generated.parts.length-1)buffers.push(Buffer.alloc(24000*2*.2));}buffers.push(Buffer.alloc(24000*2*3));
const data=Buffer.concat(buffers),header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(data.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);const audio=path.join(build,'promo-master.wav');fs.writeFileSync(audio,Buffer.concat([header,data]));
const timeline=generated.cues.map((c,i)=>({...c,start:c.start+2,end:c.end+2,chapter:entries[i].chapter})),duration=data.length/48000,chapterStarts=knowledge.chapters.map((ch,i)=>timeline.find(c=>c.chapter===i).start);
if(timeline.length!==entries.length||timeline.at(-1).end>duration)throw new Error('统一女声时序不匹配');
fs.writeFileSync(path.join(build,'timeline.json'),JSON.stringify(timeline,null,2));
fs.writeFileSync(path.join(build,'voice-manifest.json'),JSON.stringify({duration,chapterStarts,voice:'固定参考温暖女声',model:targetModel,referenceHash,profileHash:sha(JSON.stringify(profile)),config,configHash:sha(JSON.stringify(config)),knowledgeHash:sha(read(path.join(root,'promo-knowledge.json'))),audioHash:sha(read(audio)),paragraphs:generated.parts.map(p=>({wav:path.basename(p.wav),wavHash:p.wavHash,fingerprint:p.fingerprint,similarity:p.similarity,sentenceStats:p.sentenceStats}))},null,2));
console.log(`全片共用一个固定女声音色 · ${generated.parts.length}长段 · ${duration.toFixed(2)}秒 · ${entries.length}句原文检查通过`);
