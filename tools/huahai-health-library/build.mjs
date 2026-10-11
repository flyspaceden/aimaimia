import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url)), site = path.join(root, 'huahai-corporate-site')
const read = name => fs.readFileSync(path.join(site, name), 'utf8')
const write = (name, content) => fs.writeFileSync(path.join(site, name), content)
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const version = '20261011-health1'
const index = read('index.html')
const originalHeader = index.match(/<header class="site-header">[\s\S]*?<\/header>/)[0]
const footer = index.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)?.[0] || index.match(/<footer>[\s\S]*?<\/footer>/)[0]
const nav = prefix => `<div class="nav-library">
      <button class="nav-library-trigger" type="button" aria-expanded="false" aria-controls="health-navigation">大健康知识库 <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button>
      <div class="nav-library-menu" id="health-navigation" hidden>
        <a href="${prefix}health.html" data-route="health.html">知识库总览</a>
        <a href="${prefix}agriculture.html" data-route="agriculture.html">农事上下五千年</a>
        <a href="${prefix}food-medicine.html" data-route="food-medicine.html">药食同源（知识）</a>
        <a href="${prefix}healthy-recipes.html" data-route="healthy-recipes.html">今日健康食谱</a>
      </div>
    </div>`
const header = originalHeader.includes('nav-library') ? originalHeader : originalHeader.replace(/(\s*<a href="digital-human\/"[^>]+>)/, '\n    '+nav('')+'$1')
const sourceLink = (url, title) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)} ↗</a>`
const subnav = current => `<nav class="knowledge-tabs" aria-label="知识栏目"><a href="health.html"${current==='health'?' aria-current="page"':''}>知识库总览</a><a href="agriculture.html"${current==='agriculture'?' aria-current="page"':''}>农事上下五千年</a><a href="food-medicine.html"${current==='food-medicine'?' aria-current="page"':''}>药食同源（知识）</a><a href="healthy-recipes.html"${current==='healthy-recipes'?' aria-current="page"':''}>今日健康食谱</a></nav>`
function page(name, title, description, body, extra = '') {
 return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | 华海农科</title><meta name="description" content="${description}"><link rel="icon" href="assets/logo.jpg"><link rel="stylesheet" href="assets/style.css?v=20261004-digital1"><link rel="stylesheet" href="assets/health-library.css?v=${version}">${extra}</head>
<body>${header}<p class="knowledge-language-note">知识内容为中文原文。</p><main class="knowledge-page" lang="zh-CN" dir="ltr" data-translation-ignore>
<div class="container">${subnav(name)}${body}</div></main>${footer}
<script src="assets/script.js?v=${version}"></script><script src="assets/health-library.js?v=${version}" defer></script>${name==='agriculture'?`<script src="assets/farming-calendar.js?v=${version}" defer></script>`:''}</body></html>\n`
}
write('health.html', page('health', '大健康知识库', '华海农科大健康知识库，阅读节气农事、药食同源资料与每日三餐搭配。', `
<section class="knowledge-hero"><p class="knowledge-kicker">华海农科 · 公开知识</p><h1>大健康知识库</h1><p class="knowledge-intro">从四季农事到日常饮食，把值得了解的知识放在一起。选择一个主题，开始阅读。</p><div class="knowledge-hero-mark" aria-hidden="true"><span>农</span><span>食</span><span>养</span></div></section>
<section class="knowledge-index" aria-label="三个知识主题">
  <a href="agriculture.html"><span class="knowledge-number">01</span><div><h2>农事上下五千年</h2><p>看今天的农历与节气，读四季农事和农耕短文。</p><small>农历日历 · 二十四节气 · 原创农事故事</small></div><span class="knowledge-arrow" aria-hidden="true">↗</span></a>
  <a href="food-medicine.html"><span class="knowledge-number">02</span><div><h2>药食同源（知识）</h2><p>认识106种目录条目，先核对食品使用条件，再读传统药性资料。</p><small>名称检索 · 年份筛选 · 官方公告</small></div><span class="knowledge-arrow" aria-hidden="true">↗</span></a>
  <a href="healthy-recipes.html"><span class="knowledge-number">03</span><div><h2>今日健康食谱</h2><p>从家常食材出发，为早餐、午餐、晚餐找一套搭配思路。</p><small>每日搭配 · 食材与做法 · 过敏原信息</small></div><span class="knowledge-arrow" aria-hidden="true">↗</span></a>
</section><p class="knowledge-footnote">农事结合当地天气和生产情况；饮食结合个人需求。这里提供日常知识，不提供个体诊疗方案。</p>`))

