# 爱买买官网 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 6-page brand website for 爱买买 with dark-to-light narrative flow, particle effects, scroll animations, and real Unsplash/Pexels imagery.

**Architecture:** Standalone Vite + React SPA in `website/` directory. React Router for page navigation, GSAP ScrollTrigger for scroll-driven animations, Canvas for particle effects, Tailwind CSS for styling. All images sourced from Unsplash via direct URLs.

**Tech Stack:** Vite 7 + React 19 + TypeScript + GSAP 3 (ScrollTrigger) + Tailwind CSS 3.4 + React Router 7

**Spec:** `docs/superpowers/specs/2026-03-23-aimaimai-website-design.md`

---

## File Map

```
website/
├── index.html                          # HTML 入口，lang="zh-CN"，SEO meta
├── package.json                        # 依赖声明
├── vite.config.ts                      # Vite 配置，port 5175
├── tailwind.config.ts                  # Tailwind 主题扩展
├── postcss.config.js                   # PostCSS 配置（Tailwind + autoprefixer）
├── tsconfig.json                       # TypeScript 配置
├── public/
│   ├── favicon.ico                     # 网站图标
│   ├── robots.txt                      # 爬虫规则
│   └── sitemap.xml                     # 站点地图
└── src/
    ├── main.tsx                        # React 入口
    ├── App.tsx                         # 路由配置 + 全局布局
    ├── styles/
    │   └── globals.css                 # Tailwind 入口 + CSS 变量 + 自定义动画
    ├── components/
    │   ├── layout/
    │   │   ├── Navbar.tsx              # 全局导航栏（毛玻璃 + 汉堡菜单）
    │   │   └── Footer.tsx              # 全局 Footer（暗色四列）
    │   ├── effects/
    │   │   ├── ParticleCanvas.tsx       # Canvas 粒子系统（连线 + 浮动）
    │   │   ├── HeroOrb.tsx             # AI 光球（渐变 + 呼吸 + 鼠标跟随）
    │   │   ├── CountUp.tsx             # 数字递增动画
    │   │   └── ScrollReveal.tsx        # 滚动淡入动画包裹器
    │   └── ui/
    │       ├── Button.tsx              # 按钮（primary/secondary/ghost 变体）
    │       ├── SectionHeading.tsx       # 段落标题（标题 + 副标题 + 装饰线）
    │       └── DownloadModal.tsx        # 下载弹窗（二维码 + 即将上线）
    ├── pages/
    │   ├── Home.tsx                    # 首页（6 段）
    │   ├── Products.tsx               # 产品功能页（5 段）
    │   ├── AiTech.tsx                 # AI 技术页（6 段）
    │   ├── About.tsx                  # 关于我们页（5 段）
    │   ├── Merchants.tsx              # 商户入驻页（6 段）
    │   ├── Contact.tsx                # 联系我们页（3 段）
    │   └── NotFound.tsx               # 404 页面
    └── lib/
        ├── animations.ts              # GSAP ScrollTrigger 工具函数
        ├── constants.ts               # 文案、图片 URL、统计数字
        └── useReducedMotion.ts         # prefers-reduced-motion hook
```

---

## Task 1: Project Scaffolding

**Files:**

- Create: `website/package.json`
- Create: `website/index.html`
- Create: `website/vite.config.ts`
- Create: `website/tsconfig.json`
- Create: `website/tailwind.config.ts`
- Create: `website/postcss.config.js`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "aimaimai-website",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router-dom": "^7.13.0",
    "gsap": "^3.12.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.7",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.5.3",
    "tailwindcss": "3.4.17",
    "typescript": "~5.9.3",
    "vite": "^7.3.1"
  }
}
```

- [ ] **Step 2: Create index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      name="description"
      content="AI 驱动的农业电商平台，智能溯源、品质保障，从田间到餐桌的智慧连接"
    />
    <meta property="og:title" content="爱买买 — AI赋能农业电商平台" />
    <meta
      property="og:description"
      content="AI 驱动的农业电商平台，智能溯源、品质保障，从田间到餐桌的智慧连接"
    />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="爱买买 — AI赋能农业电商平台" />
    <meta
      name="twitter:description"
      content="AI 驱动的农业电商平台，智能溯源、品质保障，从田间到餐桌的智慧连接"
    />
    <meta name="twitter:image" content="/og-image.png" />
    <link rel="icon" href="/favicon.ico" />
    <title>爱买买 — AI赋能农业电商平台</title>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "爱买买",
        "description": "AI赋能农业电商平台",
        "url": "https://aimaimai.com"
      }
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5175,
  },
});
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create tailwind.config.ts**

```typescript
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#2E7D32",
          light: "#4CAF50",
          dark: "#1B5E20",
          soft: "#E8F5E9",
        },
        ai: {
          start: "#00897B",
          end: "#00BFA5",
          glow: "#00E5CC",
          soft: "#E0F7F4",
        },
        gold: {
          DEFAULT: "#D4A017",
          light: "#F5C842",
        },
        dark: {
          bg: "#060E06",
          surface: "#0D1A0D",
          elevated: "#1A2A1A",
        },
        light: {
          bg: "#FAFCFA",
          surface: "#F0F4F0",
          soft: "#E8F5E9",
        },
        text: {
          primary: "#1A2E1A",
          secondary: "#5A6B5A",
          tertiary: "#8A9B8A",
          "on-dark": "#FFFFFF",
          "on-dark-secondary": "#B0C4B0",
          "on-dark-tertiary": "#8A9B8A",
        },
      },
      fontFamily: {
        sans: [
          '"PingFang SC"',
          '"Noto Sans SC"',
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "sans-serif",
        ],
        mono: ['"SF Mono"', '"JetBrains Mono"', "monospace"],
      },
      fontSize: {
        display: ["64px", { lineHeight: "1.1", fontWeight: "700" }],
        "display-mobile": ["36px", { lineHeight: "1.2", fontWeight: "700" }],
        h1: ["48px", { lineHeight: "1.15", fontWeight: "700" }],
        "h1-mobile": ["28px", { lineHeight: "1.2", fontWeight: "700" }],
        h2: ["36px", { lineHeight: "1.2", fontWeight: "600" }],
        "h2-mobile": ["24px", { lineHeight: "1.3", fontWeight: "600" }],
        h3: ["24px", { lineHeight: "1.3", fontWeight: "600" }],
        "h3-mobile": ["20px", { lineHeight: "1.4", fontWeight: "600" }],
      },
      borderRadius: {
        card: "16px",
        "card-lg": "24px",
        pill: "999px",
      },
      boxShadow: {
        card: "0 4px 20px rgba(10,43,22,0.08)",
        "card-hover": "0 8px 40px rgba(10,43,22,0.12)",
        "ai-glow": "0 0 60px rgba(0,191,165,0.25)",
        "ai-glow-lg": "0 0 120px rgba(0,191,165,0.15)",
      },
      maxWidth: {
        page: "1200px",
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 6: Create postcss.config.js**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 7: Install dependencies**

Run: `cd website && npm install`

- [ ] **Step 8: Verify dev server starts**

Run: `cd website && npm run dev`
Expected: Server running at http://localhost:5175

- [ ] **Step 9: Commit**

```bash
git add website/package.json website/package-lock.json website/index.html website/vite.config.ts website/tsconfig.json website/tailwind.config.ts website/postcss.config.js
git commit -m "feat(website): scaffold Vite + React + Tailwind project"
```

---

## Task 2: Global Styles + Utility Hooks + Constants

**Files:**

- Create: `website/src/styles/globals.css`
- Create: `website/src/lib/useReducedMotion.ts`
- Create: `website/src/lib/animations.ts`
- Create: `website/src/lib/constants.ts`
- Create: `website/src/main.tsx`

- [ ] **Step 1: Create globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    /* 注意：不设置 scroll-behavior: smooth，避免与 GSAP ScrollTrigger 冲突 */
  }

  body {
    @apply font-sans text-text-primary bg-light-bg antialiased;
  }

  /* 全局 focus 样式 */
  :focus-visible {
    @apply outline-2 outline-offset-2 outline-brand;
  }

  /* Skip to content */
  .skip-to-content {
    @apply absolute -top-10 left-4 z-[100] bg-brand text-white px-4 py-2 rounded-md transition-all;
  }
  .skip-to-content:focus {
    @apply top-4;
  }
}

