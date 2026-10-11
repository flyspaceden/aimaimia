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
test('发布清单绑定内容与计算源码，生成资源有日期控制与资料入口', async () => {
  const root = new URL('../../', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('huahai-corporate-site/assets/farming-calendar-manifest.json', root)))
  for (const name of ['screenCalendar.ts', 'agriculturalCalendarContent.ts']) assert.equal(createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex'), manifest.sources[name])
  const js = await readFile(new URL('huahai-corporate-site/assets/farming-calendar.js', root), 'utf8')
  assert.match(js, /农事日历/); assert.match(js, /农事小故事/); assert.match(js, /Asia\/Shanghai/)
})

test('启用脚本的实际首页能切换九种语言，noscript不成为整段HTML译文键', async () => {
  const root = new URL('../../', import.meta.url)
  const html = await readFile(new URL('huahai-corporate-site/index.html', root), 'utf8')
  const script = await readFile(new URL('huahai-corporate-site/assets/script.js', root), 'utf8')
  for (const lang of ['en', 'ar', 'fr', 'de', 'ja', 'it', 'pt', 'es', 'zh-TW']) {
    const dictionary = JSON.parse(await readFile(new URL(`huahai-corporate-site/assets/locales/${lang}.json`, root)))
    const dom = new JSDOM(html, { url: `https://huahainongke.com/?lang=${lang}`, runScripts: 'dangerously' })
    try {
      const { window } = dom
      assert.match(window.document.querySelector('noscript').textContent, /<div/, '必须按启用JS时的noscript解析行为验证')
      const source = window.document.querySelector('script[src^="assets/script.js"]')
      Object.defineProperty(window.document, 'currentScript', { configurable: true, value: source })
      window.fetch = async () => ({ ok: true, json: async () => dictionary })
      window.eval(script)
      for (let tick = 0; tick < 6; tick++) await Promise.resolve()
      assert.equal(window.document.documentElement.lang, lang, lang)
      assert.equal(window.document.querySelector('.today-farming h2').textContent, dictionary['今日农事'], lang)
      assert.equal(window.document.querySelector('[data-open-farming]').textContent, dictionary['查看农事日历'], lang)
      assert.equal(window.document.querySelector('[data-today-brief]').textContent, '认识节气，读懂农事。农事正文为中文原文。')
    } finally { dom.window.close() }
  }
})
