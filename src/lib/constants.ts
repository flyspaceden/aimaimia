// ============================================
// 图片资源 — 全部来自 Unsplash（免费可商用）
// ============================================
export const IMAGES = {
  // 首页
  hero: {
    // 不需要背景图，用粒子 + 光球
  },
  // 农业场景
  agriculture: {
    greenField: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200&q=80', // 绿色麦田
    greenhouse: 'https://images.unsplash.com/photo-1585500001096-aec5c3a83dab?w=1200&q=80', // 温室大棚
    farmer: 'https://images.unsplash.com/photo-1574943320219-553eb213f72d?w=1200&q=80', // 农民劳作
    riceField: 'https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?w=1200&q=80', // 稻田
    orchard: 'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1200&q=80', // 果园丰收
  },
  // 新鲜农产品
  produce: {
    vegetables: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=1200&q=80', // 新鲜蔬菜
    fruits: 'https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=1200&q=80', // 水果拼盘
    organic: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=1200&q=80', // 有机食材
    market: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200&q=80', // 农产品市场
  },
  // 科技/AI
  tech: {
    dataViz: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&q=80', // 数据可视化
    network: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&q=80', // 网络连接
    ai: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&q=80', // AI 抽象
    circuit: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&q=80', // 电路板
  },
  // 物流
  logistics: {
    warehouse: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=1200&q=80', // 仓储
    delivery: 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=1200&q=80', // 配送
    coldChain: 'https://images.unsplash.com/photo-1494412574643-ff11b0a5eb19?w=1200&q=80', // 冷链
  },
  // 团队/商务
  team: {
    meeting: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&q=80', // 团队会议
    office: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80', // 办公场景
    collaboration: 'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1200&q=80', // 协作
    handshake: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=1200&q=80', // 握手合作
  },
  // 手机设备
  devices: {
    phoneHand: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=800&q=80', // 手持手机
    phoneDark: 'https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=800&q=80', // 暗色手机
  },
} as const

// ============================================
// 统计数据（展示用）
// ============================================
export const STATS = [
  { label: '注册用户', value: 500000, suffix: '+' },
  { label: '入驻商户', value: 8000, suffix: '+' },
  { label: 'AI溯源覆盖', value: 98, suffix: '%' },
  { label: '累计交易额', value: 10, suffix: '亿+' },
] as const

// ============================================
// 导航链接
// ============================================
export const NAV_LINKS = [
  { label: '首页', path: '/' },
  { label: '产品功能', path: '/products' },
  { label: 'AI 技术', path: '/ai' },
  { label: '关于我们', path: '/about' },
  { label: '商户入驻', path: '/merchants' },
  { label: '联系我们', path: '/contact' },
] as const

// ============================================
// 页面 SEO 配置
// ============================================
export const PAGE_META: Record<string, { title: string; description: string }> = {
  '/': {
    title: '爱买买 — AI赋能农业电商平台',
    description: 'AI 驱动的农业电商平台，智能溯源、品质保障，从田间到餐桌的智慧连接',
  },
  '/products': {
    title: '产品功能 — 爱买买',
    description: '买家端智能搜索、卖家端数据分析、AI 助手，一站式农产品交易体验',
  },
  '/ai': {
    title: 'AI 技术 — 爱买买',
    description: 'AI 溯源、语义搜索、语音助手，用人工智能重新定义农产品电商',
  },
  '/about': {
    title: '关于我们 — 爱买买',
    description: '让农业拥抱智能时代，了解爱买买的使命、团队与发展历程',
  },
  '/merchants': {
    title: '商户入驻 — 爱买买',
    description: '零门槛入驻、AI 智能定价、流量扶持，与爱买买共创农业未来',
  },
  '/contact': {
    title: '联系我们 — 爱买买',
    description: '商务合作、商户咨询、技术支持，与爱买买取得联系',
  },
}

// ============================================
// 团队成员（占位）
// ============================================
export const TEAM_MEMBERS = [
  { name: '张明远', role: 'CEO & 创始人', bio: '连续创业者，深耕农业科技10年', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80' },
  { name: '李芳华', role: 'CTO', bio: 'AI 算法专家，前大厂技术总监', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80' },
  { name: '王建国', role: '产品VP', bio: '电商产品专家，主导多个千万级项目', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&q=80' },
  { name: '陈晓梅', role: '运营总监', bio: '农业供应链专家，助力乡村振兴', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&q=80' },
] as const

// ============================================
// 发展历程
// ============================================
export const TIMELINE = [
  { year: '2024', title: '项目启动', desc: '核心团队组建，完成产品设计和技术选型' },
  { year: '2024 Q3', title: '技术研发', desc: 'AI 溯源引擎和语义搜索系统开发完成' },
  { year: '2025 Q1', title: '平台上线', desc: '买家 App 和卖家后台正式上线运营' },
  { year: '2025 Q3', title: '快速增长', desc: '入驻商户突破 5000 家，覆盖全国 20 省' },
  { year: '2026', title: '生态扩展', desc: 'AI 语音助手上线，开放平台 API' },
] as const

// ============================================
// 成功案例
// ============================================
export const SUCCESS_STORIES = [
  {
    name: '绿源果业',
    image: IMAGES.agriculture.orchard,
    stat: '月销量增长 320%',
    quote: '入驻爱买买后，AI 定价让我们的水果卖出了合理的好价钱，再也不用担心被压价。',
  },
  {
    name: '田园农场',
    image: IMAGES.agriculture.greenhouse,
    stat: '客户复购率 85%',
    quote: 'AI 溯源功能让消费者看到我们的种植过程，信任感大大提升。',
  },
  {
    name: '阳光蔬菜合作社',
    image: IMAGES.produce.vegetables,
    stat: '运营成本降低 40%',
    quote: '智能订单管理和物流对接节省了大量人工，我们能专注于种好菜。',
  },
] as const
