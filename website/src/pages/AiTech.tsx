import ParticleCanvas from '@/components/effects/ParticleCanvas'
import HeroOrb from '@/components/effects/HeroOrb'
import ScrollReveal from '@/components/effects/ScrollReveal'
import SectionHeading from '@/components/ui/SectionHeading'
import { IMAGES } from '@/lib/constants'

const TRACE_STEPS = [
  { label: '产地', desc: '种植环境、土壤检测、农药记录', icon: '🌱' },
  { label: '加工', desc: '清洗包装、质检报告、批次编号', icon: '🏭' },
  { label: '物流', desc: '冷链温控、GPS追踪、签收确认', icon: '🚛' },
  { label: '餐桌', desc: '扫码溯源、品质评价、售后保障', icon: '🍽️' },
]

const SEARCH_EXAMPLES = [
  { input: '"给我爸妈买点好消化的"', output: '推荐：有机小米、南瓜、山药、燕麦片...' },
  { input: '"预算 200 买水果礼盒"', output: '筛选：200 元以内精选水果礼盒，按好评排序...' },
  { input: '"无农药的蔬菜"', output: '匹配：有机认证蔬菜，附带溯源检测报告...' },
]

const ARCH_LAYERS = [
  { name: '应用层', items: ['买家 App', '卖家后台', '管理平台'], color: 'from-brand to-brand-light' },
  { name: 'API 网关', items: ['认证鉴权', '流量控制', '负载均衡'], color: 'from-ai-start to-ai-end' },
  { name: 'AI 引擎', items: ['NLP 语义理解', '推荐算法', '图像识别'], color: 'from-ai-end to-ai-glow' },
  { name: '数据层', items: ['PostgreSQL', 'Redis 缓存', 'OSS 存储'], color: 'from-brand-dark to-brand' },
]

const SECURITY_ITEMS = [
  { icon: '🔒', title: '数据加密', desc: '全链路 HTTPS + AES-256 加密存储' },
  { icon: '🛡️', title: '隐私保护', desc: '买家信息脱敏，卖家无法获取用户真实手机号' },
  { icon: '🔐', title: '权限隔离', desc: '多端独立认证，角色级别精细化权限控制' },
  { icon: '📋', title: '审计日志', desc: '所有关键操作自动记录，完整操作追溯' },
]

