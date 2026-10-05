import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
// 首期只预览静态公司讲解，不开放模型代理。
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),port=Number(process.env.HUAHAI_DIGITAL_HUMAN_PORT||8768);
const pages=new Set(['index.html','about.html','business.html','technology.html','industry.html','contact.html','privacy.html','terms.html']);
const digital=new Set(['index.html','style.css','app.js','faq.js','visuals.js','knowledge.json','character-config.json','voice-config.json','assets/rhino-sprites.png']);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg','.mp4':'video/mp4','.srt':'text/plain; charset=utf-8','.vtt':'text/vtt; charset=utf-8'};
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid preview port');
http.createServer((req,res)=>{
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403);return res.end();}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  let name;try{name=decodeURIComponent(new URL(req.url,`http://${req.headers.host}`).pathname).slice(1);}catch{res.writeHead(400);return res.end();}
  if(name.split('/').some(part=>part==='..'||part==='.'||part.includes('\\')||part.includes('\0'))){res.writeHead(404);return res.end();}
  if(name==='digital-human'){res.writeHead(302,{Location:'/digital-human/'});return res.end();}
  if(!name||name==='digital-human/')name+='index.html';
  const child=name.startsWith('digital-human/')?name.slice(14):null;
  const allowed=pages.has(name)||(name.startsWith('assets/')&&['.css','.js','.json','.jpg','.png','.webp'].includes(path.extname(name)))||(child&&(digital.has(child)||/^media\/[a-z0-9-]+\.(mp3|mp4|png|json|srt|vtt)$/.test(child)));
  const file=path.resolve(root,name);
  if(!allowed||!file.startsWith(root+path.sep)){res.writeHead(404);return res.end();}
  let stat;try{stat=fs.statSync(file);if(!stat.isFile())throw new Error();}catch{res.writeHead(404);return res.end();}
  const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
  let start=0,end=stat.size-1,status=200;
  if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match||(!match[1]&&!match[2])){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}if(match[1]){start=Number(match[1]);end=match[2]?Number(match[2]):end;}else start=Math.max(0,stat.size-Number(match[2]));if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}end=Math.min(end,stat.size-1);status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;}
  headers['Content-Length']=end-start+1;res.writeHead(status,headers);if(req.method==='HEAD')return res.end();const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
}).listen(port,'127.0.0.1',()=>console.log(`华海官网本地预览：http://127.0.0.1:${port}/ · 数字讲解：/digital-human/`));
