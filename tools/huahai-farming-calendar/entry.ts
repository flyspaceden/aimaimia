import { beijingDateKey, calendarDay, type CalendarDay } from './screenCalendar'

const strip = document.getElementById('today-farming')
if (strip) {
  const trigger = strip.querySelector<HTMLButtonElement>('[data-open-farming]')!
  const modal = document.createElement('dialog')
  modal.className = 'farming-calendar-dialog'
  modal.lang = 'zh-CN'
  modal.dir = 'ltr'
  modal.setAttribute('data-translation-ignore', '')
  modal.setAttribute('aria-labelledby', 'farming-dialog-title')
  // 固定界面骨架；日期、故事与资料链接用textContent/DOM属性填充。
  modal.innerHTML = `<header><div><small data-weekday></small><h2 id="farming-dialog-title">农事日历</h2></div><button type="button" aria-label="关闭农事日历">×</button></header>
    <div class="farming-season"><div><small>节气农事</small><h3 data-term></h3><p data-brief></p></div><div class="farming-date"><strong data-solar></strong><span data-lunar></span><small data-next></small></div></div>
    <section class="farming-care"><h3 data-care-title></h3><dl><div><dt>种植</dt><dd data-planting></dd></div><div><dt>水产</dt><dd data-water></dd></div></dl></section>
    <section class="farming-story"><small>农事小故事</small><h3 data-story-title></h3><p data-story></p></section>
    <details class="farming-sources"><summary>参考资料</summary><ul data-sources></ul></details>
    <footer>农时参考，请结合当地天气、品种与生长阶段安排农事。<br/>农事正文为中文原文。</footer>`
  document.body.append(modal)
  const text = (selector: string, value: string) => { modal.querySelector<HTMLElement>(selector)!.textContent = value }
  function fill(day: CalendarDay) {
    text('[data-weekday]', `北京时间 · ${day.weekday}`); text('[data-term]', day.term)
    text('[data-brief]', day.agriculture.brief); text('[data-solar]', day.solarLabel)
    text('[data-lunar]', `农历${day.lunarYear}${day.lunarLabel}`)
    text('[data-next]', `下一节气 ${day.nextTerm.name} · ${day.nextTerm.label} · 还有${day.nextTerm.daysAway}天`)
    text('[data-care-title]', day.agriculture.label); text('[data-planting]', day.agriculture.planting)
    text('[data-water]', day.agriculture.water); text('[data-story-title]', day.agriculture.story.title)
    text('[data-story]', day.agriculture.story.text)
    const list = modal.querySelector('[data-sources]')!; list.replaceChildren()
    for (const source of day.agriculture.sources) {
      const li = document.createElement('li'), link = document.createElement('a')
      link.textContent = source.title; link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'
      li.append(link); list.append(li)
    }
  }
  let previousOverflow = '', opened = false, currentKey = ''
  let today: CalendarDay
  function refresh() {
    const key = beijingDateKey(new Date())
    if (key === currentKey) return
    currentKey = key; today = calendarDay(key)
    strip!.querySelector('[data-today-term]')!.textContent = today.term
    strip!.querySelector('[data-today-date]')!.textContent = `${today.solarLabel} · 农历${today.lunarLabel}`
    strip!.querySelector('[data-today-brief]')!.textContent = today.agriculture.brief
  }
  function restore() {
    if (!opened) return
    opened = false; document.body.style.overflow = previousOverflow
    trigger.focus()
  }
  function close() { if (typeof modal.close === 'function') modal.close(); else modal.removeAttribute('open'); restore() }
  trigger.addEventListener('click', () => {
    if (opened) return
    refresh(); fill(today); previousOverflow = document.body.style.overflow; opened = true
    document.body.style.overflow = 'hidden'
    if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '')
    modal.querySelector<HTMLButtonElement>('header>button')!.focus()
  })
  modal.querySelector('header>button')!.addEventListener('click', close)
  modal.addEventListener('cancel', event => { event.preventDefault(); close() })
  modal.addEventListener('click', event => { if (event.target === modal) close() })
  modal.addEventListener('close', () => { if (!modal.open) restore() })
  refresh()
  trigger.disabled = false
  setInterval(refresh, 60_000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh() })
}
