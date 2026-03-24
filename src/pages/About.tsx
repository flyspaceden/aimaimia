import ParticleCanvas from '@/components/effects/ParticleCanvas'
import ScrollReveal from '@/components/effects/ScrollReveal'
import SectionHeading from '@/components/ui/SectionHeading'
import { IMAGES, TEAM_MEMBERS, TIMELINE } from '@/lib/constants'

const VALUES = [
  { title: '使命', desc: '用 AI 技术降低农产品流通成本，让优质农产品走出田间、走上餐桌', icon: '🎯' },
  { title: '愿景', desc: '成为中国领先的 AI 农业直销平台，推动农业数字化转型', icon: '🔭' },
  { title: '价值观', desc: '诚信为本、科技驱动、普惠共赢、绿色可持续', icon: '💎' },
]

export default function About() {
  return (
    <>
      {/* Hero */}
      <section className="relative pt-32 pb-20 bg-dark-bg overflow-hidden">
        <ParticleCanvas particleCount={10} />
        <div className="relative z-10 max-w-page mx-auto px-6 text-center">
          <h1 className="text-display-mobile md:text-display text-text-on-dark mb-4">
            让农业拥抱<span className="text-ai-gradient">AI时代</span>
          </h1>
          <p className="text-lg text-text-on-dark-secondary max-w-2xl mx-auto">
            AI爱买买成立于 2024 年，致力于用 AI 技术重新定义农产品直销
          </p>
        </div>
      </section>

      {/* 品牌故事 */}
      <section className="py-20 md:py-28 bg-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <div className="flex flex-col md:flex-row gap-12 items-center">
              <div className="flex-1">
                <h2 className="text-h1-mobile md:text-h1 text-text-primary mb-6">品牌故事</h2>
                <div className="space-y-4 text-text-secondary leading-relaxed">
                  <p>
                    在中国广袤的农村，有最好的食材、最勤劳的农民，却往往因为信息不对称和流通环节冗长，
                    好产品卖不出好价钱，消费者也难以买到真正新鲜、安全的农产品。
                  </p>
                  <p>
                    AI爱买买的创始团队深入田间地头，走访了数百个农业合作社和家庭农场。我们发现，
                    <span className="text-brand font-medium">AI 技术可以从根本上改变这一现状</span>——
                    从AI溯源建立信任，到语义搜索连接供需，再到数据分析优化经营。
                  </p>
                  <p>
                    于是，AI爱买买诞生了。我们的名字寓意着对农产品的热爱，对品质的追求，
                    对每一次购物体验的珍视。<span className="text-brand font-medium">爱，买买。</span>
                  </p>
                </div>
              </div>
              <div className="flex-1">
                <img
                  src={IMAGES.agriculture.riceField}
                  alt="稻田丰收场景"
                  className="w-full rounded-card-lg shadow-card-hover"
                  loading="lazy"
                />
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* 使命愿景 */}
      <section className="py-20 md:py-28 bg-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="使命 · 愿景 · 价值观" />
          </ScrollReveal>

          <div className="grid md:grid-cols-3 gap-6">
            {VALUES.map((v, i) => (
              <ScrollReveal key={v.title} delay={i * 0.15}>
                <div className="bg-white rounded-card-lg p-8 shadow-card hover:shadow-card-hover transition-shadow h-full">
                  <div className="text-4xl mb-4">{v.icon}</div>
                  <h3 className="text-h3 text-text-primary mb-3">{v.title}</h3>
                  <p className="text-text-secondary leading-relaxed">{v.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* 团队 */}
      <section className="py-20 md:py-28 bg-light-surface">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="核心团队" subtitle="一群热爱农业和技术的人" />
          </ScrollReveal>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {TEAM_MEMBERS.map((member, i) => (
              <ScrollReveal key={member.name} delay={i * 0.1}>
                <div className="text-center">
                  <img
                    src={member.avatar}
                    alt={member.name}
                    className="w-24 h-24 md:w-32 md:h-32 rounded-full mx-auto mb-4 object-cover shadow-card"
                    loading="lazy"
                  />
                  <h3 className="font-semibold text-text-primary">{member.name}</h3>
                  <p className="text-brand text-sm font-medium">{member.role}</p>
                  <p className="text-text-tertiary text-sm mt-1">{member.bio}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>

          <ScrollReveal>
            <div className="mt-12 rounded-card-lg overflow-hidden">
              <img
                src={IMAGES.team.collaboration}
                alt="团队协作"
                className="w-full h-48 md:h-72 object-cover"
                loading="lazy"
              />
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* 时间线 */}
      <section className="py-20 md:py-28 bg-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="发展历程" subtitle="一步一脚印，走向未来" />
          </ScrollReveal>

          <div className="max-w-2xl mx-auto relative">
            {/* 竖线 */}
            <div className="absolute left-4 md:left-1/2 top-0 bottom-0 w-0.5 bg-gradient-to-b from-brand via-ai-start to-ai-glow md:-translate-x-1/2" />

            <div className="space-y-8">
              {TIMELINE.map((item, i) => (
                <ScrollReveal key={item.year} delay={i * 0.1}>
                  <div className={`relative flex items-start gap-8 ${i % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'}`}>
                    {/* 节点 */}
                    <div className="absolute left-4 md:left-1/2 w-3 h-3 rounded-full bg-ai-end border-4 border-light-bg -translate-x-1/2 mt-1.5 z-10" />

                    {/* 内容 */}
                    <div className={`ml-12 md:ml-0 md:w-[45%] ${i % 2 === 0 ? 'md:pr-8 md:text-right' : 'md:pl-8'}`}>
                      <span className="text-ai-start font-bold">{item.year}</span>
                      <h3 className="text-text-primary font-semibold text-lg">{item.title}</h3>
                      <p className="text-text-secondary text-sm mt-1">{item.desc}</p>
                    </div>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
