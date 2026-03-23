import ScrollReveal from '@/components/effects/ScrollReveal'
import SectionHeading from '@/components/ui/SectionHeading'
import ParticleCanvas from '@/components/effects/ParticleCanvas'
import { IMAGES } from '@/lib/constants'

const BUYER_FEATURES = [
  { title: '智能搜索', desc: '自然语言搜索，"给爸妈买点好消化的"也能精准匹配', icon: '🔍' },
  { title: '品质溯源', desc: '扫码查看从产地到餐桌的完整品质档案', icon: '🌿' },
  { title: '一键下单', desc: '智能购物车、优惠自动计算、多支付方式', icon: '🛒' },
  { title: 'AI 推荐', desc: '基于购买习惯和偏好的个性化商品推荐', icon: '✨' },
]

const SELLER_FEATURES = [
  { title: '订单管理', desc: '实时订单追踪、自动状态流转、异常预警', icon: '📦' },
  { title: '数据分析', desc: '销售趋势、客户画像、库存预警一目了然', icon: '📊' },
  { title: '智能定价', desc: 'AI 分析市场数据，自动推荐最优售价', icon: '💰' },
  { title: '物流对接', desc: '一键对接主流快递，自动生成电子面单', icon: '🚚' },
]

const COMPARISON = [
  { feature: '搜索方式', us: 'AI 语义搜索', them: '关键词匹配' },
  { feature: '品质保障', us: '全链路 AI 溯源', them: '商家自述' },
  { feature: '定价策略', us: 'AI 智能定价', them: '手动设价' },
  { feature: '数据分析', us: '实时智能看板', them: '基础统计' },
  { feature: '客户服务', us: 'AI 语音助手', them: '在线客服' },
  { feature: '物流追踪', us: '全链路可视化', them: '快递单号查询' },
]

export default function Products() {
  return (
    <>
      {/* Hero */}
      <section className="relative pt-32 pb-20 bg-gradient-to-b from-dark-bg to-dark-elevated overflow-hidden">
        <ParticleCanvas particleCount={10} />
        <div className="relative z-10 max-w-page mx-auto px-6 text-center">
          <h1 className="text-display-mobile md:text-display text-text-on-dark mb-4">
            一个平台，<span className="text-ai-gradient">连接产地与餐桌</span>
          </h1>
          <p className="text-lg text-text-on-dark-secondary max-w-2xl mx-auto">
            从买家到卖家，从前台到后台，爱买买为农业电商的每个环节提供智能解决方案
          </p>
        </div>
      </section>

      {/* 买家端 */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-dark-elevated to-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <div className="flex flex-col md:flex-row gap-12 items-center">
              <div className="flex-1">
                <span className="text-ai-end text-sm font-semibold tracking-wider uppercase mb-4 block">买家端</span>
                <h2 className="text-h1-mobile md:text-h1 text-text-on-dark mb-6">智慧购物体验</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {BUYER_FEATURES.map(f => (
                    <div key={f.title} className="p-4 rounded-card bg-dark-elevated/50 border border-white/5">
                      <div className="text-2xl mb-2">{f.icon}</div>
                      <h3 className="text-white font-semibold mb-1">{f.title}</h3>
                      <p className="text-text-on-dark-secondary text-sm">{f.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <img
                  src={IMAGES.produce.market}
                  alt="买家端购物场景"
                  className="w-full rounded-card-lg shadow-card-hover"
                  loading="lazy"
                />
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* 卖家端 */}
      <section className="py-20 md:py-28 bg-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <div className="flex flex-col md:flex-row-reverse gap-12 items-center">
              <div className="flex-1">
                <span className="text-brand text-sm font-semibold tracking-wider uppercase mb-4 block">卖家端</span>
                <h2 className="text-h1-mobile md:text-h1 text-text-primary mb-6">轻松管理经营</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {SELLER_FEATURES.map(f => (
                    <div key={f.title} className="p-4 rounded-card bg-white border border-light-soft shadow-card">
                      <div className="text-2xl mb-2">{f.icon}</div>
                      <h3 className="text-text-primary font-semibold mb-1">{f.title}</h3>
                      <p className="text-text-secondary text-sm">{f.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <img
                  src={IMAGES.tech.dataViz}
                  alt="卖家端数据分析"
                  className="w-full rounded-card-lg shadow-card-hover"
                  loading="lazy"
                />
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* 管理后台 */}
      <section className="py-20 md:py-28 bg-light-surface">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="强大的管理后台" subtitle="全局掌控，让平台运营井然有序" />
          </ScrollReveal>
          <ScrollReveal>
            <div className="relative rounded-card-lg overflow-hidden shadow-card-hover">
              <img
                src={IMAGES.team.office}
                alt="管理后台场景"
                className="w-full h-64 md:h-96 object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {['全局监控', '商户审核', '数据看板', '权限管理'].map(item => (
                    <div key={item} className="bg-white/10 backdrop-blur-sm rounded-card p-4 text-center">
                      <span className="text-white font-semibold">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* 功能对比 */}
      <section className="py-20 md:py-28 bg-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="对比传统平台" subtitle="全面升级，一目了然" />
          </ScrollReveal>
          <ScrollReveal>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[500px]">
                <thead>
                  <tr className="border-b-2 border-brand/20">
                    <th className="text-left py-4 px-4 text-text-secondary font-medium">功能</th>
                    <th className="text-left py-4 px-4 text-brand font-bold">爱买买</th>
                    <th className="text-left py-4 px-4 text-text-tertiary font-medium">传统平台</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map(row => (
                    <tr key={row.feature} className="border-b border-light-soft">
                      <td className="py-4 px-4 font-medium text-text-primary">{row.feature}</td>
                      <td className="py-4 px-4 text-brand font-medium">✓ {row.us}</td>
                      <td className="py-4 px-4 text-text-tertiary">{row.them}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </>
  )
}
