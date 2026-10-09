import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProducts, parseRoute, routeHash, escapeHtml, demands } from '../dist/assets/model.js';

test('搜索将品类和产地同时作为条件，缺货品类保持空态', () => {
  assert.deepEqual(filterProducts('水产', '茂名').map(p => p.id), ['tilapia']);
  assert.equal(filterProducts('果蔬', '茂名').length, 0);
  assert.equal(filterProducts('畜禽', '').length, 0);
  assert.equal(filterProducts('all', '  ' ).length, 3);
});
test('商品规格搜索接受全角字符，不修改原始商品内容', () => {
  assert.equal(filterProducts('水产', '５００').length, 1);
});
test('分享地址完整恢复筛选和工作台状态', () => {
  const route = { page: 'work', category: '水产', query: '茂名 & 罗非鱼', status: 'quoted' };
  assert.deepEqual(parseRoute(routeHash(route)), route);
});
test('未知或异常地址使用安全默认值并限制搜索长度', () => {
  assert.deepEqual(parseRoute('#__proto__?category=invalid&status=paid'), { page: 'market', category: 'all', query: '', status: 'ongoing' });
  assert.equal(parseRoute('#market?q=' + 'a'.repeat(300)).query.length, 100);
  assert.doesNotThrow(() => parseRoute('#market?q=%E0%A4%A'));
});
test('文本转义保留用户文本含义，不把字符串作为 HTML 执行', () => {
  assert.equal(escapeHtml('<img src="x" onerror=alert(1)> & \'quoted\''), '&lt;img src=&quot;x&quot; onerror=alert(1)&gt; &amp; &#39;quoted&#39;');
});
test('不同采购需求保留各自规格、目的地和采购数量', () => {
  assert.match(demands[0].spec, /500/);
  assert.equal(demands[0].destination, '广州');
  assert.match(demands[1].name, /番茄/);
  assert.equal(demands[1].destination, '深圳');
  assert.equal(demands[1].quantity, '800 公斤');
});
