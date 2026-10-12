import fs from 'node:fs';import path from 'node:path';

// 只构建官网公开资源；制作脚本、原始场景、付费缓存与本地代理不进入Web目录。
const source=path.resolve('huahai-corporate-site'),target=path.join(source,'digital-human/build/public-site');
fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(target,{recursive:true});
for(const name of fs.readdirSync(source)) if(name.endsWith('.html')) fs.copyFileSync(path.join(source,name),path.join(target,name));
fs.cpSync(path.join(source,'assets'),path.join(target,'assets'),{recursive:true});
const digital=path.join(target,'digital-human');fs.mkdirSync(digital,{recursive:true});
const names=['index.html','style.css','app.js','visuals.js','knowledge.json','character-config.json','voice-config.json','faq.js','assets/rhino-sprites.png','media/manifest.json','media/published-media.json','media/huahai-brand-film-v2.srt','media/huahai-brand-film-v2.vtt','media/brand-film-v2-cover.png'];
for(const name of names){const src=path.join(source,'digital-human',name),dest=path.join(digital,name);if(!fs.statSync(src).isFile())throw new Error('Missing public guide resource: '+name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(src,dest);}
for(const locale of ['en','es','pt','ja'])for(const name of ['knowledge.json','promo-knowledge.json','ui.json','translation-manifest.json','voice-config.json','media-manifest.json','published-media.json']){const src=path.join(source,'digital-human/locales',locale,name),dest=path.join(digital,'locales',locale,name);if(!fs.statSync(src).isFile())throw new Error('Missing locale resource');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(src,dest);}
for(const locale of ['en','es','pt','ja'])for(const name of ['huahai-brand-film-'+locale+'.srt','huahai-brand-film-'+locale+'.vtt','brand-film-'+locale+'-cover.png'])fs.copyFileSync(path.join(source,'digital-human/media',name),path.join(digital,'media',name));
const sha=process.env.RELEASE_SHA;if(sha&&!/^[a-f0-9]{40}$/.test(sha))throw new Error('Invalid release SHA');
fs.writeFileSync(path.join(target,'release-sha.txt'),(sha||'local-preview')+'\n');
console.log('Curated corporate site ready: '+path.relative(process.cwd(),target));
