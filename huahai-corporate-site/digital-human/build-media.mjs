import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = process.env.HUAHAI_CANVAS_PACKAGES;
const require = createRequire(packageRoot ? path.join(packageRoot, '__huahai_runtime__.cjs') : import.meta.url);
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const visuals = createRequire(import.meta.url)('./visuals.js');
const knowledge = JSON.parse(fs.readFileSync(path.join(root, 'knowledge.json'), 'utf8'));
const media = path.join(root, 'media'), build = path.join(root, 'build');
fs.mkdirSync(media, {recursive:true}); fs.mkdirSync(build, {recursive:true});
const chineseFont = process.env.HUAHAI_CHINESE_FONT || '/System/Library/Fonts/PingFang.ttc';
if (!fs.existsSync(chineseFont) || !GlobalFonts.registerFromPath(chineseFont, 'HuahaiChinese')) throw new Error('请设置HUAHAI_CHINESE_FONT为可用中文字体路径');
const voice = process.env.HUAHAI_VOICE || 'Tingting', rate = Number(process.env.HUAHAI_VOICE_RATE || 190);
const sampleRate = 24000, fps = 12;
async function run(cmd, args) {
  const child = spawn(cmd, args, {stdio:['ignore','ignore','pipe']}); let err = '';
  child.stderr.on('data', d => { err = (err + d.toString()).slice(-2000); });
  const [code] = await once(child, 'close'); if (code) throw new Error(`${cmd}失败：${err}`);
}
function wavSamples(file) {
  const b = fs.readFileSync(file); let pos = 12;
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error('无效WAV');
  let valid = false;
  while (pos + 8 <= b.length) { const id = b.toString('ascii', pos, pos + 4), size = b.readUInt32LE(pos + 4); if (id === 'fmt ') valid = b.readUInt16LE(pos + 8) === 1 && b.readUInt16LE(pos + 10) === 1 && b.readUInt32LE(pos + 12) === sampleRate && b.readUInt16LE(pos + 22) === 16; if (id === 'data') { if (!valid) throw new Error('WAV格式不匹配'); return b.subarray(pos + 8, pos + 8 + size); } pos += 8 + size + (size % 2); }
  throw new Error('WAV缺少数据');
}
function writeWav(file, samples) {
  const h = Buffer.alloc(44); h.write('RIFF'); h.writeUInt32LE(samples.length + 36, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(samples.length, 40); fs.writeFileSync(file, Buffer.concat([h, samples]));
}
const segments = [];
knowledge.chapters.forEach((chapter, i) => {
  const texts = [...(i === 0 ? [knowledge.intro] : []), ...chapter.narration, ...(i === knowledge.chapters.length - 1 ? [knowledge.outro] : [])];
  texts.forEach(text => segments.push({text,chapter:i}));
});
let completed = 0, cursor = 0;
async function generateVoice() {
  while (cursor < segments.length) {
    const index = cursor++, segment = segments[index];
    const key = crypto.createHash('sha256').update(`${segment.text}|${voice}|${rate}`).digest('hex').slice(0,16);
    const base = path.join(build, `voice-${key}`), wav = `${base}.wav`;
    if (!fs.existsSync(wav)) {
      fs.writeFileSync(`${base}.txt`, segment.text.replaceAll('AI', '人工智能'), 'utf8');
      await run('say', ['-v',voice,'-r',String(rate),'-f',`${base}.txt`,'-o',`${base}.aiff`]);
      await run('ffmpeg',['-y','-v','error','-i',`${base}.aiff`,'-ar',String(sampleRate),'-ac','1','-c:a','pcm_s16le',wav]);
    }
    segment.samples = wavSamples(wav); segment.duration = segment.samples.length / (sampleRate * 2);
    completed++; if (completed % 10 === 0 || completed === segments.length) console.log(`配音 ${completed}/${segments.length}`);
  }
}
await Promise.all([generateVoice(),generateVoice(),generateVoice()]);
const pause = Buffer.alloc(Math.round(sampleRate * .32) * 2), manifest = {version:knowledge.version,contentHash:crypto.createHash('sha256').update(JSON.stringify(knowledge)).digest('hex'),voice:'macOS Tingting / 中文普通话',character:knowledge.character.type,chapters:[]};
const allBuffers = [], timeline = []; let masterTime = 0;
for (let i = 0; i < knowledge.chapters.length; i++) {
  const chapter = knowledge.chapters[i], own = segments.filter(s => s.chapter === i), buffers = [], cues = []; let localTime = 0;
  for (const s of own) {
    cues.push({start:localTime,end:localTime+s.duration,text:s.text});
    timeline.push({start:masterTime,end:masterTime+s.duration,text:s.text,chapter:i});
    buffers.push(s.samples,pause); allBuffers.push(s.samples,pause);
    localTime += s.duration + .32; masterTime += s.duration + .32;
  }
  const chapterFile = path.join(build,`${chapter.id}.wav`); writeWav(chapterFile,Buffer.concat(buffers));
  await run('ffmpeg',['-y','-v','error','-i',chapterFile,'-c:a','libmp3lame','-b:a','128k',path.join(media,`${chapter.id}.mp3`)]);
  manifest.chapters.push({id:chapter.id,audio:`media/${chapter.id}.mp3`,duration:localTime,cues});
}
manifest.duration = masterTime; manifest.video = 'media/huahai-introduction.mp4';
fs.writeFileSync(path.join(media,'manifest.json'),JSON.stringify(manifest,null,2));
const masterSamples = Buffer.concat(allBuffers); writeWav(path.join(build,'master.wav'),masterSamples);
function stamp(t, dot = false) { let ms = Math.round(t*1000), h=Math.floor(ms/3600000); ms%=3600000; const m=Math.floor(ms/60000); ms%=60000; const s=Math.floor(ms/1000); ms%=1000; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${dot?'.':','}${String(ms).padStart(3,'0')}`; }
const srt = timeline.map((cue,i)=>`${i+1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join('\n');
fs.writeFileSync(path.join(media,'huahai-introduction.srt'),srt,'utf8');
fs.writeFileSync(path.join(media,'huahai-introduction.vtt'),'WEBVTT\n\n'+timeline.map(cue=>`${stamp(cue.start,true)} --> ${stamp(cue.end,true)}\n${cue.text}\n`).join('\n'),'utf8');
fs.writeFileSync(path.join(build,'timeline.json'),JSON.stringify(timeline,null,2));
console.log(`音频与字幕完成：${masterTime.toFixed(1)}秒，共${timeline.length}句。`);
const canvas = createCanvas(1920,1080), ctx = canvas.getContext('2d');
const logo = await loadImage(path.join(root,'..','assets','logo.jpg'));
const sprite = await loadImage(path.join(root,'assets','rhino-sprites.png'));
visuals.video(ctx,knowledge,knowledge.chapters[0],knowledge.intro,{logo,sprite,chapterIndex:0,t:0,mouth:0,progress:0});
fs.writeFileSync(path.join(media,'cover.png'),canvas.toBuffer('image/png'));
if (process.argv.includes('--audio-only')) process.exit(0);
const tempVideo = path.join(media,'huahai-introduction.partial.mp4');
const ff = spawn('ffmpeg',['-y','-v','error','-f','rawvideo','-pix_fmt','rgba','-s','1920x1080','-r',String(fps),'-i','pipe:0','-i',path.join(build,'master.wav'),'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-r','24','-c:a','aac','-b:a','160k','-shortest','-movflags','+faststart',tempVideo],{stdio:['pipe','ignore','pipe']});
let ffError='';ff.stderr.on('data',d=>{ffError=(ffError+d.toString()).slice(-2000)}); const closed=once(ff,'close');
let cueIndex=0;
const totalFrames=Math.ceil(masterTime*fps);
for(let frame=0;frame<totalFrames;frame++){
  const t=frame/fps; while(cueIndex<timeline.length-1 && t>=timeline[cueIndex+1].start)cueIndex++;
  const cue=timeline[cueIndex]; const ch=knowledge.chapters[cue.chapter];
  const startSample=Math.floor(t*sampleRate), count=Math.min(Math.floor(sampleRate/fps),masterSamples.length/2-startSample); let rms=0;
  for(let n=0;n<count;n++)rms+=(masterSamples.readInt16LE((startSample+n)*2)/32768)**2;
  const mouth=Math.min(1,Math.sqrt(rms/Math.max(1,count))*6);
  visuals.video(ctx,knowledge,ch,t<cue.end?cue.text:'',{t,mouth,progress:t/masterTime,chapterIndex:cue.chapter,logo,sprite});
  const raw=ctx.getImageData(0,0,1920,1080).data;
  if(!ff.stdin.write(Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength)))await once(ff.stdin,'drain');
  if(frame%(fps*30)===0)console.log(`视频渲染 ${Math.round(frame/totalFrames*100)}% (${Math.round(t)}/${Math.round(masterTime)}秒)`);
}
ff.stdin.end();const[code]=await closed;if(code)throw new Error(`视频编码失败：${ffError}`);
fs.renameSync(tempVideo,path.join(media,'huahai-introduction.mp4'));
console.log('1080p视频完成。');
