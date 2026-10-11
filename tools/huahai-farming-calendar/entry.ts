import { beijingDateKey, calendarDay } from './screenCalendar'

const reader = document.querySelector<HTMLElement>('[data-farming-reader]')
if (reader) {
  const text = (selector: string, value: string) => { reader!.querySelector<HTMLElement>(selector)!.textContent = value }
  let currentKey = ''
  function refresh() {
    const key = beijingDateKey(new Date())
    if (key === currentKey) return
    const day = calendarDay(key)
    text('[data-weekday]', `北京时间 · ${day.weekday}`); text('[data-term]', day.term)
    text('[data-brief]', day.agriculture.brief); text('[data-solar]', day.solarLabel)
    text('[data-lunar]', `农历${day.lunarYear}${day.lunarLabel}`)
    text('[data-next]', `下一节气 ${day.nextTerm.name} · ${day.nextTerm.label} · 还有${day.nextTerm.daysAway}天`)
    text('[data-care-title]', day.agriculture.label); text('[data-planting]', day.agriculture.planting)
    text('[data-water]', day.agriculture.water); text('[data-story-title]', day.agriculture.story.title)
    text('[data-story]', day.agriculture.story.text)
    const list = reader!.querySelector('[data-sources]')!; list.replaceChildren()
    for (const source of day.agriculture.sources) {
      const li = document.createElement('li'), link = document.createElement('a')
      link.textContent = source.title; link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'
      li.append(link); list.append(li)
    }
    currentKey = key; reader!.setAttribute('aria-busy', 'false')
  }
  refresh(); setInterval(refresh, 60_000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh() })
}
