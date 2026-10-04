import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {synthesizeChapter} from './natural-voice.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),build=path.join(root,'build/promo');fs.mkdirSync(build,{recursive:true});
const knowledge=JSON.parse(fs.readFileSync(path.join(root,'promo-knowledge.json')));
const original=JSON.parse(fs.readFileSync(path.join(root,'voice-config.json')));
const config={...original,instructions:'温暖自然、亲切从容而有感染力的品牌介绍女声。普通话清晰，带轻微微笑感，像面对面向朋友介绍一家公司。句子连贯，语速适中，逗号短停，段落自然换气；有轻柔的抑扬变化。不要机械逐字朗读，不要新闻播报腔，不要夸张叫卖。公司名华海农科和产品名爱买买要自然、清楚。',paragraphPauseSeconds:.45};
const ffmpeg=process.env.HUAHAI_FFMPEG||'ffmpeg',ffprobe=process.env.HUAHAI_FFPROBE||'ffprobe';
const rate=24000,hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function samples(file){const b=fs.readFileSync(file);let p=12;while(p+8<=b.length){const n=b.readUInt32LE(p+4);if(b.toString('ascii',p,p+4)==='data')return b.subarray(p+8,p+8+n);p+=8+n+(n%2);}throw new Error('无PCM音轨');}
function wav(file,data){const b=Buffer.alloc(44);b.write('RIFF');b.writeUInt32LE(data.length+36,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(data.length,40);fs.writeFileSync(file,Buffer.concat([b,data]));}
async function convert(raw,out){const c=spawn(ffmpeg,['-y','-v','error','-i',raw,'-ar',String(rate),'-ac','1','-c:a','pcm_s16le',out],{stdio:['ignore','ignore','pipe']});let e='';c.stderr.on('data',d=>e=(e+d).slice(-1000));const[code]=await once(c,'close');if(code)throw new Error(e);}
const parts=[];let cursor=0;
async function worker(){while(cursor<knowledge.chapters.length){const i=cursor++,ch=knowledge.chapters[i];const generated=await synthesizeChapter(ch.narration,config,build,convert,file=>Number(execFileSync(ffprobe,['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file],{encoding:'utf8'})));parts[i]=generated;console.log(`宣传女声 ${ch.id} 完成 · 原稿匹配 ${(generated.similarity*100).toFixed(1)}%`);}}
await Promise.all([worker(),worker()]);
const buffers=[Buffer.alloc(rate*2*2)],timeline=[],chapterStarts=[];let time=2;
for(let i=0;i<parts.length;i++){
  chapterStarts.push(time);const p=parts[i];timeline.push(...p.cues.map(c=>({...c,start:c.start+time,end:c.end+time,chapter:i})));
  for(let j=0;j<p.parts.length;j++){buffers.push(samples(p.parts[j].wav));if(j<p.parts.length-1)buffers.push(Buffer.alloc(Math.round(rate*config.paragraphPauseSeconds)*2));}
  time+=p.duration;const pause=i===parts.length-1?3:.6;buffers.push(Buffer.alloc(Math.round(rate*pause)*2));time+=pause;
}
const data=Buffer.concat(buffers);const out=path.join(build,'promo-master.wav');wav(out,data);
if(Math.abs(data.length/(rate*2)-time)>.001||timeline.at(-1).end>time)throw new Error('宣传配音拼接与时序不一致');
fs.writeFileSync(path.join(build,'timeline.json'),JSON.stringify(timeline,null,2));
fs.writeFileSync(path.join(build,'voice-manifest.json'),JSON.stringify({duration:time,chapterStarts,voice:config.voice,model:config.model,config,configHash:hash(JSON.stringify(config)),knowledgeHash:hash(fs.readFileSync(path.join(root,'promo-knowledge.json'))),audioHash:hash(fs.readFileSync(out)),paragraphs:parts.flatMap(x=>x.parts.map(p=>({wav:path.basename(p.wav),wavHash:p.wavHash,fingerprint:p.fingerprint,similarity:p.similarity,sentenceStats:p.sentenceStats})))},null,2));
console.log(`宣传配音与${timeline.length}句时间轴完成 · ${time.toFixed(2)}秒`);
