import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';

const source = readFileSync(new URL('../../huahai-corporate-site/jjxmx/index.html', import.meta.url), 'utf8');
const logic = source.slice(source.indexOf('  const fee ='), source.indexOf('  // shortcut:'));
const { fee, calculate } = runInNewContext(logic + '\n({fee,calculate})');
const base = { area:20,cycle:8,price:15,feed:9000,fcr:1.55,delta:0.1,hardware:15500,service:400,life:36,idle:0,stock:0 };

test('未认证响应泄露模型时必须触发回退', () => {
  const deployment=readFileSync(new URL('../deploy-huahai-economics.sh',import.meta.url),'utf8');
  const guard=deployment.match(/if grep -q 'data-economics' "\$backup\/unauth.html"; then rollback; fi/)[0];
  const result=spawnSync('bash',['-c',`set -e; grep() { return 0; }; rollback() { printf 'rolled-back'; exit 73; }; ${guard}; exit 0`],{encoding:'utf8'});
  assert.equal(result.status,73);
  assert.equal(result.stdout,'rolled-back');
});

test('收费按面积超额累进，跨档连续', () => {
  for (const [area, expected] of [[2,1388],[5,1535],[10,1780],[11,1819],[20,2170],[21,2199],[40,2750]]) assert.equal(fee(area), expected);
  assert.ok(Math.abs(fee(10.01)-fee(10)-0.39)<1e-8);
  for (let area=3;area<=40;area++) assert.ok(fee(area)>fee(area-1));
});
test('吨价、周期和净增重口径一致', () => {
  const result=calculate(base);
  assert.equal(result.feedPrice,4.5);
  assert.equal(result.total,17360);
  assert.equal(result.saving,40500);
  assert.equal(result.net,23140);
  assert.equal(calculate({...base,stock:100}).saving,39600);
  assert.equal(calculate({...base,idle:2}).total,21700);
});
test('售价影响收入，不重复放大节料收益', () => {
  const low=calculate({...base,price:10});
  const high=calculate({...base,price:20});
  assert.equal(high.revenue,low.revenue*2);
  assert.equal(high.saving,low.saving);
  assert.equal(high.feedCost,low.feedCost);
  const loss=calculate({...base,area:2,price:10,feed:13000,fcr:1.8});
  assert.equal(loss.feedCost,105300);
  assert.equal(loss.revenue,90000);
});
test('短寿命合约包含期内设备替换，现金和摊销分开', () => {
  const result=calculate({...base,area:2,hardware:18000,service:500,life:12});
  assert.equal(result.term,-14688);
  assert.ok(result.payback>12);
  assert.ok(result.margin<0);
});
test('页面保留参数范围、未验证效果标记与服务器认证入口', () => {
  assert.ok(source.includes('min="10" max="20"'));
  assert.ok(source.includes('area:23,cycle:10'));
  assert.ok(source.includes('尚未验证实际节料效果'));
  assert.ok(source.includes('action="/jjxmx/logout" method="post"'));
  assert.ok(!source.includes('window.openai'));
  const gate=readFileSync(new URL('../nginx/huahai-economics-gate.lua',import.meta.url),'utf8');
  assert.ok(gate.includes('HttpOnly; Secure; SameSite=Strict'));
  assert.ok(gate.includes('if count > 6 then'));
  assert.ok(gate.includes('expiry > ngx.time()'));
  assert.ok(!/password\s*=\s*["']/.test(gate));
});