write('agriculture.html', page('agriculture', '农事上下五千年', '阅读农历与二十四节气、四季种植和水产常识以及原创农事短文。', `
<section class="knowledge-hero"><p class="knowledge-kicker">农历与节气 · 四季农事</p><h1>农事上下五千年</h1><p class="knowledge-intro">在四季的节奏里认识农事。看今天的时令，读农耕短文，再把观察带回眼前的田地。</p></section>
<article class="farming-reader" data-farming-reader aria-busy="true">
  <header><div><small data-weekday>北京时间</small><h2>今日农事日历</h2></div><span>二十四节气</span></header>
  <div class="farming-season"><div><small>节气农事</small><h3 data-term>四季农时</h3><p data-brief>正在读取今天的节气…</p></div><div class="farming-date"><strong data-solar>农历与节气日历</strong><span data-lunar></span><small data-next></small></div></div>
  <section class="farming-care"><h3 data-care-title>种植与水产</h3><dl><div><dt>种植</dt><dd data-planting></dd></div><div><dt>水产</dt><dd data-water></dd></div></dl></section>
  <section class="farming-story"><small>原创农事短文</small><h3 data-story-title>农事小故事</h3><p data-story></p></section>
  <details class="farming-sources"><summary>参考资料</summary><ul data-sources></ul></details><footer>农时参考，请结合当地天气、品种与生长阶段安排农事。</footer>
</article><noscript data-translation-ignore><p>启用JavaScript可查看今天的农历、节气与故事。${sourceLink('https://www.cma.gov.cn/2011xwzx/2011xmtjj/202110/t20211029_4006706.html','中国气象局 节气与农耕文化')}</p></noscript>
<section class="knowledge-reading"><h2>一年的农事，四季的观察</h2><div class="season-reading"><article><span>春</span><h3>春耕与备种</h3><p>准备种苗、看地温与土壤水分，结合当地天气安排春播。</p></article><article><span>夏</span><h3>夏管与灌排</h3><p>观察作物长势，检查灌排设施；水产养殖关注水温、溶氧与摄食。</p></article><article><span>秋</span><h3>秋收与秋种</h3><p>收获、晾晒与秋种相互衔接，留意冷空气和连续阴雨。</p></article><article><span>冬</span><h3>冬藏与养护</h3><p>记录一年的生产情况，检查设施和越冬准备，为下一季留好基础。</p></article></div></section>`, `<link rel="stylesheet" href="assets/farming-calendar.css?v=${version}">`))

const medicinal = JSON.parse(read('assets/food-medicine.json'))
const entries = medicinal.records.map((r,i) => `<details class="herb-entry" data-herb data-name="${esc(r.name)}" data-year="${r.year}" data-temperature="${r.temperature}">
<summary><span class="herb-number">${String(i+1).padStart(3,'0')}</span><span class="herb-name">${esc(r.name)}</span><span class="herb-trait">${esc(r.traits || '药性资料未收录')}</span><span class="herb-year">${r.year}</span><span class="herb-expand" aria-hidden="true">＋</span></summary>
<div class="herb-detail"><dl><div><dt>食品使用条件</dt><dd>${esc(r.useNote)}</dd></div><div><dt>传统性味</dt><dd>${esc(r.traits || '提供的药性简表未收录，不补造描述。')}</dd></div><div><dt>传统归经</dt><dd>${esc(r.meridians || '提供的药性简表未收录。')}</dd></div><div><dt>资料出处</dt><dd>${esc(r.profileSource)}；目录及食品使用条件见${sourceLink(r.source, r.year+'年官方公告')}。</dd></div></dl><p>性味与归经用于理解传统中医知识，不作为食品的疾病预防、治疗功效或用药依据。</p></div></details>`).join('\n')
write('food-medicine.html', page('food-medicine', '药食同源（知识）', '按官方公告校正的106种食药物质目录，查看食品使用条件和传统性味归经参考资料。', `
<section class="knowledge-hero"><p class="knowledge-kicker">读懂目录 · 核对使用条件</p><h1>药食同源<span class="knowledge-title-note">（知识）</span></h1><p class="knowledge-intro">106种目录条目。先查名称和食品使用条件，再阅读提供资料中的传统性味与归经。</p><p class="knowledge-meta">目录范围：2002、2019、2023、2024年公告 · 整理核对：2026年10月11日</p></section>
<section class="herb-directory" aria-label="食药物质目录"><div class="knowledge-toolbar" data-herb-tools hidden><label>查名称<input type="search" data-herb-search placeholder="例如：陈皮、枸杞、山柰" aria-label="搜索食药物质名称"></label><label>公告年份<select data-herb-year><option value="">全部年份</option><option>2002</option><option>2019</option><option>2023</option><option>2024</option></select></label><label>传统性味<select data-herb-temperature><option value="">全部性味</option><option>寒凉</option><option>温热</option><option>平</option><option>未收录</option></select></label><button type="button" data-herb-reset>清除筛选</button></div>
<div class="directory-status"><p data-herb-status role="status">共106种 · 点击条目展开资料</p><span>名称 / 传统性味 / 公告年份</span></div><div data-herb-list>${entries}</div><p class="directory-empty" data-herb-empty hidden>没有匹配条目，请调整名称或筛选条件。</p>
<div class="knowledge-pagination" data-herb-pagination hidden><button type="button" data-herb-prev>上一页</button><span data-herb-page></span><button type="button" data-herb-next>下一页</button></div></section>
<details class="knowledge-source-note"><summary>资料整理与校正说明</summary><p>两份提供资料作为整理底稿，目录以官方公告校正：2019年批次为当归、山柰、西红花、草果、姜黄、荜茇；党参和黄芪归入2023年批次；肉苁蓉限定荒漠品种。原资料中的山银花、芦荟不列入这套106种目录。山柰、西红花的传统药性资料未收录，未自行补写。</p><p>传统性味与归经来自提供的《国家药食同源目录106种药性简表》，未逐条以药典独立复核。本页展示知识介绍，不展示疾病治疗或处方用量。</p><ul>${Object.entries(medicinal.announcements).map(([year,url])=>`<li>${sourceLink(url, year+'年目录公告')}</li>`).join('')}${Object.entries(medicinal.interpretations).map(([year,url])=>`<li>${sourceLink(url, year+'年官方解读（使用条件）')}</li>`).join('')}</ul></details>`))

