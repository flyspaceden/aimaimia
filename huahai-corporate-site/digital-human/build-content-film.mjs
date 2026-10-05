import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';

const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(path.join(process.env.HUAHAI_CANVAS_PACKAGES||root,'__film_runtime__.cjs'));
const {createCanvas,GlobalFonts,loadImage}=require('@napi-rs/canvas');
const ffmpeg=process.env.HUAHAI_FFMPEG||'ffmpeg';
const ffprobe=process.env.HUAHAI_FFPROBE||'ffprobe';
const fps=25,W=1920,H=1080;
const build=path.join(root,'build/brand-v2'),media=path.join(root,'media');fs.mkdirSync(build,{recursive:true});
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const timeline=JSON.parse(fs.readFileSync(path.join(root,'build/promo-consistent/timeline.json')));
const storyboard=JSON.parse(fs.readFileSync(path.join(root,'film-storyboard.json')));
const knowledge=JSON.parse(fs.readFileSync(path.join(root,'promo-knowledge.json')));
const sourceInfo=JSON.parse(fs.readFileSync(path.join(root,'film-sources.json')));
const audio=path.join(root,'build/promo-consistent/promo-master.wav');
const voiceManifest=JSON.parse(fs.readFileSync(path.join(root,'build/promo-consistent/voice-manifest.json')));
if(voiceManifest.knowledgeHash!==sha(fs.readFileSync(path.join(root,'promo-knowledge.json')))||voiceManifest.audioHash!==sha(fs.readFileSync(audio)))throw new Error('宣传配音与新版完整讲稿不一致');
const duration=Number(execFileSync(ffprobe,['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',audio],{encoding:'utf8'}).trim());
const totalFrames=Math.ceil(duration*fps);
const originalEntries=knowledge.chapters.flatMap((ch,chapter)=>ch.narration.map(text=>({text,chapter})));
if(storyboard.shots.length!==timeline.length||timeline.length!==originalEntries.length||timeline.some((c,i)=>c.text!==originalEntries[i].text||c.chapter!==originalEntries[i].chapter||c.end<c.start||c.end>duration+.01||(i&&c.start<timeline[i-1].end)))throw new Error('讲稿、章节或配音时序不一致');
const generated=JSON.parse(fs.readFileSync(path.join(root,'media/film-clips/promo-clips-manifest.json'))).clips.concat(JSON.parse(fs.readFileSync(path.join(root,'media/film-clips/promo-extra-clips-manifest.json'))).clips);
const reserve={'promoagriculture-1':2,'promofieldtech-1':11,'promopond-1':25,'promopacking-1':23,'promoresearch-1':14,'promohome-1':33,'promoharvest-1':0,'promotablet-1':12,'promofood-1':28,'promodelivery-1':16};
const allClips=generated.map(c=>({...c,id:c.id,scene:({agriculture:'production',fieldtech:'sensors',pond:'aquaculture',packing:'logistics',research:'lab',home:'family'})[c.scene]||c.scene,file:path.join(root,c.file),hash:c.sha256,kind:'ai'})).concat(JSON.parse(fs.readFileSync(path.join(root,'media/stock-clips/manifest.json'))).clips.map(c=>({...c,file:path.join(root,c.file),hash:c.sha256,kind:'stock'})));
for(const c of allClips)if(c.hash!==sha(fs.readFileSync(c.file)))throw new Error('素材Hash不一致：'+c.id);
const byScene={};for(const c of allClips)(byScene[c.scene]??=[]).push(c);
const usage={},shots=[];const usedIds=new Set();
for(let i=0;i<timeline.length;i++){
  const spec=storyboard.shots[i],first=i===0?0:Math.round(timeline[i].start*fps),end=i===timeline.length-1?totalFrames:Math.round(timeline[i+1].start*fps);
  let from=first,n=0;
  while(from<end){
    const remaining=end-from,count=Math.ceil(remaining/(fps*12.8)),wanted=Math.round(remaining/count),needed=wanted/fps;
    const scenes=[...spec.shotScenes];if(scenes.includes('tablet'))scenes.push('delivery','family');if(scenes.includes('sensors'))scenes.push('tablet','aquaculture','production');
    const candidates=allClips.filter(c=>!usedIds.has(c.id)&&scenes.includes(c.scene)&&(reserve[c.id]===undefined||reserve[c.id]===i||reserve[c.id]<i));
    const ready=candidates.filter(c=>c.duration>=needed+.12);
    const preferred=ready.filter(c=>reserve[c.id]===i);
    const list=(preferred.length?preferred:ready.length?ready:candidates).sort((a,b)=>a.duration-b.duration);
    const clip=list[0];if(!clip)throw new Error('第'+i+'句缺少不同场景，禁止重复镜头凑片');
    const frames=Math.min(wanted,Math.floor((clip.duration-.12)*fps));if(frames<=0)throw new Error('素材过短');
    const to=from+frames,seconds=frames/fps,offset=clip.kind==='stock'?Math.min(.35,clip.duration-seconds-.12):0;
    usedIds.add(clip.id);usage[clip.id]={offset,total:seconds,restarts:0};
    shots.push({...spec,id:shots.length,startFrame:from,endFrame:to,frames,start:from/fps,end:to/fps,seconds,scene:clip.scene,kind:clip.kind,license:clip.license,sourcePage:clip.page,clipId:clip.id,clipFile:clip.file,clipHash:clip.hash,speed:1,offset,part:n});from=to;n++;
  }
}
if(shots[0].startFrame!==0||shots.at(-1).endFrame!==totalFrames||shots.some((s,i)=>i&&s.startFrame!==shots[i-1].endFrame))throw new Error('分镜存在间隙或重叠');
const filmPlan={version:knowledge.version,duration,fps,totalFrames,audioHash:sha(fs.readFileSync(audio)),timelineHash:sha(fs.readFileSync(path.join(root,'build/promo-consistent/timeline.json'))),storyboardHash:sha(fs.readFileSync(path.join(root,'film-storyboard.json'))),knowledgeHash:sha(fs.readFileSync(path.join(root,'promo-knowledge.json'))),sourceInfo,clipUsage:usage,shots:shots.map(({clipFile,...s})=>({...s,clipFile:path.relative(root,clipFile)}))};
fs.writeFileSync(path.join(build,'film-plan.json'),JSON.stringify(filmPlan,null,2));

