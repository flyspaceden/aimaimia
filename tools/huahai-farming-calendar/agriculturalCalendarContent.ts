// 公开农事常识，按节气整理；与基地读数、预警和设备操作独立。
export const AGRICULTURAL_CONTENT_VERSION = '20261010-v1'
type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export const agriculturalSources = {
  culture: { title: '中国气象局：节气与农耕文化', url: 'https://www.cma.gov.cn/2011xwzx/2011xmtjj/202110/t20211029_4006706.html' },
  spring: { title: '中国气象局：关键农时与天气（PDF）', url: 'https://www.cma.gov.cn/zfxxgk/gknr/flfgbz/bz/202503/P020250320113883699245.pdf' },
  springWater: { title: '农业农村部：春季水产养殖', url: 'https://yyj.moa.gov.cn/gzdt/202002/t20200212_6336942.htm' },
  summer: { title: '中国气象局：大暑的气候与农事', url: 'https://www.cma.gov.cn/2011xzt/2020zt/2020_24jq/ds/202111/t20211103_4134510.html' },
  summerWater: { title: '农业农村部：夏季水产养殖', url: 'https://yyj.moa.gov.cn/scyz/202306/t20230620_6430587.htm' },
  autumn: { title: '中国气象局：分地区秋收秋种', url: 'https://www.cma.gov.cn/wmhd/2011wzbft/2011wftzb/202209/t20220909_5081513.html' },
  autumnWater: { title: '农业农村部：秋季水产养殖', url: 'https://yyj.moa.gov.cn/scyz/202309/t20230927_6437418.htm' },
  harvest: { title: '中国气象报：秋分与丰收（PDF）', url: 'https://www.cma.gov.cn/ztbd/2024zt/jq/xz/202409/P020240923585957696529.pdf' },
  winter: { title: '农业农村部：麦油作物安全越冬', url: 'https://zzys.moa.gov.cn/gzdt/202212/t20221207_6416719.htm' },
  winterWater: { title: '农业农村部：冬季养殖设施与管理', url: 'https://yyj.moa.gov.cn/gzdt/202111/t20211111_6381868.htm' },
} as const
type SourceKey = keyof typeof agriculturalSources
type Story = { title: string; text: string; source: SourceKey }
type SeasonalContent = { label: string; planting: string; water: string; sources: SourceKey[]; stories: Story[] }
const seasons: Record<Season, SeasonalContent> = {
  spring: {
    label: '春耕与备种',
    planting: '春播区先核对地温与土壤墒情，麦区观察返青与苗情；播种安排结合当地天气和作物品种确定。',
    water: '放养准备看水温和苗种状态。巡塘记录摄食与水质变化，再按养殖品种和生长阶段安排投喂。',
    sources: ['spring', 'springWater'],
    stories: [
      { title: '一根日影，一本田间日历', text: '没有手机日历的年代，人们观察日影、天气和草木的变化，把一年里反复出现的时令记下来。节气由此成了安排农活的共同语言。今天有了传感器，观察田地的习惯仍然有用。', source: 'culture' },
      { title: '同样是春天，播种有早有晚', text: '南北气候不同，同一天的田地可能处在不同的准备阶段。春播不仅看日期，还要看土壤温度和水分。农时像一把尺子，真正决定何时下种的，仍是眼前这块田。', source: 'spring' },
      { title: '把农忙记进节气里', text: '春耕、夏耘、秋收、冬藏，是农人从一年劳作中总结的节奏。节气把这些观察变成容易记住的时间节点，也让不同世代能够交流耕作经验。', source: 'culture' },
    ],
  },
  summer: {
    label: '夏管与灌排',
    planting: '进入夏收夏种的地区，结合成熟度与天气安排收种；高温或强降雨期间，重点巡查灌排和作物长势。',
    water: '高温时关注水温、溶氧与摄食状态；强降雨和台风来临前，检查增氧、供电及排水设施。',
    sources: ['summer', 'summerWater'],
    stories: [
      { title: '芒种，名字里藏着农忙', text: '节气并不只记录冷暖，也记录庄稼与农活。芒种就是与农事联系紧密的名字。它提醒人们留意收获和播种衔接，而不同地区的忙碌内容并不完全相同。', source: 'culture' },
      { title: '夏日田间，要看天也要看水', text: '夏季的热与雨帮助作物生长，但长时间高温、干旱或暴雨也会影响农田。同一片田，晴天可能需要检查供水，雨后则需要查看排水。农人忙的，是让水分与庄稼需要相配。', source: 'summer' },
      { title: '鱼塘里的清晨', text: '夏季巡塘不只看鱼有没有吃食，还要留意水温、水色和溶氧变化。把这些观察连续记下来，就能更清楚地理解鱼塘的日夜节奏，再结合品种和阶段安排养殖管理。', source: 'summerWater' },
    ],
  },
  autumn: {
    label: '秋收与秋种',
    planting: '北方粮食产区关注成熟、收获与晾晒；江南华南晚稻区留意抽穗扬花期的低温影响。秋种日期按当地技术意见确定。',
    water: '留意昼夜水温变化、溶氧和摄食情况，按养殖品种与阶段调整管理，避免过量投喂影响水质。',
    sources: ['autumn', 'autumnWater'],
    stories: [
      { title: '同一节气，两种农忙', text: '秋天的黄淮麦区有收获与麦播的衔接，江南华南一些晚稻田还要关注冷空气对生长的影响。同一个节气，田里的农活却可以不同：纬度、作物和生育阶段，一起决定当地的农时。', source: 'autumn' },
      { title: '丰收之后，晒场接过了农忙', text: '秋收不是把粮食从田里收回来就结束了。面对连阴雨等天气，收获、晾晒与后续安排也要衔接好。农人从田间忙到晒场，是为了让一季的收成稳稳留下来。', source: 'autumn' },
      { title: '秋分，农民自己的节日', text: '自2018年起，每年的秋分成为中国农民丰收节。一个原本用来认识时令的节气，也成了大家分享劳动成果、交流农耕经验的日子。丰收的主角，是田里、塘边认真劳作的人。', source: 'harvest' },
    ],
  },
  winter: {
    label: '越冬与养护',
    planting: '越冬麦油产区按苗情分类管理；设施农业检查棚体与保温条件，结合当地低温、雨雪预报安排巡查。',
    water: '提前检查保温、供电和增氧设施；低温时依据品种、水温与摄食情况安排投喂，并持续记录水质。',
    sources: ['winter', 'winterWater'],
    stories: [
      { title: '冬藏，藏的不只是粮食', text: '冬藏是传统农耕节奏的一部分。忙过收获季，人们整理一年的经验，准备下一轮耕作。如今的农场也可以趁这个阶段梳理生产记录，让下一季的安排更有依据。', source: 'culture' },
      { title: '日影里的冬至', text: '古人曾用测量日影的方法认识冬至、夏至和春秋分，再逐渐把一年里的时令变化记得更细。节气的故事，起点是耐心观察自然，而不是把每一天排成固定的作业表。', source: 'culture' },
      { title: '鱼塘的冬日守护', text: '冬季天气转冷，鱼塘的日常管理仍然继续。养殖者巡查保温、供电和增氧设施，记录水温与摄食变化。设备维护与日常观察，都是让养殖平稳过冬的一部分。', source: 'winterWater' },
    ],
  },
}

