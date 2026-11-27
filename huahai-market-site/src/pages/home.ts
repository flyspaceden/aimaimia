import { aiAnswers, bases, batches, company, platformStats, products, pondsOfBase, findBatch } from '../data.js';
import { fmt } from '../model.js';
import { icon } from '../svg.js';
import { demoTag, esc, href, productCard } from '../ui.js';

/** 首页右侧的演示面板（取不到真实数据时显示）。 */
export function demoHeroPanel(samples = platformStats.samplesToday): string {
  return `<div class="hero-panel card glass" data-live-slot="home" aria-label="平台实时数据（演示）">
      <div class="row"><span class="live-dot"></span><b>平台实时数据</b><span class="tag tag-demo">演示</span></div>
      <div class="stat-grid">
        <div class="stat"><span class="stat-v mono" data-counter="samples">${fmt(samples)}</span><span class="stat-l">今日采集数据条</span></div>
        <div class="stat"><span class="stat-v mono">${platformStats.sensorsOnline}</span><span class="stat-l">在线探头</span></div>
        <div class="stat"><span class="stat-v mono">${platformStats.batchesInPond}</span><span class="stat-l">在塘批次</span></div>
        <div class="stat"><span class="stat-v mono">${platformStats.tracedBatches}</span><span class="stat-l">已建档批次</span></div>
      </div>
      <div class="hero-feed" aria-live="off">
        ${bases.map(b => `<a class="feed-row" href="${href('base', b.id)}"><span>${icon('pin', 'ic ic-xs')}${esc(b.name)}</span><span class="mono" data-live-base="${b.id}">${pondsOfBase(b.id).length} 口塘 · ${b.sensors} 探头</span></a>`).join('')}
      </div>
    </div>`;
}

export function homePage(heroPanel: string): string {
  const featured = products.slice(0, 4);
  const sample = findBatch('HH-YJ-2605-02')!;
  const sampleLab = sample.labs.find(l => l.category.includes('渔药'))!;
  const passed = sampleLab.items.filter(i => i.pass).length;
  const chain = [
    ['sensor', '物联网监测', '塘口探头 24 小时采集溶氧、水温、pH、氨氮'],
    ['user', '确权小程序', '养殖户登记放苗、投喂、转塘、起捕并拍照'],
    ['flask', '机构检测', '第三方检测渔药残留、重金属与微生物'],
    ['layers', '批次档案', '数据按批次归集，修订留痕，生成数据指纹'],
    ['store', 'AI 农贸市场', '商品绑定批次，买家一键查看完整来源'],
  ];
  return `
  <section class="hero">
    <div class="hero-copy">
      <div class="kicker glow-text">${icon('spark', 'ic ic-xs')} 物联网 × 确权 × AI 产销一体</div>
      <h1 tabindex="-1" data-heading>每一条鱼<br><span class="grad">都有自己的数据档案</span></h1>
      <p class="lead">从苗种、塘口、饲料到水质和检测报告，${esc(company.short)}把养殖过程的每一个环节记录下来。你买到的，是看得见来处的好货。</p>
      <form class="trace-search" id="hero-trace" role="search">
        <label class="sr-only" for="hero-code">批次码</label>
        ${icon('qr')}<input id="hero-code" name="code" maxlength="40" autocomplete="off" placeholder="输入包装上的批次码，例如 ${sample.code}">
        <button class="btn btn-primary" type="submit">查询溯源</button>
      </form>
      <div class="hero-cta"><a class="btn btn-ghost" href="${href('shop')}">${icon('cart')}去买好货</a><a class="btn btn-ghost" href="${href('source')}">${icon('truck')}企业产地采购</a></div>
    </div>
    ${heroPanel}
  </section>

  <section class="section">
    <div class="sec-head"><div><div class="kicker">从塘口到餐桌</div><h2>一条完整的产销数据链</h2></div></div>
    <ol class="chain">${chain.map(([ic, t, d], i) => `<li class="chain-step card"><span class="chain-n mono">0${i + 1}</span>${icon(ic!, 'ic ic-lg')}<h3>${t}</h3><p>${d}</p></li>`).join('')}</ol>
  </section>

  <section class="section">
    <div class="sec-head"><div><div class="kicker">可溯源好货</div><h2>今日精选</h2></div><a class="link" href="${href('shop')}">查看全部 ${icon('arrow', 'ic ic-xs')}</a></div>
    <div class="pgrid">${featured.map(productCard).join('')}</div>
  </section>

  <section class="section split">
    <div class="card glass feature-trace">
      <div class="kicker">溯源档案示例</div>
      <h2>${esc(sample.species)} · <span class="mono">${sample.code}</span></h2>
      <p class="muted">${batches.length} 个已上市批次均可查看：来源链、养殖时间轴、饲料批号、水质曲线、检测报告、数据修订记录。</p>
      <ul class="ticks">
        <li>${icon('check', 'ic ic-xs')}标粗池 → 高位池 转塘全程留档</li>
        <li>${icon('check', 'ic ic-xs')}${sample.sensors} 个探头采集 ${fmt(sample.provenance.sensorSamples)} 条水质数据</li>
        <li>${icon('check', 'ic ic-xs')}第三方检测 ${passed}/${sampleLab.items.length} 项符合</li>
      </ul>
      <a class="btn btn-primary" href="${href('trace', sample.code)}">打开溯源档案 ${icon('arrow', 'ic ic-xs')}</a>
    </div>
    <div class="card glass feature-ai">
      <div class="kicker">${icon('spark', 'ic ic-xs')} AI 溯源助手</div>
      <h2>想知道什么，直接问</h2>
      <div class="bubble bubble-q">这条金鲳鱼打过药吗？</div>
      <div class="bubble bubble-a">${esc(aiAnswers(sample)[1]!.a)}</div>
      <button class="btn btn-ghost" data-action="assistant">${icon('chat')}打开 AI 助手</button>
    </div>
  </section>

  <section class="section">
    <div class="sec-head"><div><div class="kicker">产地</div><h2>${esc(company.short)}养殖基地</h2></div><a class="link" href="${href('bases')}">全部基地 ${icon('arrow', 'ic ic-xs')}</a></div>
    <div class="base-grid">${bases.map(b => `<a class="base-card card" href="${href('base', b.id)}">
      <div class="row"><b>${esc(b.name)}</b><span class="tag">${b.water === 'marine' ? '海水' : '淡水'}</span>${demoTag()}</div>
      <p class="muted sm">${esc(b.intro)}</p>
      <div class="base-meta mono"><span>${esc(b.region)}</span><span>${esc(b.area)}</span><span>${b.sensors} 探头</span></div></a>`).join('')}</div>
  </section>`;
}