async function run(args){
  const child=spawn(ffmpeg,args,{stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',d=>err=(err+d).slice(-2500));
  const[code]=await once(child,'close');if(code)throw new Error(`视频处理失败：${err}`);
}
async function backgrounds(){
  const folder=path.join(build,'segments');fs.mkdirSync(folder,{recursive:true});let cursor=0;
  async function worker(){while(cursor<shots.length){
    const shot=shots[cursor++],stem=String(shot.id).padStart(3,'0'),out=path.join(folder,`${stem}.mp4`),record=path.join(folder,`${stem}.json`);
    const fingerprint=sha(JSON.stringify({clipHash:shot.clipHash,frames:shot.frames,offset:shot.offset,speed:shot.speed,fps,W,H,encoder:'software-decode-v2-25fps'}));
    if(fs.existsSync(out)&&fs.existsSync(record)&&JSON.parse(fs.readFileSync(record)).fingerprint===fingerprint)continue;
    await run(['-y','-v','error','-ss',String(shot.offset),'-i',shot.clipFile,'-an','-vf',`setpts=${shot.speed}*(PTS-STARTPTS),scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps}`,'-frames:v',String(shot.frames),'-c:v','h264_videotoolbox','-b:v','10M','-profile:v','high','-pix_fmt','yuv420p',out+'.partial.mp4']);
    fs.renameSync(out+'.partial.mp4',out);fs.writeFileSync(record,JSON.stringify({fingerprint}));
    if((shot.id+1)%10===0||shot.id===shots.length-1)console.log(`连续镜头整理 ${shot.id+1}/${shots.length}`);
  }}
  await Promise.all([worker(),worker(),worker()]);
  const concat=path.join(folder,'concat.txt');fs.writeFileSync(concat,shots.map(s=>`file '${path.join(folder,String(s.id).padStart(3,'0')+'.mp4').replaceAll("'","'\\''")}'`).join('\n'));
  await run(['-y','-v','error','-f','concat','-safe','0','-i',concat,'-c','copy',path.join(build,'background.mp4')]);
  console.log('全片背景均为连续动态视频。');
}

if(!GlobalFonts.registerFromPath(process.env.HUAHAI_CHINESE_FONT||'/System/Library/Fonts/PingFang.ttc','FilmChinese'))throw new Error('缺少中文字体');
const canvas=createCanvas(W,H),ctx=canvas.getContext('2d');
const logo=await loadImage(path.join(root,'../assets/logo.jpg'));
const spriteConfig=JSON.parse(fs.readFileSync(path.join(root,'character-config.json')));
const sprite=await loadImage(path.join(root,spriteConfig.sheet));
const screens=await Promise.all(sourceInfo.website.files.map(file=>loadImage(path.join(root,file))));
const food=await loadImage(path.join(root,'assets/film-scenes/family.png'));
const crop=await loadImage(path.join(root,'assets/film-scenes/production.png'));
const clamp=x=>Math.max(0,Math.min(1,x));
const ease=x=>1-(1-clamp(x))**3;
function round(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}}
function text(value,x,y,size=34,color='#fff',weight=500,align='left'){
  ctx.font=`${weight} ${size}px FilmChinese`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillText(value,x,y);
}
function lines(value,maxWidth,size=36,weight=500){
  ctx.font=`${weight} ${size}px FilmChinese`;const result=[];let line='';
  for(const char of value){if(line&&ctx.measureText(line+char).width>maxWidth){result.push(line);line=char;}else line+=char;}
  if(line)result.push(line);return result;
}
function wrapped(value,x,y,width,size=32,color='#fff',weight=500,gap=1.4){lines(value,width,size,weight).forEach((line,i)=>text(line,x,y+i*size*gap,size,color,weight));}
function cursor(x,y,t){
  ctx.save();ctx.translate(x,y);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,32);ctx.lineTo(8,24);ctx.lineTo(17,42);ctx.lineTo(24,38);ctx.lineTo(15,21);ctx.lineTo(28,21);ctx.closePath();ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle='#183e31';ctx.lineWidth=2;ctx.stroke();
  const pulse=(t*1.25)%1;ctx.beginPath();ctx.arc(10,16,10+pulse*22,0,Math.PI*2);ctx.strokeStyle=`rgba(31,182,128,${(1-pulse)*.8})`;ctx.lineWidth=3;ctx.stroke();ctx.restore();
}
function mascot(x,y,w,t,speaking){
  const fw=sprite.width/spriteConfig.columns,fh=sprite.height/spriteConfig.rows;
  let frame=speaking?Math.floor(t*5)%3:4;if(Math.floor(t*24)%88<4&&speaking)frame=3;
  const h=w*fh/fw;ctx.drawImage(sprite,frame%spriteConfig.columns*fw,Math.floor(frame/spriteConfig.columns)*fh,fw,fh,x,y+Math.sin(t*2)*3,w,h);
}
function flow(shot,t){
  const labels=shot.detail.split('|'),active=Math.min(labels.length-1,Math.floor((t-shot.start)/(shot.seconds/labels.length)));
  const x=120,y=530,width=1670,h=190;
  round(x-30,y-80,width+60,h+122,24,'rgba(7,40,28,.70)','rgba(224,244,234,.24)');
  text(shot.title,x,y-20,45,'#fff',600);
  const spacing=width/(labels.length-1),py=y+90;
  ctx.strokeStyle='rgba(240,251,245,.30)';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x+70,py);ctx.lineTo(x+width-70,py);ctx.stroke();
  labels.forEach((label,i)=>{
    const px=x+70+i*(width-140)/(labels.length-1),r=i===active?26:19;
    ctx.beginPath();ctx.arc(px,py,r,0,Math.PI*2);ctx.fillStyle=i<=active?'#a3e2bb':'#547767';ctx.fill();
    text(label,px,py+68,30,'#fff',i===active?600:400,'center');
  });
  const phase=((t-shot.start)*.24)%1,px=x+70+phase*(width-140);
  ctx.shadowColor='#96e9bb';ctx.shadowBlur=16;ctx.beginPath();ctx.arc(px,py,8,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.shadowBlur=0;
  text('协作流程示意',x,y+215,23,'#d7e9de',400);
}
function buyer(shot,t){
  const elapsed=t-shot.start,progress=clamp(elapsed/shot.seconds),x=1290,y=178,w=455,h=710;
  round(x-16,y-18,w+32,h+36,54,'#102c22');round(x,y,w,h,40,'#f7faf5');
  ctx.save();ctx.beginPath();ctx.roundRect(x,y,w,h,40);ctx.clip();
  text('爱买买',x+30,y+70,35,'#174d37',600);text('AI生活圈',x+30,y+108,23,'#648374',400);
  round(x+25,y+137,w-50,65,28,'#e8f1e9');
  const query='帮我找适合家庭餐桌的农产品';
  text(query.slice(0,Math.min(query.length,Math.floor(elapsed*4))),x+44,y+177,22,'#335a46',400);
  const orbY=y+277;const glow=ctx.createRadialGradient(x+w/2,orbY,5,x+w/2,orbY,62+Math.sin(t*2)*4);glow.addColorStop(0,'#dffbcf');glow.addColorStop(.55,'#75c58c');glow.addColorStop(1,'#176d48');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x+w/2,orbY,59+Math.sin(t*2)*2,0,Math.PI*2);ctx.fill();text('AI',x+w/2,orbY+12,34,'#fff',600,'center');
  text('用自然语言表达选购需求',x+w/2,y+359,23,'#325c45',400,'center');
  const scroll=Math.max(0,progress-.5)*90;const cards=[['商品发现','查看商品信息'],['搜索与详情','了解规格和资料'],['交易与服务','按当前页面和规则使用']];
  cards.forEach((card,i)=>{const cy=y+389+i*103-scroll;round(x+25,cy,w-50,90,16,'#fff','#e1e9df');ctx.save();ctx.beginPath();ctx.roundRect(x+35,cy+10,80,70,10);ctx.clip();ctx.drawImage(i===0?crop:food,x+35,cy+10,80,70);ctx.restore();text(card[0],x+135,cy+35,24,'#1f4a36',500);text(card[1],x+135,cy+67,20,'#718775',400);});
  round(x,y+h-50,w,60,0,'#fff');text('首页      商品      我的',x+w/2,y+h-17,21,'#4d765d',400,'center');
  ctx.restore();cursor(x+350-80*Math.sin(progress*Math.PI),y+181+progress*270,t);
  wrapped(shot.title,120,415,1000,57,'#fff',600);wrapped(shot.detail,123,518,1000,32,'#f0f8f2',400);
}
function seller(shot,t){
  const x=100,y=230,w=1710,h=596,elapsed=t-shot.start;
  round(x,y,w,h,20,'rgba(246,250,247,.97)');round(x,y,230,h,20,'#174b35');
  const manager=shot.cue===21;
  text('爱买买',x+32,y+64,30,'#fff',600);text(manager?'管理后台':'卖家后台',x+32,y+108,25,'#bcdfca',400);
  (manager?['商户审核','商品审核','订单运营','服务协调']:['商品管理','规格库存','订单履约','商户服务']).forEach((s,i)=>{if(i===Math.floor(elapsed/2)%4)round(x+18,y+145+i*69,195,48,10,'#2d684c');text(s,x+37,y+176+i*69,26,'#fff',400);});
  text(shot.title,x+275,y+63,38,'#1e4d35',600);text('管理流程演示',x+275,y+106,25,'#688070',400);
  const cols=[['商品资料',x+286],['规格 / 批次',x+711],['库存 / 履约',x+1115]];
  round(x+265,y+150,w-300,58,8,'#edf3ed');cols.forEach(c=>text(c[0],c[1],y+189,26,'#385741',500));
  ['资料检查','规格维护','订单准备','服务协调'].forEach((s,i)=>{
    const ry=y+218+i*72;ctx.fillStyle=i===Math.floor(elapsed/2)%4?'#e3f0df':'#fff';ctx.fillRect(x+265,ry,w-300,64);
    text(s,cols[0][1],ry+40,26,'#31533a',400);text('演示条目 '+(i+1),cols[1][1],ry+40,24,'#69846f',400);text('按业务规则处理',cols[2][1],ry+40,24,'#467451',400);
  });cursor(x+1070+Math.sin(elapsed)*35,y+245+(elapsed*35)%244,t);
  text('界面流程示意 · 演示条目 · 依据代码制作',x+275,y+h-25,24,'#738371',400);
}
function systems(shot,t){
  const names=shot.detail.split('|'),elapsed=t-shot.start;const xs=[250,710,1170,1630];
  round(110,298,1690,460,26,'rgba(8,39,29,.77)','rgba(238,250,244,.20)');
  text(shot.title,145,365,47,'#fff',600);
  names.forEach((name,i)=>{const px=xs[i],py=485;round(px-145,py-50,290,100,24,i===Math.floor(elapsed/1.8)%4?'#e7f2df':'#174f3d','#74ae92');text(name,px,py+11,30,i===Math.floor(elapsed/1.8)%4?'#174b35':'#fff',500,'center');ctx.beginPath();ctx.moveTo(px,py+52);ctx.lineTo(px,657);ctx.strokeStyle='#78b397';ctx.lineWidth=3;ctx.stroke();const phase=(elapsed*.4+i*.18)%1;ctx.beginPath();ctx.arc(px,540+phase*116,6,0,Math.PI*2);ctx.fillStyle='#d6f6cc';ctx.fill();});
  ctx.beginPath();ctx.moveTo(250,657);ctx.lineTo(1630,657);ctx.strokeStyle='#78b397';ctx.lineWidth=3;ctx.stroke();round(748,615,420,87,20,'#cfeccb');text('统一业务后端',958,670,34,'#18422a',500,'center');
  text('架构与版本关系示意',146,729,23,'#d7ecde',400);
}
function trace(shot,t){
  const labels=shot.detail.split('|'),elapsed=t-shot.start;round(140,380,1640,370,25,'rgba(5,39,27,.78)','rgba(215,245,228,.28)');text(shot.title,180,450,43,'#fff',600);
  labels.forEach((label,i)=>{const x=180+i*400;round(x,503,350,110,15,'rgba(250,255,247,.95)');text(label,x+175,570,30,'#255137',500,'center');const p=clamp((elapsed-i*.7)/1.7);ctx.strokeStyle='#b8e2b8';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(x,640);ctx.lineTo(x+350*p,640);ctx.stroke();});
  text('需要实际录入的有效资料与具体批次关联',181,713,27,'#d8ecde',400);
}
function rights(shot,t){
  round(160,397,1580,372,26,'rgba(6,33,23,.80)','rgba(226,247,233,.25)');text('独立权益，分别核对规则',198,465,46,'#fff',600);
  shot.detail.split('|').forEach((label,i)=>{const x=200+i*380;const a=ease((t-shot.start-i*.5)/.8);ctx.globalAlpha=a;round(x,520+(1-a)*20,335,117,22,'#eef6e7');text(label,x+168,592+(1-a)*20,34,'#234b31',500,'center');ctx.globalAlpha=1;});
  text('不混用余额，不承诺固定收益',198,714,30,'#d9e7dc',400);
}