write('healthy-recipes.html', page('healthy-recipes', '今日健康食谱', '每日家常三餐搭配示例，查看食材、做法和过敏原，结合个人需要安排饮食。', `
<section class="knowledge-hero"><p class="knowledge-kicker">日常三餐 · 家常食材</p><h1>今日健康食谱</h1><p class="knowledge-intro">主食、蔬菜、蛋白质来源搭配着吃。把日常食材做好，就是一餐的起点。</p><p class="knowledge-meta">一般健康成年人搭配示例，份量结合自身需求调整。</p></section>
<section class="recipe-plan" aria-label="每日食谱"><div class="recipe-day"><div><span data-recipe-date>北京时间 · 每日搭配</span><h2 data-recipe-title>正在读取今日食谱…</h2></div><button type="button" data-recipe-next hidden>换一套搭配 ↻</button></div><p data-recipe-status role="status" hidden></p><div class="meal-list" data-meal-list></div><div class="recipe-extra"><h3>水果、奶类与加餐</h3><p data-recipe-extra></p><p data-recipe-extra-allergens></p></div><details class="recipe-shopping"><summary>查看今天的食材清单</summary><ul data-recipe-shopping></ul></details></section>
<noscript data-translation-ignore><p>启用JavaScript可查看每天轮换的搭配、食材和做法。</p></noscript>
<section class="knowledge-reading recipe-principles"><h2>把搭配留给自己调整</h2><p>选用当季蔬果，同类食材可替换；烹调多用蒸、煮、炖，肉、鱼、蛋充分加热。查看包装的配料和过敏原信息，调味料中的过敏原也要核对。</p><p>对食物过敏、患有慢性病或处于孕期等特殊阶段，按个人专业建议安排饮食。本页不提供疾病食疗处方，也不声称已达到个人营养目标。</p>${sourceLink('https://dg.cnsoc.org/index.html','中国营养学会 中国居民膳食指南2022')}</section>`))

// 所有已有公开页保留内容，只补统一导航和资源版本。
const files = fs.readdirSync(site).filter(n=>n.endsWith('.html')).concat('digital-human/index.html')
for (const file of files) {
 let content=read(file), prefix=file.startsWith('digital-human/')?'../':''
 if (!content.includes('nav-library-trigger')) content=content.replace(/(\s*<a href="(?:\.\.\/)?digital-human\/"[^>]*>|\s*<a href="\.\/" data-route="digital-human">)/, '\n    '+nav(prefix)+'$1')
 if (!content.includes('assets/health-library.css')) content=content.replace('</head>',`<link rel="stylesheet" href="${prefix}assets/health-library.css?v=${version}">\n</head>`)
 content=content.replace(/(assets\/script\.js)\?v=[^"']+/g,`$1?v=${version}`)
 if (!content.includes('assets/health-library.js')) content=content.replace('</body>',`<script src="${prefix}assets/health-library.js?v=${version}" defer></script>\n</body>`)
 if(file==='index.html') content=content.replace(/\s*<section class="today-farming"[\s\S]*?<\/section>/,'').replace(/\s*<link rel="stylesheet" href="assets\/farming-calendar\.css[^>]+>/,'').replace(/\s*<script src="assets\/farming-calendar\.js[^>]+><\/script>/,'')
 write(file,content)
}
console.log('Knowledge pages and unified navigation generated')
