import test from 'node:test';import assert from 'node:assert/strict';
import {narrationSpeechText,normalizeNarrationNames} from './narration-pronunciation.mjs';
test('Portuguese synthesis spells names phonetically without altering source copy or unrelated words',()=>{
 const source='Huahai AgriTech, de Shenzhen, não faz diagnósticos. Xinjiang e Aimaimai.';
 assert.equal(narrationSpeechText(source,'pt'),'Ruarrái AgriTech, de Shen Jen, não faz diagnósticos. Shin Djiang e Aimaimai.');
 assert.equal(source,'Huahai AgriTech, de Shenzhen, não faz diagnósticos. Xinjiang e Aimaimai.');
 assert.equal(narrationSpeechText('HuahaiX e ShenzhenX','pt'),'HuahaiX e ShenzhenX');
 assert.equal(normalizeNarrationNames('Ruarrái, Ruá Rái, Hua Rai e Shen Jen; Shin Djiang, não.','pt'),'huahai, huahai, huahai e shenzhen; xinjiang, não.');
});
test('Spanish only changes the brand; Japanese AI reading is explicit and English stays intact',()=>{
 const source='Huahai AgriTech, Shenzhen, Xinjiang; no diagnósticos.';
 assert.equal(narrationSpeechText(source,'es'),'Juajái AgriTech, Shenzhen, Xinjiang; no diagnósticos.');
 assert.equal(normalizeNarrationNames('Juajái AgriTech, no.','es'),'huahai AgriTech, no.');
 for(const locale of ['en','ja'])assert.equal(narrationSpeechText(source,locale),source);
 assert.equal(narrationSpeechText('AIは補助し、AIMMは変わりません。','ja'),'エーアイは補助し、AIMMは変わりません。');
 assert.equal(narrationSpeechText('AI helps people.','en'),'AI helps people.');
});
