import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { alignSentences, normalize, splitParagraphs, recognize, synthesizeChapter, ALIGNMENT_VERSION } from './natural-voice.mjs';
function recognized(texts) {
  let t=0;
  const sentences=texts.map(text=>({words:Array.from(normalize(text)).map(char=>{const word={text:char,begin_time:t,end_time:t+160};t+=160;return word;})}));
  return {transcripts:[{sentences}]};
}
test('保留原稿句边界，数字年份与人工智能读法可对应',()=>{
  const texts=['公司成立于二零一七年。','AI帮助连接产地和消费者。'];
  const result=alignSentences(texts,recognized(['公司成立于2017年。','人工智能帮助连接产地和消费者。']));
  assert.equal(result.cues.length,2);assert.equal(result.similarity,1);assert(result.cues[1].start>=result.cues[0].end);
});
test('整章相似度很高时也拒绝漏掉的完整句子',()=>{
  const texts=['我们连接真实生产与消费需求。'.repeat(12),'这些方向需要结合具体原料、研发证据、食品标准和相应资质开展。','我们希望建立可靠的农业服务体系。'.repeat(12)];
  assert.throws(()=>alignSentences(texts,recognized([texts[0],texts[2]])),/漏读|锚点|边界/);
});
test('拒绝关键否定词漏读，避免改变食品边界含义',()=>{
  const text='普通食品不能被宣称可以治疗疾病，研发需要证据与资质。';
  assert.throws(()=>alignSentences([text],recognized([text.replace('不能','能')])),/否定\/边界/);
});
test('拒绝明显不可能的字幕字符语速',()=>{
  const text='这份公司介绍需要清楚说明产品能力与运行验收的区别。';
  const rec=recognized([text]);rec.transcripts[0].sentences[0].words.forEach(word=>{word.begin_time/=100;word.end_time/=100;});
  assert.throws(()=>alignSentences([text],rec),/语速/);
});
test('段落在句边界分组，UTF8预算内且没有遗漏重排',()=>{
  const texts=['先了解公司战略与理念。','再了解AI技术与电商产品。','最后介绍全产销链与大健康生态。'];
  const groups=splitParagraphs(texts,75);assert.deepEqual(groups.flat(),texts);assert(groups.every(group=>Buffer.byteLength(group.join('\n\n'))<=75));
});
test('已有配音但缺少ASR任务时拒绝重新付费TTS',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'huahai-voice-guard-'));
  const texts=['我们认真对待每一份农产品。'],config={model:'fixture',voice:'fixture',maxParagraphBytes:480,paragraphPauseSeconds:.2,minimumAlignmentSimilarity:.88};
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({text:texts.join('\n\n'),config,alignmentVersion:ALIGNMENT_VERSION})).digest('hex');
  const base=path.join(dir,'natural-'+fingerprint.slice(0,20)),raw=Buffer.from('fixture PCM');
  fs.writeFileSync(base+'.provider.wav',raw);fs.writeFileSync(base+'.wav',raw);fs.writeFileSync(base+'.tts-receipt.json',JSON.stringify({fingerprint,status:'SUCCEEDED',rawHash:crypto.createHash('sha256').update(raw).digest('hex')}));
  const old=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw new Error('禁止网络调用');};
  try{await assert.rejects(()=>synthesizeChapter(texts,config,dir,async()=>{},()=>2),/已有配音|禁止自动/);assert.equal(requests,0);}finally{globalThis.fetch=old;fs.rmSync(dir,{recursive:true,force:true});}
});
test('已完成ASR检查点不再创建服务任务',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'huahai-asr-guard-')),file=path.join(dir,'checkpoint.json'),recognition=recognized(['华海农科。']);
  fs.writeFileSync(file,JSON.stringify({status:'SUCCEEDED',recognition}));
  const old=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw new Error('禁止网络调用');};
  try{assert.deepEqual(await recognize(null,{},file),recognition);assert.equal(requests,0);}finally{globalThis.fetch=old;fs.rmSync(dir,{recursive:true,force:true});}
});
