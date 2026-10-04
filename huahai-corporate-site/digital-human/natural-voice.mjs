import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API = 'https://dashscope.aliyuncs.com/api/v1';
export const ALIGNMENT_VERSION = 'paragraph-word-anchors-v2';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function writeJsonAtomic(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, file);
}
function headers(extra = {}) {
  if (!process.env.DASHSCOPE_API_KEY) throw new Error('自然配音需要在进程环境配置DASHSCOPE_API_KEY');
  return { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json', ...extra };
}
function mediaUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.endsWith('.aliyuncs.com') || (url.port && url.port !== '443')) throw new Error('语音服务返回了非受信素材地址');
  url.protocol = 'https:';
  return url.toString();
}
async function providerJson(url, init, timeoutMs = 120000) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const data = await response.json();
  if (!response.ok || (data.status_code && data.status_code !== 200)) throw new Error(`语音服务失败：HTTP ${response.status} / ${String(data.code || 'unknown').replace(/[^\w.-]/g, '')}`);
  return data;
}
export async function synthesize(text, config, wavPath) {
  if (!text.trim() || Array.from(text).length > 600) throw new Error('自然配音每段正文必须为1至600字符');
  const data = await providerJson(`${API}/services/aigc/multimodal-generation/generation`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ model: config.model, input: { text, voice: config.voice, language_type: config.language }, ...(config.model.includes('-instruct-') ? {parameters: { instructions: config.instructions, optimize_instructions: config.optimizeInstructions }} : {}) })
  }, config.model.includes('-vc-') ? 360000 : 120000);
  if (!data.output?.audio?.url) throw new Error('语音服务未返回完整音频');
  const audioUrl = mediaUrl(data.output.audio.url);
  // 下载本任务生成的音频；不向OSS转发模型凭据，不在日志或提交文件写签名URL。
  let bytes;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const audio = await fetch(audioUrl, { signal: AbortSignal.timeout(180000), redirect: 'error' });
      if (!audio.ok) throw new Error(`音频下载失败：HTTP ${audio.status}`);
      bytes = Buffer.from(await audio.arrayBuffer()); break;
    } catch (error) { if (attempt === 2) throw error; }
  }
  if (bytes.length < 1024 || bytes.length > 25 * 1024 * 1024) throw new Error('语音文件大小异常');
  fs.writeFileSync(wavPath, bytes);
  return { audioUrl, requestId: data.request_id, usage: data.usage };
}
export async function recognize(audioUrl, config, checkpointFile) {
  let checkpoint = checkpointFile && fs.existsSync(checkpointFile) ? JSON.parse(fs.readFileSync(checkpointFile, 'utf8')) : null;
  if (checkpoint?.status === 'SUCCEEDED') return checkpoint.recognition;
  let taskId = checkpoint?.taskId;
  if (!taskId) {
    if (checkpoint || !audioUrl) throw new Error('已有配音或ASR未知提交，禁止自动重复合成/提交；保留素材后核查原任务');
    if (checkpointFile) {
      try { fs.mkdirSync(checkpointFile + '.submit-lock'); } catch (error) { if (error.code === 'EEXIST') throw new Error('ASR已有提交锁，禁止重复创建'); throw error; }
      writeJsonAtomic(checkpointFile, { status: 'SUBMITTING' });
    }
    const submitted = await providerJson(`${API}/services/audio/asr/transcription`, {
      method: 'POST', headers: headers({ 'X-DashScope-Async': 'enable' }),
      body: JSON.stringify({ model: config.alignmentModel, input: { file_urls: [mediaUrl(audioUrl)] }, parameters: { channel_id: [0], language_hints: ['zh', 'en'], timestamp_alignment_enabled: true } })
    });
    taskId = submitted.output?.task_id;
    checkpoint = { status: 'PENDING', taskId, requestId: submitted.request_id };
    if (checkpointFile) writeJsonAtomic(checkpointFile, checkpoint);
  }
  if (!/^[\w-]{20,80}$/.test(taskId || '')) throw new Error('语音对齐未返回有效任务');
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const data = await providerJson(`${API}/tasks/${taskId}`, { headers: headers() });
    const status = data.output?.task_status;
    if (status === 'FAILED' || status === 'CANCELED') throw new Error('语音时间戳任务失败');
    if (status === 'SUCCEEDED') {
      const result = data.output.results?.find(item => item.subtask_status === 'SUCCEEDED');
      if (!result?.transcription_url) throw new Error('语音时间戳子任务未成功');
      const response = await fetch(mediaUrl(result.transcription_url), { signal: AbortSignal.timeout(30000), redirect: 'error' });
      if (!response.ok) throw new Error('时间戳文件下载失败');
      const transcription = await response.json();
      const recognition = { transcripts: transcription.transcripts, requestId: checkpoint.requestId };
      if (checkpointFile) writeJsonAtomic(checkpointFile, { ...checkpoint, status: 'SUCCEEDED', recognition });
      return recognition;
    }
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  throw new Error('语音时间戳任务超时');
}
const digits = { 零:'0', 〇:'0', 一:'1', 二:'2', 两:'2', 三:'3', 四:'4', 五:'5', 六:'6', 七:'7', 八:'8', 九:'9' };
export function normalize(text) {
  return Array.from(text.toLowerCase().replace(/人工智能/g, 'ai').replace(/[\s\p{P}\p{S}]/gu, '')).map(c => digits[c] || c).join('');
}
export function alignSentences(texts, recognition, minimumSimilarity = .88) {
  const spoken = [];
  for (const transcript of recognition.transcripts || []) for (const sentence of transcript.sentences || []) for (const word of sentence.words || []) {
    const chars = Array.from(normalize(word.text || ''));
    const begin = word.begin_time / 1000, end = word.end_time / 1000;
    if (!Number.isFinite(begin) || !Number.isFinite(end) || end < begin) throw new Error('无效语音时间戳');
    chars.forEach((char, i) => spoken.push({char, start:begin+(end-begin)*i/chars.length, end:begin+(end-begin)*(i+1)/chars.length}));
  }
  const source = texts.map(text => Array.from(normalize(text)));
  const wanted = source.flat(), heard = spoken.map(x => x.char), n = wanted.length, m = heard.length;
  if (!n || !m) throw new Error('对齐正文或语音识别为空');
  const width = m + 1, dp = new Uint16Array((n + 1) * width);
  for (let i=0;i<=n;i++) dp[i*width]=i;
  for (let j=0;j<=m;j++) dp[j]=j;
  for (let i=1;i<=n;i++) for (let j=1;j<=m;j++) dp[i*width+j]=Math.min(dp[(i-1)*width+j-1]+(wanted[i-1]===heard[j-1]?0:1),dp[(i-1)*width+j]+1,dp[i*width+j-1]+1);
  const similarity = 1 - dp[n*width+m]/Math.max(n,m);
  if (similarity < minimumSimilarity) throw new Error(`配音正文匹配度过低：${similarity.toFixed(3)}，需要复核朗读内容`);
  const mapping = Array(n).fill(null); let i=n,j=m;
  while(i||j) {
    if(i&&j&&dp[i*width+j]===dp[(i-1)*width+j-1]+(wanted[i-1]===heard[j-1]?0:1)){mapping[i-1]=j-1;i--;j--;}
    else if(i&&dp[i*width+j]===dp[(i-1)*width+j]+1)i--;else j--;
  }
  let cursor=0, lastEnd=0;
  const sentenceStats = [];
  const cues=texts.map((text,index)=>{
    const sentenceStart = cursor;
    const mapped = mapping.slice(cursor,cursor+source[index].length);
    const anchors=mapped.filter(x=>x!==null); cursor+=source[index].length;
    if(!anchors.length)throw new Error('整句缺少语音对齐锚点');
    const start=Math.max(lastEnd,spoken[anchors[0]].start),end=spoken[anchors.at(-1)].end;
    if(end<=start)throw new Error('字幕边界无效');
    const exactCount = mapped.reduce((sum, anchor, offset) => sum + (anchor !== null && heard[anchor] === wanted[sentenceStart + offset] ? 1 : 0), 0);
    const coverage = anchors.length / source[index].length, exactRate = exactCount / source[index].length, charsPerSecond = source[index].length / (end - start);
    if (coverage < .85 || exactRate < .8 || charsPerSecond > 16) throw new Error(`第${index+1}句配音可能漏读或误配：覆盖${coverage.toFixed(3)}，匹配${exactRate.toFixed(3)}，语速${charsPerSecond.toFixed(1)}字/秒`);
    source[index].forEach((char, offset) => { if (['不','未'].includes(char) && (mapped[offset] === null || heard[mapped[offset]] !== char)) throw new Error(`第${index+1}句否定/边界用词未匹配，需要核对配音`); });
    sentenceStats.push({index,coverage,exactRate,charsPerSecond});
    lastEnd=end; return{start,end,text};
  });
  return { cues, similarity, sentenceStats, recognizedText: heard.join(''), duration: spoken.at(-1).end };
}
async function synthesizePart(texts, config, cacheDir, convertWav, getDuration) {
  const text=texts.join('\n\n');
  const fingerprint=hash(JSON.stringify({text,config,alignmentVersion:ALIGNMENT_VERSION}));
  const base=path.join(cacheDir,`natural-${fingerprint.slice(0,20)}`), wav=`${base}.wav`, metadata=`${base}.json`;
  if(fs.existsSync(wav)&&fs.existsSync(metadata)){
    const cached=JSON.parse(fs.readFileSync(metadata,'utf8'));
    if(cached.fingerprint===fingerprint&&cached.wavHash===hash(fs.readFileSync(wav))) return{wav,...cached};
  }
  const raw=`${base}.provider.wav`, receiptFile=`${base}.tts-receipt.json`, checkpointFile=`${base}.asr-checkpoint.json`;
  let receipt=fs.existsSync(receiptFile)?JSON.parse(fs.readFileSync(receiptFile,'utf8')):null, generated;
  if(!fs.existsSync(raw)){
    try{fs.mkdirSync(base+'.tts-submit-lock');}catch(error){if(error.code==='EEXIST')throw new Error('配音已有提交锁或未知结果，禁止自动重做付费TTS');throw error;}
    writeJsonAtomic(receiptFile,{fingerprint,status:'SUBMITTING'});
    generated=await synthesize(text,config,raw);
    receipt={fingerprint,status:'SUCCEEDED',requestId:generated.requestId,usage:generated.usage,rawHash:hash(fs.readFileSync(raw))};
    writeJsonAtomic(receiptFile,receipt);
  }else if(!receipt||receipt.status!=='SUCCEEDED'||receipt.rawHash!==hash(fs.readFileSync(raw)))throw new Error('已有未完成配音缓存，禁止自动重复TTS；保留音频后核查原任务');
  if(!fs.existsSync(wav))await convertWav(raw,wav);
  const recognition=await recognize(generated?.audioUrl||null,config,checkpointFile);
  const alignment=alignSentences(texts,recognition,config.minimumAlignmentSimilarity);
  const duration=getDuration(wav);
  const record={fingerprint,alignmentVersion:ALIGNMENT_VERSION,wavHash:hash(fs.readFileSync(wav)),model:config.model,voice:config.voice,ttsRequestId:receipt.requestId,asrRequestId:recognition.requestId,cues:alignment.cues,similarity:alignment.similarity,sentenceStats:alignment.sentenceStats,recognizedText:alignment.recognizedText,duration,recognition,usage:receipt.usage};
  writeJsonAtomic(metadata,record);
  return{wav,...record};
}
export function splitParagraphs(texts, maxBytes = 480) {
  const groups=[];let current=[];
  for(const text of texts){
    if(Buffer.byteLength(text,'utf8')>maxBytes)throw new Error('单句超过配音保守长度预算，需要人工分句');
    if(current.length&&Buffer.byteLength([...current,text].join('\n\n'),'utf8')>maxBytes){groups.push(current);current=[];}
    current.push(text);
  }
  if(current.length)groups.push(current);
  return groups;
}
export async function synthesizeChapter(texts, config, cacheDir, convertWav, getDuration) {
  const groups=splitParagraphs(texts,config.maxParagraphBytes),parts=[],cues=[];
  let duration=0,similarity=1;
  for(let index=0;index<groups.length;index++){
    const part=await synthesizePart(groups[index],config,cacheDir,convertWav,getDuration);
    parts.push(part);cues.push(...part.cues.map(cue=>({...cue,start:cue.start+duration,end:cue.end+duration})));
    similarity=Math.min(similarity,part.similarity);
    duration+=part.duration+(index<groups.length-1?config.paragraphPauseSeconds:0);
  }
  return {parts,cues,duration,similarity};
}
