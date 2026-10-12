// 只替换合成输入；字幕和讲稿保留正式拼写。
export const narrationPronunciation = {pt:{Huahai:'Ruarrái',Shenzhen:'Shen Jen',Xinjiang:'Shin Djiang'},es:{Huahai:'Juajái'},ja:{AI:'エーアイ'}};
export function narrationSpeechText(text, locale) {
  const names=narrationPronunciation[locale]||{};
  return text.replace(/\b(?:Huahai|Shenzhen|Xinjiang|AI)\b/g, name=>names[name]||name);
}
export function normalizeNarrationNames(text, locale) {
  if(locale==='es')return text.replace(/\bjuaj[aá]i\b/gi,'huahai');
  if(locale!=='pt')return text;
  return text.replace(/\b(?:ruarr[aá]i|ru[aá][\s-]+r[aá]i|hua[\s-]+rai)\b/gi,'huahai').replace(/\bshen[\s-]+jen\b/gi,'shenzhen').replace(/\bshin[\s-]+djiang\b/gi,'xinjiang');
}
