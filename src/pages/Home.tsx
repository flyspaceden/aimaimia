import { useState } from "react";
import ParticleCanvas from "@/components/effects/ParticleCanvas";
import HeroOrb from "@/components/effects/HeroOrb";
import ScrollReveal from "@/components/effects/ScrollReveal";
import CountUp from "@/components/effects/CountUp";
import SectionHeading from "@/components/ui/SectionHeading";
import Button from "@/components/ui/Button";
import DownloadModal from "@/components/ui/DownloadModal";
import { IMAGES, STATS } from "@/lib/constants";

const CORE_VALUES = [
  {
    icon: "🤖",
    title: "AI",
    desc: "深度学习驱动的AI推荐、语义搜索和语音交互，让购物更懂你",
    image: IMAGES.tech.ai,
  },
  {
    icon: "🌿",
    title: "品质溯源",
    desc: "从种子到餐桌全链路追踪，每一份食材都有完整的品质档案",
    image: `${import.meta.env.BASE_URL}images/home/品质溯源.jpg`,
  },
  {
    icon: "🤝",
    title: "AI农业",
    desc: "零门槛入驻、AI定价，让好产品卖出好价钱",
    image: `${import.meta.env.BASE_URL}images/home/AI农业.png`,
  },
];

const PLATFORM_FEATURES = [
  {
    title: "买家端 App",
    desc: "AI搜索、AI 溯源、语音助手、一键下单，全方位AI购物体验",
    image: IMAGES.produce.fruits,
    features: ["语义搜索", "品质溯源", "AI推荐", "语音助手"],
  },
  {
    title: "卖家后台",
    desc: "订单管理、数据分析、AI 定价、物流对接，轻松经营每一天",
    image: IMAGES.tech.dataViz,
    features: ["订单管理", "数据分析", "AI定价", "物流追踪"],
  },
  {
    title: "AI 助手",
    desc: "自然语言交互、意图理解、个性化推荐，你的专属农产品顾问",
    image: IMAGES.tech.network,
    features: ["语音交互", "意图识别", "个性化推荐", "AI客服"],
  },
];