const captionBlocks=[];
for(const cue of timeline){
  const parts=[];let pending='';
  for(const segment of cue.text.match(/[^，。；！？]+[，。；！？]?/gu)||[cue.text]){
    if(pending&&Array.from(pending+segment).length>46){parts.push(pending);pending='';}
    if(Array.from(segment).length>46){if(pending){parts.push(pending);pending='';}let chunk='';for(const c of segment){chunk+=c;if(Array.from(chunk).length>=42){parts.push(chunk);chunk='';}}pending=chunk;}else pending+=segment;
  }
  if(pending)parts.push(pending);
  let cursor=cue.start;const length=Array.from(parts.join('')).length;
  parts.forEach((value,i)=>{const end=i===parts.length-1?cue.end:cursor+(cue.end-cue.start)*Array.from(value).length/length;captionBlocks.push({start:cursor,end,text:value});cursor=end;});
  if(parts.join('')!==cue.text)throw new Error('字幕分段改变原稿');
}
function stamp(t,separator='.'){let ms=Math.round(t*1000),h=Math.floor(ms/3600000);ms%=3600000;const m=Math.floor(ms/60000);ms%=60000;const s=Math.floor(ms/1000);ms%=1000;return`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${separator}${String(ms).padStart(3,'0')}`;}
fs.writeFileSync(path.join(media,'huahai-brand-film-v2.srt'),captionBlocks.map((c,i)=>`${i+1}\n${stamp(c.start,',')} --> ${stamp(c.end,',')}\n${c.text}\n`).join('\n'));
fs.writeFileSync(path.join(media,'huahai-brand-film-v2.vtt'),'WEBVTT\n\n'+captionBlocks.map(c=>`${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n'));
fs.writeFileSync(path.join(build,'film-captions.json'),JSON.stringify(captionBlocks,null,2));
function overlayAt(t,shot){
  ctx.clearRect(0,0,W,H);ctx.globalAlpha=1;const local=t-shot.start;
  const shade=ctx.createLinearGradient(0,805,0,H);shade.addColorStop(0,'rgba(0,12,5,0)');shade.addColorStop(1,'rgba(0,12,5,.73)');ctx.fillStyle=shade;ctx.fillRect(0,805,W,275);
  // 少量品牌文字。正文由镜头中的人、产品和现场动作推进。
  ctx.fillStyle='#071b12';ctx.fillRect(0,0,W,60);ctx.fillRect(0,H-58,W,58);
  round(57,11,38,38,8,'#fff');ctx.drawImage(logo,61,15,30,30);text('华海农科',112,39,27,'#eff5e9',500);text('HUAHAI AGRI-TECH',259,38,17,'#b8ccba',400);
  text(shot.kind==='stock'?'场景素材示意':'AI生成场景示意',1859,1058,21,'#c4d5c4',400,'right');
  const chapterTitle=shot.mode==='chapter'&&shot.part===0;
  const firstBrand=t>=3&&t<7;
  if(chapterTitle||firstBrand||shot.mode==='brand'&&shot.part===0){
    const a=clamp(local/.5)*clamp((3.4-local)/.6);ctx.globalAlpha=a;
    ctx.shadowColor='rgba(0,20,8,.72)';ctx.shadowBlur=16;text(firstBrand?'让农业连接美好生活':shot.title,116,784+(1-a)*15,58,'#fff',600);ctx.shadowBlur=0;ctx.globalAlpha=1;
  }
  if(t>=3&&t<6.8){mascot(1530,655,246,t,true);text('小犀 · 品牌讲解员',1660,916,22,'#fff',400,'center');}
  if(['buyer','product'].includes(shot.mode)&&shot.part===0&&local<6.5){
    const adjusted={...shot,start:timeline[shot.cue].start,seconds:Math.min(timeline[shot.cue].end-timeline[shot.cue].start,8),detail:shot.mode==='product'?'买家App · 微信小程序':'自然语言表达选购需求'};buyer(adjusted,t);
  }
  if(shot.mode==='seller'&&shot.part===0&&local<3.2){text(shot.title,116,784,52,'#fff',600);}
  if(t>duration-7){
    ctx.fillStyle='rgba(7,34,20,.50)';ctx.fillRect(0,60,W,H-118);text('华海农科',960,400,85,'#fff',600,'center');text('让农业连接美好生活',960,486,49,'#eaf5e4',400,'center');text('huahainongke.com',960,555,31,'#d5e6cc',400,'center');mascot(1435,617,262,t,t<timeline.at(-1).end);
  }
  const block=captionBlocks.find(c=>t>=c.start&&t<c.end);
  if(block){const rows=lines(block.text,1630,37,500);if(rows.length>2)throw new Error('字幕超过两行');rows.forEach((line,i)=>{const y=rows.length===1?981:942+i*48;ctx.font='500 37px FilmChinese';ctx.textAlign='center';ctx.lineWidth=4;ctx.strokeStyle='rgba(0,12,5,.72)';ctx.strokeText(line,960,y);text(line,960,y,37,'#fff',500,'center');});}
  if(['buyer','product'].includes(shot.mode)&&shot.part===0&&local<6.5)text('界面流程示意 · 依据代码制作',60,1058,21,'#c4d5c4',400);
  if(t>=timeline.at(-1).end){
    text('资料来源：华海农科官网与爱买买代码；画面包含授权素材和AI场景示意。',960,878,23,'#e2ecd9',400,'center');
    text('界面为流程示意，产品能力以实际版本为准；农业大健康为农业与食品生态方向。',960,919,23,'#e2ecd9',400,'center');
  }
  ctx.textAlign='left';
}

async function frameAt(time,file){
  const shot=shots.find(s=>time>=s.start&&time<s.end)||shots.at(-1);const raw=path.join(build,'frame-bg.png');
  await run(['-y','-v','error','-ss',String(shot.offset+(time-shot.start)/shot.speed),'-i',shot.clipFile,'-frames:v','1','-vf',`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`,raw]);
  const bg=await loadImage(raw);overlayAt(time,shot);const out=createCanvas(W,H),x=out.getContext('2d');x.drawImage(bg,0,0,W,H);x.drawImage(canvas,0,0);fs.writeFileSync(file,out.toBuffer('image/png'));
}
async function final(){
  const smoke=process.argv.includes('--smoke'),renderDuration=smoke?3:duration,renderFrames=Math.ceil(renderDuration*fps);
  const background=path.join(build,'background.mp4');if(!fs.existsSync(background))throw new Error('请先生成全片连续背景');
  const output=path.join(media,smoke?'brand-smoke.partial.mp4':'huahai-brand-film-v2.partial.mp4'),mix=path.join(root,'build/promo-consistent/final-mix.wav');
  if(!fs.existsSync(mix))throw new Error('缺少宣传女声与原创音乐混音');
  const mixManifest=JSON.parse(fs.readFileSync(path.join(root,'build/promo-consistent/mix-manifest.json')));
  const mixDuration=Number(execFileSync(ffprobe,['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',mix],{encoding:'utf8'}).trim());
  if(mixManifest.voiceHash!==filmPlan.audioHash||mixManifest.mixHash!==sha(fs.readFileSync(mix))||mixManifest.knowledgeHash!==filmPlan.knowledgeHash||Math.abs(mixDuration-duration)>1/24000+.000001||Math.abs(mixManifest.mixDuration-duration)>1/24000+.000001)throw new Error('混音没有绑定当前讲稿/原声或时长不同，禁止编码');
  const encoder=spawn(ffmpeg,['-y','-v','error','-i',background,'-f','rawvideo','-pix_fmt','rgba','-s',`${W}x${H}`,'-r',String(fps),'-i','pipe:0','-i',mix,'-filter_complex','[0:v][1:v]overlay=shortest=1:format=auto[v]','-map','[v]','-map','2:a:0','-t',String(renderDuration),'-c:v','h264_videotoolbox','-b:v','4M','-profile:v','high','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart','-metadata','title=华海农科 · 让农业连接美好生活','-metadata','comment=画面含Pexels/Mixkit许可场景素材及AI生成示意；界面为依据代码制作的流程示意；资料来源huahainongke.com及爱买买代码；不是基地实拍验收',output],{stdio:['pipe','ignore','pipe']});
  let err='';encoder.stderr.on('data',d=>err=(err+d).slice(-2500));const closed=once(encoder,'close');let index=0;
  for(let frame=0;frame<renderFrames;frame++){
    const t=frame/fps;while(index<shots.length-1&&frame>=shots[index].endFrame)index++;overlayAt(t,shots[index]);const raw=ctx.getImageData(0,0,W,H).data;
    if(!encoder.stdin.write(Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength)))await once(encoder.stdin,'drain');
    if(frame%(fps*30)===0)console.log(`动态影片合成 ${Math.round(t/duration*100)}% · ${Math.round(t)}/${Math.round(duration)}秒`);
  }
  encoder.stdin.end();const[code]=await closed;if(code)throw new Error(`成片编码失败：${err}`);
  if(smoke){fs.renameSync(output,path.join(build,'smoke.mp4'));console.log('3秒合成与编码预检完成。');return;}
  const dest=path.join(media,'huahai-brand-film-v2.mp4');fs.renameSync(output,dest);
  const preview=path.join(media,'huahai-brand-film-v2-preview.mp4');
  await run(['-y','-v','error','-i',dest,'-vf','scale=1280:720','-c:v','h264_videotoolbox','-b:v','1500k','-profile:v','baseline','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart','-metadata','comment=网页轻量版；授权素材与AI场景示意；同一参考女声',preview]);
  filmPlan.videoHash=sha(fs.readFileSync(dest));filmPlan.videoBytes=fs.statSync(dest).size;filmPlan.captionCount=captionBlocks.length;filmPlan.generatedClipCount=shots.filter(s=>s.kind==='ai').length;filmPlan.stockClipCount=shots.filter(s=>s.kind==='stock').length;filmPlan.uniqueClips=true;filmPlan.decoder='software';
  filmPlan.mixAudioHash=sha(fs.readFileSync(mix));fs.writeFileSync(path.join(media,'brand-film-v2-manifest.json'),JSON.stringify(filmPlan,null,2));await frameAt(4,path.join(media,'brand-film-v2-cover.png'));
  console.log(`完整动态影片完成 · ${duration.toFixed(2)}秒 · ${shots.length}镜头 · ${(filmPlan.videoBytes/1024/1024).toFixed(1)}MB`);
}
if(process.argv.includes('--background'))await backgrounds();
if(process.argv.includes('--frames'))for(const t of [4,10,...voiceManifest.chapterStarts.map(t=>t+2.5),timeline[18].start+2,timeline[20].start+2,timeline[22].start+4,duration-4])await frameAt(t,path.join(build,`preview-${String(Math.round(t)).padStart(3,'0')}.png`));
if(process.argv.includes('--final')||process.argv.includes('--smoke'))await final();
if(!process.argv.some(x=>['--background','--frames','--final','--smoke'].includes(x)))console.log(`分镜准备完成 · ${shots.length}连续镜头 · ${captionBlocks.length}字幕段 · ${duration.toFixed(2)}秒。使用--background、--frames、--smoke、--final依次生成。`);
