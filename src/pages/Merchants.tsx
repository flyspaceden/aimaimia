import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ParticleCanvas from '@/components/effects/ParticleCanvas'
import ScrollReveal from '@/components/effects/ScrollReveal'
import SectionHeading from '@/components/ui/SectionHeading'
import Button from '@/components/ui/Button'
import DownloadModal from '@/components/ui/DownloadModal'
import { IMAGES, SUCCESS_STORIES } from '@/lib/constants'

const ADVANTAGES = [
  { icon: '📈', title: '流量扶持', desc: 'AI 算法精准推荐，新店也能获得曝光，不用花钱买流量' },
  { icon: '💡', title: 'AI定价', desc: '根据市场行情、季节、品类自动推荐最优售价，告别拍脑袋定价' },
  { icon: '📊', title: '数据分析', desc: '实时销售看板、客户画像、库存预警，数据驱动经营决策' },
  { icon: '🚚', title: '物流支持', desc: '一键对接主流快递，冷链物流解决方案，降低配送成本' },
]

const STEPS = [
  { num: '01', title: '提交资料', desc: '填写企业信息、营业执照、经营资质' },
  { num: '02', title: '平台审核', desc: '1-3 个工作日完成审核，专人对接指导' },
  { num: '03', title: '开店运营', desc: '上架商品、设置价格，AI 辅助一站式开店' },
  { num: '04', title: '数据增长', desc: '流量扶持 + 数据分析，助力业绩持续增长' },
]

export default function Merchants() {
  const navigate = useNavigate()
  const [downloadOpen, setDownloadOpen] = useState(false)

  return (
    <>
      {/* Hero */}
      <section className="relative pt-32 pb-20 bg-gradient-to-b from-dark-bg to-dark-elevated overflow-hidden">
        <ParticleCanvas particleCount={10} />
        <div className="relative z-10 max-w-page mx-auto px-6 text-center">
          <h1 className="text-display-mobile md:text-display text-text-on-dark mb-4">
            与AI爱买买同行，<span className="text-ai-gradient">共创农业未来</span>
          </h1>
          <p className="text-lg text-text-on-dark-secondary max-w-2xl mx-auto mb-8">
            零门槛入驻，AI 赋能经营，让好产品遇见好买家
          </p>
          <Button size="lg" onClick={() => document.getElementById('steps')?.scrollIntoView({ behavior: 'smooth' })}>
            立即入驻
          </Button>
        </div>
      </section>

      {/* 平台优势 */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-dark-elevated to-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="为什么选择AI爱买买" subtitle="AI 驱动的全方位经营支持" light={false} />
          </ScrollReveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            {ADVANTAGES.map((adv, i) => (
              <ScrollReveal key={adv.title} delay={i * 0.1}>
                <div className="p-6 rounded-card-lg bg-dark-elevated border border-white/5 hover:border-ai-start/30 transition-all h-full">
                  <div className="text-3xl mb-4">{adv.icon}</div>
                  <h3 className="text-text-on-dark font-semibold mb-2">{adv.title}</h3>
                  <p className="text-text-on-dark-secondary text-sm leading-relaxed">{adv.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* 入驻流程 */}
      <section id="steps" className="py-20 md:py-28 bg-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="入驻流程" subtitle="简单四步，轻松开店" />
          </ScrollReveal>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 relative">
            {/* 连线（桌面） */}
            <div className="hidden md:block absolute top-10 left-[12.5%] right-[12.5%] h-0.5 bg-gradient-to-r from-brand via-ai-start to-ai-end" />

            {STEPS.map((step, i) => (
              <ScrollReveal key={step.num} delay={i * 0.15}>
                <div className="text-center relative">
                  <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-brand to-ai-start flex items-center justify-center text-white text-2xl font-bold mb-4 shadow-ai-glow relative z-10">
                    {step.num}
                  </div>
                  <h3 className="font-semibold text-text-primary text-lg mb-1">{step.title}</h3>
                  <p className="text-text-secondary text-sm">{step.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* 卖家后台展示 */}
      <section className="py-20 md:py-28 bg-light-surface">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="强大的卖家后台" subtitle="一站式管理，数据驱动增长" />
          </ScrollReveal>

          <ScrollReveal>
            <div className="rounded-card-lg overflow-hidden shadow-card-hover">
              <img
                src={IMAGES.tech.dataViz}
                alt="卖家后台数据分析界面"
                className="w-full h-64 md:h-96 object-cover"
                loading="lazy"
              />
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* 成功案例 */}
      <section className="py-20 md:py-28 bg-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="成功案例" subtitle="他们在AI爱买买找到了增长" />
          </ScrollReveal>

          <div className="grid md:grid-cols-3 gap-6">
            {SUCCESS_STORIES.map((story, i) => (
              <ScrollReveal key={story.name} delay={i * 0.15}>
                <div className="bg-white rounded-card-lg overflow-hidden shadow-card hover:shadow-card-hover transition-shadow">
                  <img
                    src={story.image}
                    alt={story.name}
                    className="w-full h-48 object-cover"
                    loading="lazy"
                  />
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-text-primary">{story.name}</h3>
                      <span className="text-brand font-bold text-sm">{story.stat}</span>
                    </div>
                    <p className="text-text-secondary text-sm italic">"{story.quote}"</p>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 md:py-28 bg-gradient-to-r from-brand via-ai-start to-ai-end relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <img src={IMAGES.agriculture.orchard} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="relative z-10 max-w-page mx-auto px-6 text-center">
          <ScrollReveal>
            <h2 className="text-h1-mobile md:text-h1 text-white mb-4">开启您的农业直销之旅</h2>
            <p className="text-lg text-white/80 mb-8">
              加入AI爱买买，让 AI 帮您把好产品卖给好买家
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button variant="gold" size="lg" onClick={() => setDownloadOpen(true)}>
                立即入驻
              </Button>
              <Button variant="ghost" size="lg" onClick={() => navigate('/contact')}>
                咨询合作
              </Button>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <DownloadModal open={downloadOpen} onClose={() => setDownloadOpen(false)} />
    </>
  )
}