@layer components {
  /* 暗明过渡段落 */
  .section-dark {
    @apply bg-dark-bg text-text-on-dark;
  }
  .section-light {
    @apply bg-light-bg text-text-primary;
  }

  /* AI 渐变文字 */
  .text-ai-gradient {
    @apply bg-clip-text text-transparent bg-gradient-to-r from-ai-start via-ai-end to-ai-glow;
  }

  /* AI 渐变边框 */
  .border-ai-gradient {
    border-image: linear-gradient(135deg, #2e7d32, #00897b, #00bfa5) 1;
  }
}

@layer utilities {
  /* prefers-reduced-motion 全局降级 */
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
}

/* 合作伙伴滚动动画 */
@keyframes marquee {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(-50%);
  }
}
.animate-marquee {
  animation: marquee 25s linear infinite;
}
```

- [ ] **Step 2: Create useReducedMotion.ts**

```typescript
import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}
```

- [ ] **Step 3: Create animations.ts**

```typescript
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

/** 批量注册淡入上移动画 */
export function initScrollReveal(selector: string = ".reveal") {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // 直接显示，不动画
    gsap.set(selector, { opacity: 1, y: 0 });
    return;
  }

  gsap.utils.toArray<HTMLElement>(selector).forEach((el) => {
    gsap.fromTo(
      el,
      { opacity: 0, y: 40 },
      {
        opacity: 1,
        y: 0,
        duration: 0.8,
        ease: "power2.out",
        scrollTrigger: {
          trigger: el,
          start: "top 85%",
          once: true,
        },
      },
    );
  });
}

/** 数字递增动画 */
export function animateCountUp(
  el: HTMLElement,
  target: number,
  suffix: string = "",
) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = target.toLocaleString() + suffix;
    return;
  }

  const obj = { val: 0 };
  gsap.to(obj, {
    val: target,
    duration: 2,
    ease: "power1.out",
    scrollTrigger: {
      trigger: el,
      start: "top 80%",
      once: true,
    },
    onUpdate: () => {
      el.textContent = Math.round(obj.val).toLocaleString() + suffix;
    },
  });
}
```

- [ ] **Step 4: Create constants.ts**

This file contains all copy text, image URLs, and data. Every Unsplash image uses direct URL format for high quality.

```typescript
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
    greenField:
      "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200&q=80", // 绿色麦田
    greenhouse:
      "https://images.unsplash.com/photo-1585500001096-aec5c3a83dab?w=1200&q=80", // 温室大棚
    farmer:
      "https://images.unsplash.com/photo-1574943320219-553eb213f72d?w=1200&q=80", // 农民劳作
    riceField:
      "https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?w=1200&q=80", // 稻田
    orchard:
      "https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1200&q=80", // 果园丰收
  },
  // 新鲜农产品
  produce: {
    vegetables:
      "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=1200&q=80", // 新鲜蔬菜
    fruits:
      "https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=1200&q=80", // 水果拼盘
    organic:
      "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=1200&q=80", // 有机食材
    market:
      "https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200&q=80", // 农产品市场
  },
  // 科技/AI
  tech: {
    dataViz:
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&q=80", // 数据可视化
    network:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&q=80", // 网络连接
    ai: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&q=80", // AI 抽象
    circuit:
      "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&q=80", // 电路板
  },
  // 物流
  logistics: {
    warehouse:
      "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=1200&q=80", // 仓储
    delivery:
      "https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=1200&q=80", // 配送
    coldChain:
      "https://images.unsplash.com/photo-1494412574643-ff11b0a5eb19?w=1200&q=80", // 冷链
  },
  // 团队/商务
  team: {
    meeting:
      "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&q=80", // 团队会议
    office:
      "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80", // 办公场景
    collaboration:
      "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1200&q=80", // 协作
    handshake:
      "https://images.unsplash.com/photo-1521791136064-7986c2920216?w=1200&q=80", // 握手合作
  },
  // 手机设备
  devices: {
    phoneHand:
      "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=800&q=80", // 手持手机
    phoneDark:
      "https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=800&q=80", // 暗色手机
  },
} as const;

// ============================================
// 统计数据（展示用）
// ============================================
export const STATS = [
  { label: "注册用户", value: 500000, suffix: "+" },
  { label: "入驻商户", value: 8000, suffix: "+" },
  { label: "AI溯源覆盖", value: 98, suffix: "%" },
  { label: "累计交易额", value: 10, suffix: "亿+" },
] as const;

// ============================================
// 导航链接
// ============================================
export const NAV_LINKS = [
  { label: "首页", path: "/" },
  { label: "产品功能", path: "/products" },
  { label: "AI 技术", path: "/ai" },
  { label: "关于我们", path: "/about" },
  { label: "商户入驻", path: "/merchants" },
  { label: "联系我们", path: "/contact" },
] as const;

// ============================================
// 页面 SEO 配置
// ============================================
export const PAGE_META: Record<string, { title: string; description: string }> =
  {
    "/": {
      title: "爱买买 — AI赋能农业电商平台",
      description:
        "AI 驱动的农业电商平台，智能溯源、品质保障，从田间到餐桌的智慧连接",
    },
    "/products": {
      title: "产品功能 — 爱买买",
      description:
        "买家端智能搜索、卖家端数据分析、AI 助手，一站式农产品交易体验",
    },
    "/ai": {
      title: "AI 技术 — 爱买买",
      description: "AI 溯源、语义搜索、语音助手，用人工智能重新定义农产品电商",
    },
    "/about": {
      title: "关于我们 — 爱买买",
      description: "让农业拥抱智能时代，了解爱买买的使命、团队与发展历程",
    },
    "/merchants": {
      title: "商户入驻 — 爱买买",
      description: "零门槛入驻、AI 智能定价、流量扶持，与爱买买共创农业未来",
    },
    "/contact": {
      title: "联系我们 — 爱买买",
      description: "商务合作、商户咨询、技术支持，与爱买买取得联系",
    },
  };