export default function Home() {
  const [downloadOpen, setDownloadOpen] = useState(false);

  return (
    <>
      {/* ======== Hero 段 ======== */}
      <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-b from-dark-bg via-dark-surface to-dark-elevated overflow-hidden">
        <ParticleCanvas particleCount={20} />

        <div className="relative z-10 text-center px-6">
          <HeroOrb size={180} className="mx-auto mb-8" />

          <h1 className="text-display-mobile md:text-display text-text-on-dark mb-4">
            AI赋能，<span className="text-ai-gradient">从田间到餐桌</span>
          </h1>
          <p className="text-lg md:text-xl text-text-on-dark-secondary max-w-xl mx-auto mb-8">
            AI溯源 · 品质保障 · 让每一粒粮食都有AI的脉搏
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" onClick={() => setDownloadOpen(true)}>
              下载 App
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() =>
                document
                  .getElementById("values")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              了解更多 ↓
            </Button>
          </div>
        </div>

        {/* 底部渐变过渡 */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-b from-transparent to-dark-elevated" />
      </section>

      {/* ======== 核心价值 段 ======== */}
      <section
        id="values"
        className="py-20 md:py-28 bg-gradient-to-b from-dark-elevated to-dark-surface"
      >
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading
              title="为什么选择AI爱买买"
              subtitle="AI + 农业 + 直销，三位一体的AI平台"
              light={false}
            />
          </ScrollReveal>

          <div className="grid md:grid-cols-3 gap-6 md:gap-8">
            {CORE_VALUES.map((item, i) => (
              <ScrollReveal key={item.title} delay={i * 0.15}>
                <div className="group rounded-card-lg overflow-hidden bg-dark-elevated border border-white/5 hover:border-ai-start/30 transition-all duration-300 hover:shadow-ai-glow">
                  <div className="h-48 overflow-hidden">
                    <img
                      src={item.image}
                      alt={item.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                  </div>
                  <div className="p-6">
                    <div className="text-3xl mb-3">{item.icon}</div>
                    <h3 className="text-h3-mobile md:text-h3 text-text-on-dark mb-2">
                      {item.title}
                    </h3>
                    <p className="text-text-on-dark-secondary leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ======== 平台能力 段 ======== */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-dark-surface via-[#0D1A0D] to-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading
              title="一个平台，全链路覆盖"
              subtitle="买家、卖家、平台，每个角色都有专属体验"
              light={false}
            />
          </ScrollReveal>

          <div className="space-y-16 md:space-y-24">
            {PLATFORM_FEATURES.map((feat, i) => (
              <ScrollReveal key={feat.title}>
                <div
                  className={`flex flex-col ${i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"} gap-8 md:gap-12 items-center`}
                >
                  <div className="flex-1">
                    <h3
                      className={`text-h2-mobile md:text-h2 mb-4 ${i < 2 ? "text-text-on-dark" : "text-text-primary"}`}
                    >
                      {feat.title}
                    </h3>
                    <p
                      className={`text-lg mb-6 leading-relaxed ${i < 2 ? "text-text-on-dark-secondary" : "text-text-secondary"}`}
                    >
                      {feat.desc}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {feat.features.map((f) => (
                        <span
                          key={f}
                          className="px-4 py-1.5 rounded-pill text-sm font-medium bg-brand/10 text-brand border border-brand/20"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1">
                    <img
                      src={feat.image}
                      alt={feat.title}
                      className="w-full rounded-card-lg shadow-card"
                      loading="lazy"
                    />
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ======== 数据亮点 段 ======== */}
      <section className="py-20 md:py-28 bg-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading title="数据见证实力" />
          </ScrollReveal>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map((stat, i) => (
              <ScrollReveal key={stat.label} delay={i * 0.1}>
                <div className="text-center">
                  <div className="text-h1-mobile md:text-h1 text-brand font-bold">
                    <CountUp target={stat.value} suffix={stat.suffix} />
                  </div>
                  <div className="text-text-secondary mt-2">{stat.label}</div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ======== 合作伙伴（滚动）======== */}
      <section className="py-12 bg-light-surface overflow-hidden">
        <div className="max-w-page mx-auto px-6 text-center">
          <p className="text-text-tertiary text-sm mb-6">
            信赖AI爱买买的合作伙伴
          </p>
          <div className="relative">
            <div className="flex animate-marquee gap-16 whitespace-nowrap">
              {[...Array(2)].map((_, loop) =>
                [
                  "中国农业大学",
                  "阿里云",
                  "高德地图",
                  "讯飞语音",
                  "顺丰速运",
                  "中国邮政",
                  "京东物流",
                ].map((name) => (
                  <span
                    key={`${loop}-${name}`}
                    className="text-text-secondary/40 font-semibold text-lg md:text-xl flex-shrink-0"
                  >
                    {name}
                  </span>
                )),
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ======== 下载 CTA 段 ======== */}
      <section className="py-20 md:py-28 bg-gradient-to-r from-brand via-ai-start to-ai-end relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <img
            src={IMAGES.agriculture.riceField}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
        <div className="relative z-10 max-w-page mx-auto px-6 text-center">
          <ScrollReveal>
            <h2 className="text-h1-mobile md:text-h1 text-white mb-4">
              开启AI农业之旅
            </h2>
            <p className="text-lg text-white/80 mb-8 max-w-lg mx-auto">
              下载AI爱买买 App，体验 AI 驱动的农产品购物
            </p>
            <Button
              variant="gold"
              size="lg"
              onClick={() => setDownloadOpen(true)}
            >
              立即下载
            </Button>
          </ScrollReveal>
        </div>
      </section>

      <DownloadModal
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
      />
    </>
  );
}
