/** 独立门户演示数据；不读取爱买买账户、库存、价格或订单。 */
export type Page = 'market' | 'demand' | 'trace' | 'work';
export type Category = 'all' | '水产' | '果蔬' | '畜禽';
export type OrderStatus = 'ongoing' | 'quoted' | 'complete';
export interface Route { page: Page; category: Category; query: string; status: OrderStatus }
export interface Product {
  id: string; name: string; place: string; category: Exclude<Category, 'all'>;
  spec: string; price: string; qty: string; timing: string; mode: string; evidence: string[];
}
export const products: readonly Product[] = [
  { id: 'tilapia', name: '鲜活罗非鱼', place: '广东 · 茂名', category: '水产', spec: '500–750 克 / 尾', price: '12.80', qty: '5,000 公斤', timing: '现货供应', mode: '起捕时间面议', evidence: ['产地档案示例', '检测资料示例'] },
  { id: 'shrimp', name: '南美白对虾', place: '广东 · 阳江', category: '水产', spec: '40–50 尾 / 公斤', price: '38.00', qty: '2,000 公斤', timing: '预定供应', mode: '交付日期协商', evidence: ['产地档案示例', '生产日志示例'] },
  { id: 'tomato', name: '当季鲜番茄', place: '广东 · 阳春', category: '果蔬', spec: '一级 / 分级包装', price: '4.60', qty: '3,000 公斤', timing: '现货供应', mode: '采摘后发货', evidence: ['产地档案示例', '采摘记录示例'] },
];
export const demands = [
  { name: '鲜活罗非鱼 / 连锁餐饮直供', spec: '500–750 克 / 尾', quantity: '2,000 公斤 / 周', destination: '广州', delivery: '每周三，起止周期由双方约定', requirement: '提供对应批次检测资料，报价注明鲜活运输、损耗与验收条件。' },
  { name: '当季番茄 / 商超采购', spec: '一级 / 分级包装', quantity: '800 公斤', destination: '深圳', delivery: '双方约定到货日期', requirement: '明确采摘日期、包装标准、运输费用与损耗验收要求。' },
] as const;
export const pageTitles: Record<Page, string> = { market: '货源大厅', demand: '采购需求', trace: '品质溯源', work: '交易工作台' };
export function isPage(value: string): value is Page { return Object.hasOwn(pageTitles, value); }
export function isCategory(value: string): value is Category { return ['all', '水产', '果蔬', '畜禽'].includes(value); }
export function isStatus(value: string): value is OrderStatus { return ['ongoing', 'quoted', 'complete'].includes(value); }
export function parseRoute(hash: string): Route {
  const [name = '', query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const category = params.get('category') || 'all';
  const status = params.get('status') || 'ongoing';
  return { page: isPage(name) ? name : 'market', category: isCategory(category) ? category : 'all', query: (params.get('q') || '').trim().slice(0, 100), status: isStatus(status) ? status : 'ongoing' };
}
export function routeHash(route: Route): string {
  const params = new URLSearchParams();
  if (route.category !== 'all') params.set('category', route.category);
  if (route.query) params.set('q', route.query);
  if (route.status !== 'ongoing') params.set('status', route.status);
  return '#' + route.page + (params.size ? '?' + params.toString() : '');
}
export function filterProducts(category: Category, query: string): Product[] {
  const normalized = query.trim().normalize('NFKC').toLowerCase();
  return products.filter(item => (category === 'all' || item.category === category) && (item.name + item.place + item.spec).normalize('NFKC').toLowerCase().includes(normalized));
}
export function escapeHtml(value: string): string {
  const replacements: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, char => replacements[char]!);
}