// ============================================
// 团队成员（占位）
// ============================================
export const TEAM_MEMBERS = [
  {
    name: "张明远",
    role: "CEO & 创始人",
    bio: "连续创业者，深耕农业科技10年",
    avatar:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80",
  },
  {
    name: "李芳华",
    role: "CTO",
    bio: "AI 算法专家，前大厂技术总监",
    avatar:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80",
  },
  {
    name: "王建国",
    role: "产品VP",
    bio: "电商产品专家，主导多个千万级项目",
    avatar:
      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&q=80",
  },
  {
    name: "陈晓梅",
    role: "运营总监",
    bio: "农业供应链专家，助力乡村振兴",
    avatar:
      "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&q=80",
  },
] as const;

// ============================================
// 发展历程
// ============================================
export const TIMELINE = [
  {
    year: "2024",
    title: "项目启动",
    desc: "核心团队组建，完成产品设计和技术选型",
  },
  {
    year: "2024 Q3",
    title: "技术研发",
    desc: "AI 溯源引擎和语义搜索系统开发完成",
  },
  {
    year: "2025 Q1",
    title: "平台上线",
    desc: "买家 App 和卖家后台正式上线运营",
  },
  {
    year: "2025 Q3",
    title: "快速增长",
    desc: "入驻商户突破 5000 家，覆盖全国 20 省",
  },
  { year: "2026", title: "生态扩展", desc: "AI 语音助手上线，开放平台 API" },
] as const;

// ============================================
// 成功案例
// ============================================
export const SUCCESS_STORIES = [
  {
    name: "绿源果业",
    image: IMAGES.agriculture.orchard,
    stat: "月销量增长 320%",
    quote:
      "入驻爱买买后，AI 定价让我们的水果卖出了合理的好价钱，再也不用担心被压价。",
  },
  {
    name: "田园农场",
    image: IMAGES.agriculture.greenhouse,
    stat: "客户复购率 85%",
    quote: "AI 溯源功能让消费者看到我们的种植过程，信任感大大提升。",
  },
  {
    name: "阳光蔬菜合作社",
    image: IMAGES.produce.vegetables,
    stat: "运营成本降低 40%",
    quote: "智能订单管理和物流对接节省了大量人工，我们能专注于种好菜。",
  },
] as const;
```

- [ ] **Step 5: Create main.tsx**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 6: Commit**

```bash
git add website/src/
git commit -m "feat(website): add global styles, animations lib, constants and entry point"
```

---

## Task 3: Effect Components (ParticleCanvas + HeroOrb + ScrollReveal + CountUp)

**Files:**

- Create: `website/src/components/effects/ParticleCanvas.tsx`
- Create: `website/src/components/effects/HeroOrb.tsx`
- Create: `website/src/components/effects/ScrollReveal.tsx`
- Create: `website/src/components/effects/CountUp.tsx`

- [ ] **Step 1: Create ParticleCanvas.tsx**

Canvas-based particle system with connecting lines. Respects `prefers-reduced-motion`.

```tsx
import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/useReducedMotion";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  opacity: number;
}

interface Props {
  particleCount?: number;
  className?: string;
}

const COLORS = ["#00BFA5", "#4CAF50", "#00E5CC", "#00897B"];

export default function ParticleCanvas({
  particleCount = 16,
  className = "",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || reduced) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let particles: Particle[] = [];

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    const isMobile = window.innerWidth < 768;
    const count = isMobile ? Math.floor(particleCount / 2) : particleCount;

    const init = () => {
      resize();
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * canvas.offsetWidth,
        y: Math.random() * canvas.offsetHeight,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: Math.random() * 2 + 1,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        opacity: Math.random() * 0.5 + 0.2,
      }));
    };

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      // 更新 & 绘制粒子
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity;
        ctx.fill();
      }

      // 粒子连线
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = "#00BFA5";
            ctx.globalAlpha = 0.1 * (1 - dist / 120);
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;

      animId = requestAnimationFrame(draw);
    };

    init();
    draw();

    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [particleCount, reduced]);

  if (reduced) return null;

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
      role="img"
      aria-label="装饰性粒子动画背景"
    />
  );
}
```

- [ ] **Step 2: Create HeroOrb.tsx**

```tsx
import { useEffect, useRef } from "react";
import { gsap } from "@/lib/animations";
import { useReducedMotion } from "@/lib/useReducedMotion";

interface Props {
  size?: number;
  className?: string;
}

