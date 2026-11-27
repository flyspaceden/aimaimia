import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const conf = readFileSync(new URL('../deploy/market.huahainongke.com.conf', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
test('nginx 与页面的安全策略一致，且只多放开本站请求', () => {
  const page = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  const site = conf.match(/add_header Content-Security-Policy "(default-src 'self'[^"]+)"/)[1];
  assert.equal(site, page + "; frame-ancestors 'none'");
  assert.match(page, /connect-src 'self'/);
});
test('/live/ 只提供两种文件名，其他一律 404', () => {
  assert.match(conf, /location ~ \^\/live\/v1\/\(index\|pond-\[a-z0-9\]\+-\[a-z0-9\]\+\)\\\.json\$ \{\s+alias \/var\/www\/huahai-market-live\/v1\/\$1\.json;/);
  assert.match(conf, /location \/live\/ \{ return 404; \}/);
  assert.equal(conf.includes('location ^~ /live/'), false);
  assert.ok(conf.indexOf('location ~ ^/live/v1/') < conf.lastIndexOf('location / {'));
});
