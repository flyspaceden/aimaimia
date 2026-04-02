import { useState, type FormEvent } from "react";
import ScrollReveal from "@/components/effects/ScrollReveal";
import Button from "@/components/ui/Button";
import { IMAGES } from "@/lib/constants";

type FormStatus = "idle" | "loading" | "success" | "error";

export default function Contact() {
  const [status, setStatus] = useState<FormStatus>("idle");

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("loading");

    // Formspree 或其他表单服务 — 占位实现
    // 替换 YOUR_FORM_ID 为实际 Formspree endpoint
    try {
      const form = e.currentTarget;
      const data = new FormData(form);

      // Honeypot 检查
      if (data.get("_honey")) return;

      // 占位：模拟提交成功
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setStatus("success");
      form.reset();
    } catch {
      setStatus("error");
    }
  };

  return (
    <>
      {/* Hero */}
      <section className="pt-32 pb-12 bg-gradient-to-b from-dark-bg to-dark-elevated">
        <div className="max-w-page mx-auto px-6 text-center">
          <h1 className="text-display-mobile md:text-display text-text-on-dark mb-4">
            与我们<span className="text-ai-gradient">取得联系</span>
          </h1>
          <p className="text-lg text-text-on-dark-secondary">
            商务合作、商户咨询、技术支持，我们随时为您服务
          </p>
        </div>
      </section>

      {/* 表单 + 信息 */}
      <section className="py-20 md:py-28 bg-light-bg">
        <div className="max-w-page mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-12">
            {/* 表单 */}
            <ScrollReveal>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Honeypot */}
                <input
                  type="text"
                  name="_honey"
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                />

                <div>
                  <label
                    htmlFor="name"
                    className="block text-sm font-medium text-text-primary mb-2"
                  >
                    姓名 *
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={50}
                    className="w-full px-4 py-3 rounded-card border border-light-soft bg-white text-text-primary focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                    placeholder="请输入您的姓名"
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-text-primary mb-2"
                  >
                    邮箱 *
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    className="w-full px-4 py-3 rounded-card border border-light-soft bg-white text-text-primary focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                    placeholder="your@163.com"
                  />
                </div>

                <div>
                  <label
                    htmlFor="subject"
                    className="block text-sm font-medium text-text-primary mb-2"
                  >
                    主题 *
                  </label>
                  <select
                    id="subject"
                    name="subject"
                    required
                    className="w-full px-4 py-3 rounded-card border border-light-soft bg-white text-text-primary focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
                  >
                    <option value="">请选择主题</option>
                    <option value="business">商务合作</option>
                    <option value="merchant">商户咨询</option>
                    <option value="tech">技术支持</option>
                    <option value="other">其他</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="message"
                    className="block text-sm font-medium text-text-primary mb-2"
                  >
                    消息 *
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    required
                    minLength={10}
                    maxLength={1000}
                    rows={5}
                    className="w-full px-4 py-3 rounded-card border border-light-soft bg-white text-text-primary focus:border-brand focus:ring-1 focus:ring-brand transition-colors resize-none"
                    placeholder="请描述您的需求..."
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={status === "loading"}
                >
                  {status === "loading" ? "发送中..." : "发送消息"}
                </Button>

                {status === "success" && (
                  <p className="text-brand font-medium text-center">
                    消息已发送，我们会尽快回复您！
                  </p>
                )}
                {status === "error" && (
                  <p className="text-red-500 font-medium text-center">
                    发送失败，请稍后重试或直接联系我们
                  </p>
                )}
              </form>
            </ScrollReveal>

            {/* 联系信息 */}
            <ScrollReveal delay={0.2}>
              <div className="space-y-8">
                <div>
                  <h3 className="text-h3 text-text-primary mb-6">联系方式</h3>
                  <div className="space-y-4">
                    {[
                      {
                        icon: "📍",
                        label: "地址",
                        value: "中国 · 深圳市南山区科技园",
                      },
                      { icon: "📞", label: "电话", value: "13923710623" },
                      {
                        icon: "✉️",
                        label: "邮箱",
                        value: "zenweifeng3@163.com",
                      },
                      {
                        icon: "🕐",
                        label: "工作时间",
                        value: "周一至周五 9:00-18:00",
                      },
                    ].map((item) => (
                      <div key={item.label} className="flex items-start gap-4">
                        <span className="text-2xl">{item.icon}</span>
                        <div>
                          <p className="text-text-tertiary text-sm">
                            {item.label}
                          </p>
                          <p className="text-text-primary font-medium">
                            {item.value}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 地图占位 */}
                <div className="rounded-card-lg overflow-hidden border border-light-soft">
                  <img
                    src={IMAGES.team.office}
                    alt="办公地点"
                    className="w-full h-48 object-cover"
                    loading="lazy"
                  />
                  <div className="p-4 bg-white text-center">
                    <a
                      href="https://www.amap.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand text-sm hover:underline"
                    >
                      在高德地图中查看 →
                    </a>
                  </div>
                </div>

                {/* 社交媒体 */}
                <div>
                  <h4 className="text-text-primary font-semibold mb-3">
                    关注我们
                  </h4>
                  <div className="flex gap-4">
                    {["微信公众号", "微博", "抖音"].map((platform) => (
                      <span
                        key={platform}
                        className="px-4 py-2 rounded-pill text-sm bg-light-surface text-text-secondary border border-light-soft hover:border-brand hover:text-brand transition-colors cursor-pointer"
                      >
                        {platform}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>
    </>
  );
}