export default function HeroOrb({ size = 200, className = "" }: Props) {
  const orbRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const orb = orbRef.current;
    if (!orb || reduced) return;

    // 呼吸动画
    const breathe = gsap.to(orb, {
      scale: 1.05,
      duration: 3,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
    });

    // 鼠标跟随（仅桌面端）
    const isMobile = window.innerWidth < 768;
    let moveX: gsap.QuickToFunc | undefined;
    let moveY: gsap.QuickToFunc | undefined;

    if (!isMobile) {
      moveX = gsap.quickTo(orb, "x", { duration: 0.3, ease: "power2.out" });
      moveY = gsap.quickTo(orb, "y", { duration: 0.3, ease: "power2.out" });

      const handleMouse = (e: MouseEvent) => {
        const rect = orb.parentElement?.getBoundingClientRect();
        if (!rect) return;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = ((e.clientX - cx) / rect.width) * 30;
        const dy = ((e.clientY - cy) / rect.height) * 30;
        moveX!(dx);
        moveY!(dy);
      };

      window.addEventListener("mousemove", handleMouse);
      return () => {
        breathe.kill();
        window.removeEventListener("mousemove", handleMouse);
      };
    }

    return () => breathe.kill();
  }, [reduced]);

  return (
    <div
      ref={orbRef}
      className={`relative ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label="AI 智能光球"
    >
      {/* 外层光晕 */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(0,229,204,0.2) 0%, transparent 70%)",
          filter: "blur(60px)",
          transform: "scale(1.5)",
        }}
      />
      {/* 主球体 */}
      <div
        className="absolute inset-0 rounded-full shadow-ai-glow"
        style={{
          background:
            "radial-gradient(circle at 40% 35%, #00E5CC 0%, #00BFA5 30%, #00897B 60%, transparent 80%)",
        }}
      />
      {/* 内核高光 */}
      <div
        className="absolute rounded-full"
        style={{
          width: size * 0.15,
          height: size * 0.15,
          top: "30%",
          left: "35%",
          background:
            "radial-gradient(circle, rgba(255,255,255,0.8) 0%, transparent 70%)",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Create ScrollReveal.tsx**

```tsx
import { useEffect, useRef, type ReactNode } from "react";
import { gsap, ScrollTrigger } from "@/lib/animations";
import { useReducedMotion } from "@/lib/useReducedMotion";

interface Props {
  children: ReactNode;
  className?: string;
  delay?: number;
}

export default function ScrollReveal({
  children,
  className = "",
  delay = 0,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;

    gsap.fromTo(
      el,
      { opacity: 0, y: 40 },
      {
        opacity: 1,
        y: 0,
        duration: 0.8,
        delay,
        ease: "power2.out",
        scrollTrigger: {
          trigger: el,
          start: "top 85%",
          once: true,
        },
      },
    );

    return () => {
      ScrollTrigger.getAll().forEach((t) => {
        if (t.trigger === el) t.kill();
      });
    };
  }, [delay, reduced]);

  return (
    <div
      ref={ref}
      className={className}
      style={reduced ? undefined : { opacity: 0 }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Create CountUp.tsx**

```tsx
import { useEffect, useRef } from "react";
import { animateCountUp } from "@/lib/animations";

interface Props {
  target: number;
  suffix?: string;
  className?: string;
}

export default function CountUp({
  target,
  suffix = "",
  className = "",
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ref.current) {
      animateCountUp(ref.current, target, suffix);
    }
  }, [target, suffix]);

  return (
    <span ref={ref} className={className}>
      0
    </span>
  );
}
```

- [ ] **Step 5: Verify TypeScript compilation**

Run: `cd website && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add website/src/components/effects/
git commit -m "feat(website): add particle canvas, hero orb, scroll reveal, and count-up effects"
```

---

## Task 4: UI Components (Button + SectionHeading + DownloadModal)

**Files:**

- Create: `website/src/components/ui/Button.tsx`
- Create: `website/src/components/ui/SectionHeading.tsx`
- Create: `website/src/components/ui/DownloadModal.tsx`

- [ ] **Step 1: Create Button.tsx**

```tsx
import { type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "gold";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-gradient-to-r from-brand to-ai-start text-white hover:shadow-card-hover",
  secondary: "border-2 border-brand text-brand hover:bg-brand hover:text-white",
  ghost:
    "text-text-on-dark-secondary hover:text-white border border-white/20 hover:border-white/40",
  gold: "bg-gradient-to-r from-gold to-gold-light text-white hover:shadow-card-hover",
};

const sizeClasses = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-3 text-base",
  lg: "px-8 py-4 text-lg",
};

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-pill font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Create SectionHeading.tsx**

```tsx
interface Props {
  title: string;
  subtitle?: string;
  light?: boolean;
  className?: string;
}

export default function SectionHeading({
  title,
  subtitle,
  light = true,
  className = "",
}: Props) {
  return (
    <div className={`text-center mb-12 md:mb-16 ${className}`}>
      <h2
        className={`text-h2-mobile md:text-h2 ${light ? "text-text-primary" : "text-text-on-dark"}`}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          className={`mt-4 text-lg max-w-2xl mx-auto ${light ? "text-text-secondary" : "text-text-on-dark-secondary"}`}
        >
          {subtitle}
        </p>
      )}
      <div className="mt-6 mx-auto w-16 h-0.5 bg-gradient-to-r from-brand via-ai-start to-ai-end rounded-full" />
    </div>
  );
}
```

- [ ] **Step 3: Create DownloadModal.tsx**

```tsx
import { useEffect, useRef } from "react";
import Button from "./Button";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function DownloadModal({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="backdrop:bg-black/60 bg-white rounded-card-lg p-8 max-w-sm mx-auto"
      onClose={onClose}
    >
      <div className="text-center">
        <h3 className="text-h3 text-text-primary mb-2">下载爱买买 App</h3>
        <p className="text-text-secondary mb-6">
          扫描二维码下载，或等待应用商店上架
        </p>

        {/* 二维码占位 */}
        <div className="w-48 h-48 mx-auto bg-light-surface rounded-card flex items-center justify-center mb-6 border border-light-soft">
          <div className="text-center text-text-tertiary">
            <div className="text-4xl mb-2">📱</div>
            <div className="text-sm">二维码即将生成</div>
          </div>
        </div>

        <p className="text-sm text-ai-start font-semibold mb-6">
          即将上线，敬请期待
        </p>

        <Button variant="secondary" size="sm" onClick={onClose}>
          关闭
        </Button>
      </div>
    </dialog>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add website/src/components/ui/
git commit -m "feat(website): add Button, SectionHeading, and DownloadModal components"
```

---

## Task 5: Layout Components (Navbar + Footer) + App Router

**Files:**

- Create: `website/src/components/layout/Navbar.tsx`
- Create: `website/src/components/layout/Footer.tsx`
- Create: `website/src/App.tsx`

- [ ] **Step 1: Create Navbar.tsx**

```tsx
import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { NAV_LINKS } from "@/lib/constants";
import Button from "@/components/ui/Button";
import DownloadModal from "@/components/ui/DownloadModal";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // 路由变化关闭菜单
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const toggleMenu = useCallback(() => setMenuOpen((v) => !v), []);

  return (
    <>
      <a href="#main-content" className="skip-to-content">
        跳到主要内容
      </a>

      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-dark-bg/80 backdrop-blur-xl shadow-lg"
            : "bg-transparent"
        }`}
      >
        <nav className="max-w-page mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand to-ai-end" />
            <span className="text-white font-bold text-lg">爱买买</span>
          </Link>

          {/* 桌面导航 */}
          <div className="hidden md:flex items-center gap-7">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`text-sm transition-colors relative ${
                  location.pathname === link.path
                    ? "text-white font-medium"
                    : "text-text-on-dark-secondary hover:text-white"
                }`}
              >
                {link.label}
                {location.pathname === link.path && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-brand-light" />
                )}
              </Link>
            ))}
          </div>

          {/* CTA + 汉堡 */}
          <div className="flex items-center gap-4">
            <Button
              size="sm"
              className="hidden md:inline-flex"
              onClick={() => setDownloadOpen(true)}
            >
              下载 App
            </Button>

            {/* 汉堡菜单按钮 */}
            <button
              className="md:hidden text-white p-2"
              onClick={toggleMenu}
              aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
              aria-expanded={menuOpen}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                {menuOpen ? (
                  <path d="M18 6L6 18M6 6l12 12" />
                ) : (
                  <path d="M3 12h18M3 6h18M3 18h18" />
                )}
              </svg>
            </button>
          </div>
        </nav>

        {/* 移动端菜单 */}
        {menuOpen && (
          <div className="md:hidden bg-dark-bg/95 backdrop-blur-xl border-t border-white/10">
            <div className="px-6 py-4 flex flex-col gap-3">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`py-2 text-base ${
                    location.pathname === link.path
                      ? "text-white font-medium"
                      : "text-text-on-dark-secondary"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <Button
                size="sm"
                className="mt-2"
                onClick={() => setDownloadOpen(true)}
              >
                下载 App
              </Button>
            </div>
          </div>
        )}
      </header>

      <DownloadModal
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
      />
    </>
  );
}
```

- [ ] **Step 2: Create Footer.tsx**

```tsx
import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="bg-dark-bg text-text-on-dark-secondary">
      <div className="max-w-page mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* 品牌 */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand to-ai-end" />
              <span className="text-white font-bold text-lg">爱买买</span>
            </div>
            <p className="text-sm leading-relaxed">
              AI赋能农业电商平台
              <br />
              从田间到餐桌的智慧连接
            </p>
          </div>

          {/* 产品 */}
          <div>
            <h4 className="text-white font-semibold mb-4">产品</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  to="/products"
                  className="hover:text-white transition-colors"
                >
                  买家 App
                </Link>
              </li>
              <li>
                <Link
                  to="/products"
                  className="hover:text-white transition-colors"
                >
                  卖家后台
                </Link>
              </li>
              <li>
                <Link
                  to="/products"
                  className="hover:text-white transition-colors"
                >
                  管理平台
                </Link>
              </li>
            </ul>
          </div>

          {/* 技术 */}
          <div>
            <h4 className="text-white font-semibold mb-4">技术</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/ai" className="hover:text-white transition-colors">
                  AI 溯源
                </Link>
              </li>
              <li>
                <Link to="/ai" className="hover:text-white transition-colors">
                  智能搜索
                </Link>
              </li>
              <li>
                <Link to="/ai" className="hover:text-white transition-colors">
                  语音助手
                </Link>
              </li>
            </ul>
          </div>

          {/* 合作 */}
          <div>
            <h4 className="text-white font-semibold mb-4">合作</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  to="/merchants"
                  className="hover:text-white transition-colors"
                >
                  商户入驻
                </Link>
              </li>
              <li>
                <Link
                  to="/about"
                  className="hover:text-white transition-colors"
                >
                  关于我们
                </Link>
              </li>
              <li>
                <Link
                  to="/contact"
                  className="hover:text-white transition-colors"
                >
                  联系我们
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* 底部 */}
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-sm">
          <span>© 2026 爱买买 All rights reserved</span>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white transition-colors">
              隐私政策
            </a>
            <a href="#" className="hover:text-white transition-colors">
              服务条款
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Create App.tsx**

