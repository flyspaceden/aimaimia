import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = await realpath(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT || 4319);
const live = process.env.LIVE_SAMPLE === '1' ? await import('./live-sample.mjs') : null;
const types = { '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg' };
createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // 本地预览：LIVE_SAMPLE=1 时用当前时间的样例代替真实数据文件；否则 /live/ 一律 404（与数据未接通时的线上一致）
    if (pathname.startsWith('/live/')) {
      const body = live && pathname === '/live/v1/index.json' ? live.sampleIndex() : live && pathname === '/live/v1/pond-yx-00.json' ? live.samplePond() : null;
      if (!body) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body)); return;
    }
    const file = await realpath(resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}`));