export default function AiTech() {
  return (
    <>
      {/* Hero */}
      <section className="relative pt-32 pb-24 bg-gradient-to-b from-dark-bg to-dark-surface overflow-hidden">
        <ParticleCanvas particleCount={24} />
        <div className="relative z-10 max-w-page mx-auto px-6 text-center">
          <h1 className="text-display-mobile md:text-display text-text-on-dark mb-4">
            AI，<span className="text-ai-gradient">不只是技术</span>
          </h1>
          <p className="text-lg text-text-on-dark-secondary max-w-2xl mx-auto">
            从溯源到搜索，从语音到推荐，AI 深入农业电商的每一个环节
          </p>
        </div>
      </section>

      {/* AI 溯源 */}
      <section className="py-20 md:py-28 bg-dark-surface">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="全链路 AI 溯源" subtitle="每一份食材的完整生命档案" light={false} />
          </ScrollReveal>

          {/* 溯源流程图 */}
          <ScrollReveal>
            <div className="relative">
              {/* 连线 */}
              <div className="hidden md:block absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-brand via-ai-start to-ai-glow -translate-y-1/2" />

              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {TRACE_STEPS.map((step, i) => (
                  <ScrollReveal key={step.label} delay={i * 0.15}>
                    <div className="relative text-center">
                      <div className="w-20 h-20 mx-auto rounded-full bg-dark-elevated border-2 border-ai-start/30 flex items-center justify-center text-3xl mb-4 shadow-ai-glow">
                        {step.icon}
                      </div>
                      <h3 className="text-text-on-dark font-semibold text-lg mb-1">{step.label}</h3>
                      <p className="text-text-on-dark-secondary text-sm">{step.desc}</p>
                    </div>
                  </ScrollReveal>
                ))}
              </div>
            </div>
          </ScrollReveal>

          <ScrollReveal>
            <div className="mt-12 rounded-card-lg overflow-hidden">
              <img
                src={IMAGES.agriculture.greenField}
                alt="绿色农田溯源场景"
                className="w-full h-64 md:h-80 object-cover"
                loading="lazy"
              />
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* 智能搜索 */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-dark-surface to-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="语义智能搜索" subtitle="不用精确关键词，说人话就能找到" light={false} />
          </ScrollReveal>

          <div className="space-y-4 max-w-2xl mx-auto">
            {SEARCH_EXAMPLES.map((ex, i) => (
              <ScrollReveal key={i} delay={i * 0.15}>
                <div className="rounded-card-lg overflow-hidden border border-white/10">
                  <div className="bg-dark-elevated p-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-r from-ai-start to-ai-end flex items-center justify-center text-white text-sm">🔍</div>
                    <span className="text-text-on-dark font-medium">{ex.input}</span>
                  </div>
                  <div className="bg-dark-bg/50 p-4">
                    <span className="text-ai-end text-sm">AI 理解 →</span>
                    <p className="text-text-on-dark-secondary mt-1">{ex.output}</p>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>

          <ScrollReveal>
            <div className="mt-12 rounded-card-lg overflow-hidden">
              <img
                src={IMAGES.produce.organic}
                alt="有机食材搜索结果"
                className="w-full h-48 md:h-64 object-cover"
                loading="lazy"
              />
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* 语音助手 */}
      <section className="py-20 md:py-28 bg-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="AI 语音助手" subtitle="动动嘴，轻松购物" />
          </ScrollReveal>

          <ScrollReveal>
            <div className="flex flex-col md:flex-row items-center gap-12">
              <div className="flex-1 flex justify-center">
                <HeroOrb size={140} />
              </div>
              <div className="flex-1 space-y-4">
                {[
                  { role: 'user', text: '"帮我看看最近有什么好吃的水果"' },
                  { role: 'ai', text: '当季推荐：海南芒果、云南蓝莓、烟台樱桃，都是产地直发，新鲜保证！' },
                  { role: 'user', text: '"芒果怎么样？有溯源吗？"' },
                  { role: 'ai', text: '这批芒果来自海南三亚基地，有机认证，3 天前采摘。溯源报告显示农残检测合格 ✓' },
                ].map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs px-4 py-3 rounded-card text-sm ${
                      msg.role === 'user'
                        ? 'bg-brand text-white rounded-br-none'
                        : 'bg-light-surface text-text-primary rounded-bl-none border border-light-soft'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* 技术架构 */}
      <section className="py-20 md:py-28 bg-light-surface">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="技术架构" subtitle="稳定可靠的分层架构" />
          </ScrollReveal>

          <div className="space-y-4 max-w-2xl mx-auto">
            {ARCH_LAYERS.map((layer, i) => (
              <ScrollReveal key={layer.name} delay={i * 0.1}>
                <div className="rounded-card overflow-hidden">
                  <div className={`bg-gradient-to-r ${layer.color} px-6 py-3`}>
                    <span className="text-white font-semibold">{layer.name}</span>
                  </div>
                  <div className="bg-white px-6 py-4 flex flex-wrap gap-3">
                    {layer.items.map(item => (
                      <span key={item} className="px-3 py-1 rounded-pill text-sm bg-light-surface text-text-secondary border border-light-soft">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>

          <ScrollReveal>
            <div className="mt-12 rounded-card-lg overflow-hidden">
              <img
                src={IMAGES.tech.circuit}
                alt="技术架构"
                className="w-full h-48 md:h-64 object-cover"
                loading="lazy"
              />
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* 数据安全 */}
      <section className="py-20 md:py-28 bg-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="数据安全" subtitle="全方位保护您的数据隐私" />
          </ScrollReveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            {SECURITY_ITEMS.map((item, i) => (
              <ScrollReveal key={item.title} delay={i * 0.1}>
                <div className="text-center p-6 rounded-card-lg bg-white shadow-card hover:shadow-card-hover transition-shadow">
                  <div className="text-4xl mb-4">{item.icon}</div>
                  <h3 className="font-semibold text-text-primary mb-2">{item.title}</h3>
                  <p className="text-text-secondary text-sm">{item.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