```tsx
import { lazy, Suspense } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { PAGE_META } from "@/lib/constants";

const Home = lazy(() => import("@/pages/Home"));
const Products = lazy(() => import("@/pages/Products"));
const AiTech = lazy(() => import("@/pages/AiTech"));
const About = lazy(() => import("@/pages/About"));
const Merchants = lazy(() => import("@/pages/Merchants"));
const Contact = lazy(() => import("@/pages/Contact"));
const NotFound = lazy(() => import("@/pages/NotFound"));

/** 动态更新页面 title 和 meta description */
function MetaUpdater() {
  const location = useLocation();

  useEffect(() => {
    const meta = PAGE_META[location.pathname];
    if (meta) {
      document.title = meta.title;
      const desc = document.querySelector('meta[name="description"]');
      if (desc) desc.setAttribute("content", meta.description);
    }
  }, [location.pathname]);

  return null;
}

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-bg">
      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-ai-start to-ai-glow animate-pulse" />
    </div>
  );
}

export default function App() {
  return (
    <>
      <MetaUpdater />
      <Navbar />
      <main id="main-content">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/products" element={<Products />} />
            <Route path="/ai" element={<AiTech />} />
            <Route path="/about" element={<About />} />
            <Route path="/merchants" element={<Merchants />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 4: Verify dev server renders**

Run: `cd website && npm run dev`
Expected: Page loads at localhost:5175, shows loading spinner with navigation

- [ ] **Step 5: Commit**

```bash
git add website/src/components/layout/ website/src/App.tsx
git commit -m "feat(website): add Navbar, Footer, and App router with lazy loading"
```

---

## Task 6: Home Page

**Files:**

- Create: `website/src/pages/Home.tsx`

This is the most complex page with all visual effects. Contains 6 sections: Hero → Core Values → Platform Capabilities → Stats → Partners → Download CTA.

- [ ] **Step 1: Create Home.tsx**

```tsx
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
    title: "AI 智能",
    desc: "强化学习驱动的AI推荐、语义搜索和语音交互，让购物更懂你",
    image: IMAGES.tech.ai,
  },
  {
    icon: "🌿",
    title: "品质溯源",
    desc: "从种子种苗到餐桌全链路追踪，每一份食材都有完整的品质档案",
    image: IMAGES.agriculture.greenhouse,
  },
  {
    icon: "🤝",
    title: "AI农业",
    desc: "零门槛入驻、AI 智能定价，让好产品卖出好价钱",
    image: IMAGES.agriculture.farmer,
  },
];