export const solarTermContent: Record<string, { season: Season; brief: string }> = {
  立春: { season: 'spring', brief: '新一季从备耕开始，先看田块与土壤条件。' },
  雨水: { season: 'spring', brief: '春耕渐近，留意土壤水分与排水条件。' },
  惊蛰: { season: 'spring', brief: '田间巡查与春播准备，一起走进春忙。' },
  春分: { season: 'spring', brief: '春管与备种衔接，农时要结合当地温度和墒情。' },
  清明: { season: 'spring', brief: '走进田间看长势，按当地农时安排春播。' },
  谷雨: { season: 'spring', brief: '谷与雨的相遇，把水分管理记进春耕。' },
  立夏: { season: 'summer', brief: '从春耕走向夏管，巡查长势与灌排设施。' },
  小满: { season: 'summer', brief: '生长与收获渐相接，留意水分和作物成熟度。' },
  芒种: { season: 'summer', brief: '收种衔接的农忙时节，各地按作物安排农活。' },
  夏至: { season: 'summer', brief: '夏季田管持续，关注高温与水分变化。' },
  小暑: { season: 'summer', brief: '夏管着重灌排与巡查，鱼塘留意水温和溶氧。' },
  大暑: { season: 'summer', brief: '热与雨交织，灌排、设施和塘边巡查都要跟上。' },
  立秋: { season: 'autumn', brief: '从夏管走向秋收，收获仍要看成熟度与天气。' },
  处暑: { season: 'autumn', brief: '准备收获与后续种植，留意当地天气变化。' },
  白露: { season: 'autumn', brief: '秋收秋种渐忙，留意作物阶段与降温影响。' },
  秋分: { season: 'autumn', brief: '分享丰收，也为秋收、秋耕和秋种做好衔接。' },
  寒露: { season: 'autumn', brief: '收获与秋种并行，晚稻产区留意冷空气影响。' },
  霜降: { season: 'autumn', brief: '收储与越冬准备衔接，防寒安排看当地预报。' },
  立冬: { season: 'winter', brief: '整理生产记录，巡查越冬作物与养殖设施。' },
  小雪: { season: 'winter', brief: '留意当地低温天气，做好设施与设备巡检。' },
  大雪: { season: 'winter', brief: '越冬管理持续，设施与塘边巡查不能只看日历。' },
  冬至: { season: 'winter', brief: '冬藏与养护并重，记录一季经验，准备来年。' },
  小寒: { season: 'winter', brief: '关注当地寒冷天气，巡查保温、供电与增氧设施。' },
  大寒: { season: 'winter', brief: '冬末养护与下一季准备，从生产记录开始。' },
}

export function agriculturalContent(term: string, dateKey: string) {
  const detail = solarTermContent[term] ?? { season: 'spring' as const, brief: '结合当地农时，认识季节与农事。' }
  const season = seasons[detail.season]
  const [year, month, day] = dateKey.split('-').map(Number)
  const ordinal = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
  const story = season.stories[((ordinal % season.stories.length) + season.stories.length) % season.stories.length]
  return { brief: detail.brief, label: season.label, planting: season.planting, water: season.water, story,
    sources: [...new Set<SourceKey>([...season.sources, story.source])].map(key => agriculturalSources[key]) }
}
