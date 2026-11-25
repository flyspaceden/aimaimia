import { products, findBatch, findBase, findPond, traceCompleteness, cultureDays, complianceRate, waterSeries, metricRange, totalFeedKg, aiAnswers, metricInfo, type Product } from '../data.js';
import { routeHash, yuan, fmt, type Route, type ShopCategory, type ShopSort } from '../model.js';
import { fishArt, icon, ring } from '../svg.js';
import { esc, href, pageHead, productCard, empty } from '../ui.js';

export function filterProducts(category: ShopCategory, sort: ShopSort, query: string): Product[] {
  const q = query.trim().normalize('NFKC').toLowerCase();
  const list = products.filter(p => {
    const b = findBatch(p.batchCode)!;
    const text = (p.name + p.sub + p.spec + (findBase(b.baseId)?.region ?? '') + b.species).normalize('NFKC').toLowerCase();
    return (category === 'all' || p.category === category) && text.includes(q);
  });
  if (sort === 'price-asc') list.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') list.sort((a, b) => b.price - a.price);
  if (sort === 'sold') list.sort((a, b) => b.sold - a.sold);
  return list;
}

export function shopPage(r: Route): string {
  const list = filterProducts(r.category, r.sort, r.query);
  const cats: [ShopCategory, string][] = [['all', '全部'], ['鱼类', '鱼类'], ['虾类', '虾类']];
  const sorts: [ShopSort, string][] = [['default', '综合'], ['sold', '销量'], ['price-asc', '价格从低到高'], ['price-desc', '价格从高到低']];
  return `${pageHead('买好货 · C 端', '每一件都能查到来处', '所有商品绑定养殖批次，点开即可看到公司、基地、塘口和养殖数据。')}
  <div class="toolbar card">
    <form class="search" id="shop-search" role="search"><label class="sr-only" for="shop-q">搜索商品</label>${icon('search')}
      <input id="shop-q" maxlength="100" value="${esc(r.query)}" placeholder="搜索品种或产地，如 金鲳、湛江"><button class="btn btn-primary" type="submit">搜索</button></form>
    <div class="seg" role="group" aria-label="品类">${cats.map(([v, l]) => `<a class="seg-i" href="${routeHash({ ...r, name: 'shop', category: v })}" aria-current="${r.category === v}">${l}</a>`).join('')}</div>
    <label class="select">排序<select id="shop-sort">${sorts.map(([v, l]) => `<option value="${v}"${r.sort === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
  </div>
  <p class="muted sm" role="status">共 ${list.length} 件演示商品</p>
  ${list.length ? `<div class="pgrid">${list.map(productCard).join('')}</div>` : `<div class="empty card"><p>没有符合条件的商品。</p><a class="btn" href="${href('shop')}">清除筛选</a></div>`}`;
}

export function productPage(id: string): string {
  const p = products.find(x => x.id === id);
  if (!p) return empty('没有找到这件商品', '商品可能已下架，或链接有误。', href('shop'), '返回买好货');
  const b = findBatch(p.batchCode)!, base = findBase(b.baseId)!, pond = findPond(b.pondId)!;
  const water = base.water;
  const doRate = complianceRate(waterSeries(b, 'do'), metricRange('do', water));
  const drug = b.labs.find(l => l.category.includes('渔药'))!;
  const ai = aiAnswers(b);
  return `<nav class="crumbs" aria-label="位置"><a href="${href('home')}">首页</a><span>/</span><a href="${href('shop')}">买好货</a><span>/</span><span aria-current="page">${esc(p.name)}</span></nav>
  <section class="pd">
    <div class="pd-art card">${fishArt(p.art, p.name)}<span class="pd-badge">${icon('shield', 'ic ic-xs')}一品一码 · 可溯源</span></div>
    <div class="pd-info">
      <div class="kicker">${esc(p.sub)} · ${cultureDays(b)} 天</div>
      <h1 tabindex="-1" data-heading>${esc(p.name)}</h1>
      <p class="muted">${esc(p.spec)}</p>
      <div class="pd-price"><span class="price price-lg">¥${yuan(p.price)}</span><span class="muted"> / ${esc(p.unit)}</span><span class="tag tag-demo">演示价</span></div>
      <div class="chips">${p.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}<span class="chip">已售 ${fmt(p.sold)}</span><span class="chip">库存 ${p.stock}</span></div>
      <div class="qty-row"><span class="muted sm">数量</span>
        <div class="stepper"><button class="btn btn-icon" data-step="-1" aria-label="减少数量">${icon('minus')}</button><input id="pd-qty" type="number" inputmode="numeric" min="1" max="${p.stock}" value="1" aria-label="购买数量"><button class="btn btn-icon" data-step="1" aria-label="增加数量">${icon('plus')}</button></div></div>
      <div class="pd-actions"><button class="btn btn-ghost btn-lg" data-add-qty="${p.id}">${icon('cart')}加入购物车</button><button class="btn btn-primary btn-lg" data-buy="${p.id}">立即购买</button></div>
      <p class="muted xs">演示站不收款、不发货；满 99 元包邮的规则仅作展示。</p>
    </div>
  </section>

  <section class="section trace-sum card glass">
    <div class="sec-head"><div><div class="kicker">${icon('route', 'ic ic-xs')} 这条鱼从哪里来</div><h2>批次 <span class="mono">${b.code}</span></h2></div>
      <a class="btn btn-primary" href="${href('trace', b.code)}">查看完整溯源档案 ${icon('arrow', 'ic ic-xs')}</a></div>
    <ol class="path">
      <li>${icon('building', 'ic ic-sm')}<span><small>公司</small>华海农科（演示）</span></li>
      <li><a href="${href('base', base.id)}">${icon('pin', 'ic ic-sm')}<span><small>基地</small>${esc(base.name)}</span></a></li>
      <li>${icon('wave', 'ic ic-sm')}<span><small>塘口</small>${esc(pond.name)} · ${pond.areaMu} 亩</span></li>
      <li>${icon('hash', 'ic ic-sm')}<span><small>批次</small>${esc(b.code)}</span></li>
    </ol>
    <div class="ai-box">${icon('spark')}<div><b>AI 解读</b><p>${esc(ai[2]!.a)}</p></div></div>
    <div class="kpis">
      <div class="kpi">${ring(traceCompleteness(b), '#34d399', '溯源完整度')}<span>溯源完整度</span></div>
      <div class="kpi">${ring(doRate, metricInfo.do.color, '溶氧达标率')}<span>溶氧达标率</span></div>
      <div class="kpi"><b class="mono">${cultureDays(b)}</b><span>养殖天数</span></div>
      <div class="kpi"><b class="mono">${(totalFeedKg(b) / 1000).toFixed(1)} t</b><span>累计投喂</span></div>
      <div class="kpi"><b class="mono">${drug.items.filter(i => i.pass).length}/${drug.items.length}</b><span>检测合格项</span></div>
      <div class="kpi"><b class="mono">${b.survival}%</b><span>成活率</span></div>
    </div>
    <div class="qa-row">${ai.slice(0, 4).map((x, i) => `<button class="chip chip-q" data-ask="${i}" data-batch="${b.code}">${icon('chat', 'ic ic-xs')}${esc(x.q)}</button>`).join('')}</div>
  </section>`;
}