const PLATFORM_FEATURES = [
  {
    title: "买家端 App",
    desc: "智能搜索、AI 溯源、语音助手、一键下单，全方位智慧购物体验",
    image: IMAGES.produce.fruits,
    features: ["语义搜索", "品质溯源", "智能推荐", "语音助手"],
  },
  {
    title: "卖家后台",
    desc: "订单管理、数据分析、AI 定价、物流对接，轻松经营每一天",
    image: IMAGES.tech.dataViz,
    features: ["订单管理", "数据分析", "智能定价", "物流追踪"],
  },
  {
    title: "AI 助手",
    desc: "自然语言交互、意图理解、个性化推荐，你的专属农产品顾问",
    image: IMAGES.tech.network,
    features: ["语音交互", "意图识别", "个性化推荐", "智能客服"],
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
            智能溯源 · 品质保障 · 让每一粒粮食都有智慧的脉搏
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
              title="为什么选择爱买买"
              subtitle="AI + 农业 + 电商，三位一体的智慧平台"
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
            信赖爱买买的合作伙伴
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
              开启智慧农业之旅
            </h2>
            <p className="text-lg text-white/80 mb-8 max-w-lg mx-auto">
              下载爱买买 App，体验 AI 驱动的农产品购物
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
```

- [ ] **Step 2: Verify Home page renders**

Run: `cd website && npm run dev`
Navigate to http://localhost:5175
Expected: Full Home page with hero orb, particles, scroll animations, images from Unsplash

- [ ] **Step 3: Commit**

```bash
git add website/src/pages/Home.tsx
git commit -m "feat(website): implement Home page with hero, values, features, stats, and CTA sections"
```

---

## Task 7: Products Page

**Files:**

- Create: `website/src/pages/Products.tsx`

- [ ] **Step 1: Create Products.tsx**

```tsx
import ScrollReveal from "@/components/effects/ScrollReveal";
import SectionHeading from "@/components/ui/SectionHeading";
import ParticleCanvas from "@/components/effects/ParticleCanvas";
import { IMAGES } from "@/lib/constants";

const BUYER_FEATURES = [
  {
    title: "智能搜索",
    desc: '自然语言搜索，"给爸妈买点好消化的"也能精准匹配',
    icon: "🔍",
  },
  { title: "品质溯源", desc: "查看从产地到餐桌的完整实时数字", icon: "🌿" },
  {
    title: "一键下单",
    desc: "智能购物车、优惠自动计算、多支付方式",
    icon: "🛒",
  },
  { title: "AI 推荐", desc: "基于购买习惯和偏好的个性化商品推荐", icon: "✨" },
];

const SELLER_FEATURES = [
  {
    title: "订单管理",
    desc: "实时订单追踪、自动状态流转、异常预警",
    icon: "📦",
  },
  {
    title: "数据分析",
    desc: "销售趋势、客户画像、库存预警一目了然",
    icon: "📊",
  },
  { title: "智能定价", desc: "AI 分析市场数据，自动推荐最优售价", icon: "💰" },
  { title: "物流对接", desc: "一键对接主流快递，自动生成电子面单", icon: "🚚" },
];

const COMPARISON = [
  { feature: "搜索方式", us: "AI 语义搜索", them: "关键词匹配" },
  { feature: "品质保障", us: "全链路 AI 溯源", them: "商家自述" },
  { feature: "定价策略", us: "AI 智能定价", them: "手动设价" },
  { feature: "数据分析", us: "实时智能看板", them: "基础统计" },
  { feature: "客户服务", us: "AI 语音助手", them: "在线客服" },
  { feature: "物流追踪", us: "全链路可视化", them: "快递单号查询" },
];

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
                <span className="text-ai-end text-sm font-semibold tracking-wider uppercase mb-4 block">
                  买家端
                </span>
                <h2 className="text-h1-mobile md:text-h1 text-text-on-dark mb-6">
                  智慧购物体验
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {BUYER_FEATURES.map((f) => (
                    <div
                      key={f.title}
                      className="p-4 rounded-card bg-dark-elevated/50 border border-white/5"
                    >
                      <div className="text-2xl mb-2">{f.icon}</div>
                      <h3 className="text-white font-semibold mb-1">
                        {f.title}
                      </h3>
                      <p className="text-text-on-dark-secondary text-sm">
                        {f.desc}
                      </p>
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
                <span className="text-brand text-sm font-semibold tracking-wider uppercase mb-4 block">
                  卖家端
                </span>
                <h2 className="text-h1-mobile md:text-h1 text-text-primary mb-6">
                  轻松管理经营
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {SELLER_FEATURES.map((f) => (
                    <div
                      key={f.title}
                      className="p-4 rounded-card bg-white border border-light-soft shadow-card"
                    >
                      <div className="text-2xl mb-2">{f.icon}</div>
                      <h3 className="text-text-primary font-semibold mb-1">
                        {f.title}
                      </h3>
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
            <SectionHeading
              title="强大的管理后台"
              subtitle="全局掌控，让平台运营井然有序"
            />
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
                  {["全局监控", "商户审核", "数据看板", "权限管理"].map(
                    (item) => (
                      <div
                        key={item}
                        className="bg-white/10 backdrop-blur-sm rounded-card p-4 text-center"
                      >
                        <span className="text-white font-semibold">{item}</span>
                      </div>
                    ),
                  )}
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
            <SectionHeading
              title="对比传统平台"
              subtitle="全面升级，一目了然"
            />
          </ScrollReveal>
          <ScrollReveal>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[500px]">
                <thead>
                  <tr className="border-b-2 border-brand/20">
                    <th className="text-left py-4 px-4 text-text-secondary font-medium">
                      功能
                    </th>
                    <th className="text-left py-4 px-4 text-brand font-bold">
                      爱买买
                    </th>
                    <th className="text-left py-4 px-4 text-text-tertiary font-medium">
                      传统平台
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row) => (
                    <tr
                      key={row.feature}
                      className="border-b border-light-soft"
                    >
                      <td className="py-4 px-4 font-medium text-text-primary">
                        {row.feature}
                      </td>
                      <td className="py-4 px-4 text-brand font-medium">
                        ✓ {row.us}
                      </td>
                      <td className="py-4 px-4 text-text-tertiary">
                        {row.them}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Verify Products page renders**

Navigate to http://localhost:5175/products
Expected: Full Products page with 4 sections, images, comparison table

- [ ] **Step 3: Commit**

```bash
git add website/src/pages/Products.tsx
git commit -m "feat(website): implement Products page with buyer, seller, admin, and comparison sections"
```

---

## Task 8: AI Tech Page

**Files:**

- Create: `website/src/pages/AiTech.tsx`

- [ ] **Step 1: Create AiTech.tsx**

```tsx
import ParticleCanvas from "@/components/effects/ParticleCanvas";
import HeroOrb from "@/components/effects/HeroOrb";
import ScrollReveal from "@/components/effects/ScrollReveal";
import SectionHeading from "@/components/ui/SectionHeading";
import { IMAGES } from "@/lib/constants";

const TRACE_STEPS = [
  { label: "产地", desc: "种植环境、土壤检测、农药记录", icon: "🌱" },
  { label: "加工", desc: "清洗包装、质检报告、批次编号", icon: "🏭" },
  { label: "物流", desc: "冷链温控、GPS追踪、签收确认", icon: "🚛" },
  { label: "餐桌", desc: "扫码溯源、品质评价、售后保障", icon: "🍽️" },
];

const SEARCH_EXAMPLES = [
  {
    input: '"给我爸妈买点好消化的"',
    output: "推荐：有机小米、南瓜、山药、燕麦片...",
  },
  {
    input: '"预算 200 买水果礼盒"',
    output: "筛选：200 元以内精选水果礼盒，按好评排序...",
  },
  {
    input: '"无农药的蔬菜"',
    output: "匹配：有机认证蔬菜，附带溯源检测报告...",
  },
];

const ARCH_LAYERS = [
  {
    name: "应用层",
    items: ["买家 App", "卖家后台", "管理平台"],
    color: "from-brand to-brand-light",
  },
  {
    name: "API 网关",
    items: ["认证鉴权", "流量控制", "负载均衡"],
    color: "from-ai-start to-ai-end",
  },
  {
    name: "AI 引擎",
    items: ["NLP 语义理解", "推荐算法", "图像识别"],
    color: "from-ai-end to-ai-glow",
  },
  {
    name: "数据层",
    items: ["PostgreSQL", "Redis 缓存", "OSS 存储"],
    color: "from-brand-dark to-brand",
  },
];

const SECURITY_ITEMS = [
  { icon: "🔒", title: "数据加密", desc: "全链路 HTTPS + AES-256 加密存储" },
  {
    icon: "🛡️",
    title: "隐私保护",
    desc: "买家信息脱敏，卖家无法获取用户真实手机号",
  },
  {
    icon: "🔐",
    title: "权限隔离",
    desc: "多端独立认证，角色级别精细化权限控制",
  },
  { icon: "📋", title: "审计日志", desc: "所有关键操作自动记录，完整操作追溯" },
];

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
            <SectionHeading
              title="全链路 AI 溯源"
              subtitle="每一份食材的完整生命档案"
              light={false}
            />
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
                      <h3 className="text-text-on-dark font-semibold text-lg mb-1">
                        {step.label}
                      </h3>
                      <p className="text-text-on-dark-secondary text-sm">
                        {step.desc}
                      </p>
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
            <SectionHeading
              title="语义智能搜索"
              subtitle="不用精确关键词，说人话就能找到"
              light={false}
            />
          </ScrollReveal>

          <div className="space-y-4 max-w-2xl mx-auto">
            {SEARCH_EXAMPLES.map((ex, i) => (
              <ScrollReveal key={i} delay={i * 0.15}>
                <div className="rounded-card-lg overflow-hidden border border-white/10">
                  <div className="bg-dark-elevated p-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-r from-ai-start to-ai-end flex items-center justify-center text-white text-sm">
                      🔍
                    </div>
                    <span className="text-text-on-dark font-medium">
                      {ex.input}
                    </span>
                  </div>
                  <div className="bg-dark-bg/50 p-4">
                    <span className="text-ai-end text-sm">AI 理解 →</span>
                    <p className="text-text-on-dark-secondary mt-1">
                      {ex.output}
                    </p>
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
                  { role: "user", text: '"帮我看看最近有什么好吃的水果"' },
                  {
                    role: "ai",
                    text: "当季推荐：海南芒果、云南蓝莓、烟台樱桃，都是产地直发，新鲜保证！",
                  },
                  { role: "user", text: '"芒果怎么样？有溯源吗？"' },
                  {
                    role: "ai",
                    text: "这批芒果来自海南三亚基地，有机认证，3 天前采摘。溯源报告显示农残检测合格 ✓",
                  },
                ].map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-xs px-4 py-3 rounded-card text-sm ${
                        msg.role === "user"
                          ? "bg-brand text-white rounded-br-none"
                          : "bg-light-surface text-text-primary rounded-bl-none border border-light-soft"
                      }`}
                    >
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
                    <span className="text-white font-semibold">
                      {layer.name}
                    </span>
                  </div>
                  <div className="bg-white px-6 py-4 flex flex-wrap gap-3">
                    {layer.items.map((item) => (
                      <span
                        key={item}
                        className="px-3 py-1 rounded-pill text-sm bg-light-surface text-text-secondary border border-light-soft"
                      >
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
            <SectionHeading
              title="数据安全"
              subtitle="全方位保护您的数据隐私"
            />
          </ScrollReveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            {SECURITY_ITEMS.map((item, i) => (
              <ScrollReveal key={item.title} delay={i * 0.1}>
                <div className="text-center p-6 rounded-card-lg bg-white shadow-card hover:shadow-card-hover transition-shadow">
                  <div className="text-4xl mb-4">{item.icon}</div>
                  <h3 className="font-semibold text-text-primary mb-2">
                    {item.title}
                  </h3>
                  <p className="text-text-secondary text-sm">{item.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add website/src/pages/AiTech.tsx
git commit -m "feat(website): implement AI Tech page with trace, search, voice, architecture, and security sections"
```

---

## Task 9: About Page

**Files:**

- Create: `website/src/pages/About.tsx`

- [ ] **Step 1: Create About.tsx**

```tsx
import ParticleCanvas from "@/components/effects/ParticleCanvas";
import ScrollReveal from "@/components/effects/ScrollReveal";
import SectionHeading from "@/components/ui/SectionHeading";
import { IMAGES, TEAM_MEMBERS, TIMELINE } from "@/lib/constants";

const VALUES = [
  {
    title: "使命",
    desc: "用 AI 技术降低农产品流通成本，让优质农产品走出田间、走上餐桌",
    icon: "🎯",
  },
  {
    title: "愿景",
    desc: "成为中国领先的 AI 农业电商平台，推动农业数字化转型",
    icon: "🔭",
  },
  {
    title: "价值观",
    desc: "诚信为本、科技驱动、普惠共赢、绿色可持续",
    icon: "💎",
  },
];

export default function About() {
  return (
    <>
      {/* Hero */}
      <section className="relative pt-32 pb-20 bg-gradient-to-b from-dark-bg to-dark-elevated overflow-hidden">
        <ParticleCanvas particleCount={10} />
        <div className="relative z-10 max-w-page mx-auto px-6 text-center">
          <h1 className="text-display-mobile md:text-display text-text-on-dark mb-4">
            让农业拥抱<span className="text-ai-gradient">智能时代</span>
          </h1>
          <p className="text-lg text-text-on-dark-secondary max-w-2xl mx-auto">
            爱买买成立于 2024 年，致力于用 AI 技术重新定义农产品电商
          </p>
        </div>
      </section>

      {/* 品牌故事 */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-dark-elevated to-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <div className="flex flex-col md:flex-row gap-12 items-center">
              <div className="flex-1">
                <h2 className="text-h1-mobile md:text-h1 text-text-on-dark mb-6">
                  品牌故事
                </h2>
                <div className="space-y-4 text-text-on-dark-secondary leading-relaxed">
                  <p>
                    在中国广袤的农村，有最好的食材、最勤劳的农民，却往往因为信息不对称和流通环节冗长，
                    好产品卖不出好价钱，消费者也难以买到真正新鲜、安全的农产品。
                  </p>
                  <p>
                    爱买买的创始团队深入田间地头，走访了数百个农业合作社和家庭农场。我们发现，
                    <span className="text-ai-end font-medium">
                      AI 技术可以从根本上改变这一现状
                    </span>
                    ——
                    从智能溯源建立信任，到语义搜索连接供需，再到数据分析优化经营。
                  </p>
                  <p>
                    于是，爱买买诞生了。我们的名字寓意着对农产品的热爱，对品质的追求，
                    对每一次购物体验的珍视。
                    <span className="text-ai-end font-medium">爱，买买。</span>
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
                  <p className="text-text-secondary leading-relaxed">
                    {v.desc}
                  </p>
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
            <SectionHeading
              title="核心团队"
              subtitle="一群热爱农业和技术的人"
            />
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
                  <h3 className="font-semibold text-text-primary">
                    {member.name}
                  </h3>
                  <p className="text-brand text-sm font-medium">
                    {member.role}
                  </p>
                  <p className="text-text-tertiary text-sm mt-1">
                    {member.bio}
                  </p>
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
                  <div
                    className={`relative flex items-start gap-8 ${i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"}`}
                  >
                    {/* 节点 */}
                    <div className="absolute left-4 md:left-1/2 w-3 h-3 rounded-full bg-ai-end border-4 border-light-bg -translate-x-1/2 mt-1.5 z-10" />

                    {/* 内容 */}
                    <div
                      className={`ml-12 md:ml-0 md:w-[45%] ${i % 2 === 0 ? "md:pr-8 md:text-right" : "md:pl-8"}`}
                    >
                      <span className="text-ai-start font-bold">
                        {item.year}
                      </span>
                      <h3 className="text-text-primary font-semibold text-lg">
                        {item.title}
                      </h3>
                      <p className="text-text-secondary text-sm mt-1">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add website/src/pages/About.tsx
git commit -m "feat(website): implement About page with story, values, team, and timeline sections"
```

---

## Task 10: Merchants Page

**Files:**

- Create: `website/src/pages/Merchants.tsx`

- [ ] **Step 1: Create Merchants.tsx**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ParticleCanvas from "@/components/effects/ParticleCanvas";
import ScrollReveal from "@/components/effects/ScrollReveal";
import SectionHeading from "@/components/ui/SectionHeading";
import Button from "@/components/ui/Button";
import DownloadModal from "@/components/ui/DownloadModal";
import { IMAGES, SUCCESS_STORIES } from "@/lib/constants";

const ADVANTAGES = [
  {
    icon: "📈",
    title: "流量扶持",
    desc: "AI 算法精准推荐，新店也能获得曝光，不用花钱买流量",
  },
  {
    icon: "💡",
    title: "AI 智能定价",
    desc: "根据市场行情、季节、品类自动推荐最优售价，告别拍脑袋定价",
  },
  {
    icon: "📊",
    title: "数据分析",
    desc: "实时销售看板、客户画像、库存预警，数据驱动经营决策",
  },
  {
    icon: "🚚",
    title: "物流支持",
    desc: "一键对接主流快递，冷链物流解决方案，降低配送成本",
  },
];

const STEPS = [
  { num: "01", title: "提交资料", desc: "填写企业信息、营业执照、经营资质" },
  { num: "02", title: "平台审核", desc: "1-3 个工作日完成审核，专人对接指导" },
  {
    num: "03",
    title: "开店运营",
    desc: "上架商品、设置价格，AI 辅助一站式开店",
  },
  {
    num: "04",
    title: "数据增长",
    desc: "流量扶持 + 数据分析，助力业绩持续增长",
  },
];

export default function Merchants() {
  const navigate = useNavigate();
  const [downloadOpen, setDownloadOpen] = useState(false);

  return (
    <>
      {/* Hero */}
      <section className="relative pt-32 pb-20 bg-gradient-to-b from-dark-bg to-dark-elevated overflow-hidden">
        <ParticleCanvas particleCount={10} />
        <div className="relative z-10 max-w-page mx-auto px-6 text-center">
          <h1 className="text-display-mobile md:text-display text-text-on-dark mb-4">
            与爱买买同行，<span className="text-ai-gradient">共创农业未来</span>
          </h1>
          <p className="text-lg text-text-on-dark-secondary max-w-2xl mx-auto mb-8">
            零门槛入驻，AI 赋能经营，让好产品遇见好买家
          </p>
          <Button
            size="lg"
            onClick={() =>
              document
                .getElementById("steps")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            立即入驻
          </Button>
        </div>
      </section>

      {/* 平台优势 */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-dark-elevated to-light-bg">
        <div className="max-w-page mx-auto px-6">
          <ScrollReveal>
            <SectionHeading
              title="为什么选择爱买买"
              subtitle="AI 驱动的全方位经营支持"
              light={false}
            />
          </ScrollReveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            {ADVANTAGES.map((adv, i) => (
              <ScrollReveal key={adv.title} delay={i * 0.1}>
                <div className="p-6 rounded-card-lg bg-dark-elevated border border-white/5 hover:border-ai-start/30 transition-all h-full">
                  <div className="text-3xl mb-4">{adv.icon}</div>
                  <h3 className="text-text-on-dark font-semibold mb-2">
                    {adv.title}
                  </h3>
                  <p className="text-text-on-dark-secondary text-sm leading-relaxed">
                    {adv.desc}
                  </p>
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
                  <h3 className="font-semibold text-text-primary text-lg mb-1">
                    {step.title}
                  </h3>
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
            <SectionHeading
              title="强大的卖家后台"
              subtitle="一站式管理，数据驱动增长"
            />
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
            <SectionHeading
              title="成功案例"
              subtitle="他们在爱买买找到了增长"
            />
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
                      <h3 className="font-semibold text-text-primary">
                        {story.name}
                      </h3>
                      <span className="text-brand font-bold text-sm">
                        {story.stat}
                      </span>
                    </div>
                    <p className="text-text-secondary text-sm italic">
                      "{story.quote}"
                    </p>
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
          <img
            src={IMAGES.agriculture.orchard}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
        <div className="relative z-10 max-w-page mx-auto px-6 text-center">
          <ScrollReveal>
            <h2 className="text-h1-mobile md:text-h1 text-white mb-4">
              开启您的农业电商之旅
            </h2>
            <p className="text-lg text-white/80 mb-8">
              加入爱买买，让 AI 帮您把好产品卖给好买家
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                variant="gold"
                size="lg"
                onClick={() => setDownloadOpen(true)}
              >
                立即入驻
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={() => navigate("/contact")}
              >
                咨询合作
              </Button>
            </div>
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
```

- [ ] **Step 2: Commit**

```bash
git add website/src/pages/Merchants.tsx
git commit -m "feat(website): implement Merchants page with advantages, steps, showcase, stories, and CTA"
```

---

## Task 11: Contact Page

**Files:**

- Create: `website/src/pages/Contact.tsx`

- [ ] **Step 1: Create Contact.tsx**

```tsx
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
                    placeholder="your@email.com"
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
                      { icon: "📞", label: "电话", value: "400-888-8888" },
                      {
                        icon: "✉️",
                        label: "邮箱",
                        value: "contact@aimaimai.com",
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
```

- [ ] **Step 2: Commit**

```bash
git add website/src/pages/Contact.tsx
git commit -m "feat(website): implement Contact page with form, info, map placeholder, and social links"
```

---

## Task 12: 404 Page

**Files:**

- Create: `website/src/pages/NotFound.tsx`

- [ ] **Step 1: Create NotFound.tsx**

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import HeroOrb from "@/components/effects/HeroOrb";
import Button from "@/components/ui/Button";

export default function NotFound() {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(5);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    if (cancelled) return;

    if (countdown <= 0) {
      navigate("/");
      return;
    }

    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, cancelled, navigate]);

  return (
    <section className="min-h-screen flex items-center justify-center bg-dark-bg">
      <div className="text-center px-6">
        <HeroOrb size={100} className="mx-auto mb-8" />
        <h1 className="text-h1-mobile md:text-h1 text-text-on-dark mb-4">
          页面未找到
        </h1>
        <p className="text-text-on-dark-secondary mb-8">
          您访问的页面不存在或已被移除
        </p>
        <Button onClick={() => navigate("/")}>返回首页</Button>
        {!cancelled && (
          <p className="mt-4 text-text-on-dark-tertiary text-sm">
            {countdown} 秒后自动跳转...
            <button
              className="ml-2 text-ai-end underline"
              onClick={() => setCancelled(true)}
            >
              取消
            </button>
          </p>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add website/src/pages/NotFound.tsx
git commit -m "feat(website): implement 404 page with auto-redirect and AI orb"
```

---

## Task 13: SEO Static Files + Favicon

**Files:**

- Create: `website/public/robots.txt`
- Create: `website/public/sitemap.xml`
- Copy: `logo/aimaimai_clean_28.png` → `website/public/favicon.ico`

- [ ] **Step 1: Create robots.txt**

```
User-agent: *
Allow: /

Sitemap: https://aimaimai.com/sitemap.xml
```

- [ ] **Step 2: Create sitemap.xml**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://aimaimai.com/</loc><priority>1.0</priority></url>
  <url><loc>https://aimaimai.com/products</loc><priority>0.8</priority></url>
  <url><loc>https://aimaimai.com/ai</loc><priority>0.8</priority></url>
  <url><loc>https://aimaimai.com/about</loc><priority>0.6</priority></url>
  <url><loc>https://aimaimai.com/merchants</loc><priority>0.7</priority></url>
  <url><loc>https://aimaimai.com/contact</loc><priority>0.5</priority></url>
</urlset>
```

- [ ] **Step 3: Copy favicon**

```bash
cp "logo/aimaimai_clean_28.png" website/public/favicon.ico
```

- [ ] **Step 4: Commit**

```bash
git add website/public/
git commit -m "feat(website): add robots.txt, sitemap.xml, and favicon"
```

---

## Task 14: Final Build Verification

- [ ] **Step 1: TypeScript compilation check**

Run: `cd website && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Production build**

Run: `cd website && npm run build`
Expected: Build succeeds, output in `website/dist/`

- [ ] **Step 3: Preview production build**

Run: `cd website && npm run preview`
Expected: Site renders correctly at preview URL, all pages accessible, images load, animations work

- [ ] **Step 4: Manual verification checklist**

- Home: Hero orb + particles + scroll animations + images + stats counters
- Products: All 4 sections with images + comparison table
- AI Tech: Trace flow + search demos + chat UI + architecture layers + images
- About: Story + values + team photos + timeline
- Merchants: Advantages + steps + stories with images + CTA
- Contact: Form validation works + info sidebar + map link
- 404: Orb + countdown + redirect
- Navbar: Scroll glass effect + mobile hamburger + active state
- Footer: All links work
- Responsive: Check at 375px, 768px, 1200px widths

- [ ] **Step 5: Final commit**

```bash
git add -A website/
git commit -m "feat(website): complete brand website with all 6 pages, effects, and SEO"
```
