import { Solar } from 'lunar-typescript'
import { agriculturalContent } from './agriculturalCalendarContent'

const beijingFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', calendar: 'gregory', year: 'numeric', month: '2-digit', day: '2-digit' })
export function beijingDateKey(date: Date) {
  const parts = beijingFormatter.formatToParts(date)
  const field = (type: string) => parts.find(part => part.type === type)!.value
  return `${field('year')}-${field('month')}-${field('day')}`
}
export function calendarDay(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  const solar = Solar.fromYmd(year, month, day)
  const lunar = solar.getLunar()
  // 按北京时间日期识别节气；不把节气常识当作本地实时天气。
  const current = lunar.getPrevJieQi(true)
  const next = lunar.getNextJieQi(true)
  const nextKey = next.getSolar().toYmd()
  const [nextYear, nextMonth, nextDay] = nextKey.split('-').map(Number)
  const daysAway = Math.round((Date.UTC(nextYear, nextMonth - 1, nextDay) - Date.UTC(year, month - 1, day)) / 86_400_000)
  return { key, solarLabel: `${year}年${month}月${day}日`, weekday: `星期${solar.getWeekInChinese()}`,
    lunarLabel: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    lunarYear: `${lunar.getYearInGanZhi()}年`, term: current.getName(),
    nextTerm: { name: next.getName(), key: nextKey, label: `${nextYear === year ? '' : nextYear + '年'}${nextMonth}月${nextDay}日`, daysAway },
    agriculture: agriculturalContent(current.getName(), key) }
}
export type CalendarDay = ReturnType<typeof calendarDay>
