import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { JSDOM } from 'jsdom'
const result = await build({ entryPoints: [fileURLToPath(new URL('./screenCalendar.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, tsconfigRaw: { compilerOptions: { target: 'ES2020' } } })
const { calendarDay, beijingDateKey } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'))
test('官网和大屏采用北京时间日期与节气，不提供宜忌字段', () => {
  assert.equal(beijingDateKey(new Date('2026-10-07T16:00:00Z')), '2026-10-08')
  const day = calendarDay('2026-10-10')
  assert.equal(day.term, '寒露'); assert.equal(day.lunarLabel, '九月初一')
  assert.equal(day.nextTerm.name, '霜降'); assert.equal(day.nextTerm.daysAway, 13)
  assert.ok(day.agriculture.planting); assert.ok(day.agriculture.story.text)
  assert.equal('yi' in day, false); assert.equal('ji' in day, false)
})
test('发布清单绑定计算源码，农事专页按北京午夜更新内容和资料', async () => {
  const root = new URL('../../', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('huahai-corporate-site/assets/farming-calendar-manifest.json', root)))
  for (const name of ['screenCalendar.ts', 'agriculturalCalendarContent.ts', 'entry.ts']) assert.equal(createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex'), manifest.sources[name])
  const js = await readFile(new URL('huahai-corporate-site/assets/farming-calendar.js', root), 'utf8')
  const html = await readFile(new URL('huahai-corporate-site/agriculture.html', root), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true })
  let now = '2026-10-10T15:59:59Z'
  dom.window.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return Date.parse(now) }
  }
  try {
    dom.window.eval(js)
    const d = dom.window.document
    assert.equal(d.querySelector('[data-farming-reader]').getAttribute('aria-busy'), 'false')
    assert.match(d.querySelector('[data-solar]').textContent, /2026年10月10日/)
    assert.match(d.querySelector('[data-lunar]').textContent, /九月初一/)
    assert.equal(d.querySelector('[data-term]').textContent, '寒露')
    assert.ok(d.querySelector('[data-story]').textContent)
    const links = d.querySelectorAll('[data-sources] a')
    assert.ok(links.length)
    assert.ok([...links].every(link => link.href.startsWith('https://') && link.rel.includes('noopener')))
    now = '2026-10-10T16:00:00Z'
    d.dispatchEvent(new dom.window.Event('visibilitychange'))
    assert.match(d.querySelector('[data-solar]').textContent, /2026年10月11日/)
    assert.match(d.querySelector('[data-lunar]').textContent, /九月初二/)
    assert.equal(d.querySelectorAll('[data-sources] a').length, links.length)
  } finally { dom.window.close() }
})

test('农事专页切换九种语言，正文为中文且新页面链接保留语言', async () => {
  const root = new URL('../../', import.meta.url)
  const html = await readFile(new URL('huahai-corporate-site/agriculture.html', root), 'utf8')
  const script = await readFile(new URL('huahai-corporate-site/assets/script.js', root), 'utf8')
  for (const lang of ['en', 'ar', 'fr', 'de', 'ja', 'it', 'pt', 'es', 'zh-TW']) {
    const dictionary = JSON.parse(await readFile(new URL(`huahai-corporate-site/assets/locales/${lang}.json`, root)))
    const dom = new JSDOM(html, { url: `https://huahainongke.com/agriculture.html?lang=${lang}`, runScripts: 'dangerously' })
    try {
      const { window } = dom
      assert.match(window.document.querySelector('noscript').textContent, /<p/, '必须按启用JS时的noscript解析行为验证')
      const source = window.document.querySelector('script[src^="assets/script.js"]')
      Object.defineProperty(window.document, 'currentScript', { configurable: true, value: source })
      window.fetch = async () => ({ ok: true, json: async () => dictionary })
      window.eval(script)
      for (let tick = 0; tick < 6; tick++) await Promise.resolve()
      assert.equal(window.document.documentElement.lang, lang, lang)
      assert.equal(window.document.querySelector('.nav-library-trigger').textContent.trim(), dictionary['大健康知识库'], lang)
      assert.equal(window.document.querySelector('.knowledge-hero h1').textContent, '农事上下五千年', '正文保持中文原文')
      assert.equal(window.document.querySelector('[data-brief]').textContent, '正在读取今天的节气…')
      for (const link of window.document.querySelectorAll('.nav-library-menu a, .knowledge-tabs a')) assert.equal(new URL(link.href).searchParams.get('lang'), lang)
    } finally { dom.window.close() }
  }
})
