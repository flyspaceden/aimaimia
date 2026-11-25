/** 路由与通用工具。路由只承载页面、对象 ID 与公开筛选词，不放任何表单内容。 */
export type RouteName = 'home' | 'shop' | 'product' | 'trace' | 'bases' | 'base' | 'source' | 'work' | 'cart' | 'checkout' | 'order';
export type ShopCategory = 'all' | '鱼类' | '虾类';
export type ShopSort = 'default' | 'price-asc' | 'price-desc' | 'sold';
export type WorkStatus = 'ongoing' | 'quoted' | 'complete';
export interface Route { name: RouteName; id: string; category: ShopCategory; sort: ShopSort; query: string; status: WorkStatus }

export const routeTitles: Record<RouteName, string> = {
  home: '首页', shop: '买好货', product: '商品详情', trace: '溯源档案', bases: '产地基地', base: '基地详情',
  source: '产地采购', work: '交易工作台', cart: '购物车', checkout: '确认订单', order: '订单详情',
};
const names = Object.keys(routeTitles) as RouteName[];
export const isRouteName = (v: string): v is RouteName => (names as string[]).includes(v);
export const isCategory = (v: string): v is ShopCategory => ['all', '鱼类', '虾类'].includes(v);
export const isSort = (v: string): v is ShopSort => ['default', 'price-asc', 'price-desc', 'sold'].includes(v);
export const isStatus = (v: string): v is WorkStatus => ['ongoing', 'quoted', 'complete'].includes(v);

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [rawName = '', ...rest] = path.split('/');
  const params = new URLSearchParams(query);
  const category = params.get('category') || 'all';
  const sort = params.get('sort') || 'default';
  const status = params.get('status') || 'ongoing';
  let id = '';
  try { id = decodeURIComponent(rest.join('/')).trim().slice(0, 60); } catch { id = ''; }
  return {
    name: isRouteName(rawName) ? rawName : 'home', id: isRouteName(rawName) ? id : '',
    category: isCategory(category) ? category : 'all', sort: isSort(sort) ? sort : 'default',
    query: (params.get('q') || '').trim().slice(0, 100), status: isStatus(status) ? status : 'ongoing',
  };
}
export function routeHash(route: Pick<Route, 'name'> & Partial<Route>): string {
  const params = new URLSearchParams();
  if (route.name === 'shop') {
    if (route.category && route.category !== 'all') params.set('category', route.category);
    if (route.sort && route.sort !== 'default') params.set('sort', route.sort);
    if (route.query) params.set('q', route.query);
  }
  if (route.name === 'work' && route.status && route.status !== 'ongoing') params.set('status', route.status);
  const path = route.id ? `${route.name}/${encodeURIComponent(route.id)}` : route.name;
  const qs = params.toString();
  return '#' + path + (qs ? '?' + qs : '');
}
export function escapeHtml(value: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, c => map[c]!);
}
export const yuan = (v: number) => v.toFixed(2);
export const fmt = (v: number) => v.toLocaleString('zh-CN');
