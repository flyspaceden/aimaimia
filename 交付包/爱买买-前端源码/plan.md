# 爱买买（前端）整体规划（Expo + RN + TS）

> 目标：仅实现高质量前端（Mock 数据 + Repository 抽象），为未来对接真实后端预留接口形态与层次。

---

## 1) 最终项目目录结构树

```text
爱买买/
├─ app/
│  ├─ _layout.tsx
│  ├─ (tabs)/
│  │  ├─ _layout.tsx
│  │  ├─ home.tsx
│  │  ├─ museum.tsx
│  │  ├─ wishes.tsx
│  │  ├─ circle.tsx
│  │  └─ me.tsx
│  ├─ product/
│  │  └─ [id].tsx
│  ├─ company/
│  │  └─ [id].tsx
│  ├─ wish/
│  │  └─ [id].tsx
│  ├─ post/
│  │  └─ [id].tsx
│  ├─ orders/
│  │  ├─ index.tsx
│  │  └─ [id].tsx
│  ├─ search.tsx
│  ├─ cart.tsx
│  ├─ settings.tsx
│  ├─ privacy.tsx
│  └─ about.tsx
├─ src/
│  ├─ components/
│  │  ├─ layout/        (AppHeader, Card, Screen 等)
│  │  ├─ inputs/        (SearchBar, QuantityStepper 等)
│  │  ├─ data/          (BannerCarousel, CategoryGrid 等)
│  │  ├─ cards/         (ProductCard, CompanyCard, WishCard, PostCard)
│  │  ├─ feedback/      (Skeleton, EmptyState, ErrorState, Toast)
│  │  ├─ overlay/       (BottomSheet 封装等)
│  │  └─ ui/            (Button, IconButton, Tag, Badge, Price 等)
│  ├─ theme/
│  │  ├─ colors.ts      (自然绿主导 + 科技蓝点缀)
│  │  ├─ spacing.ts
│  │  ├─ radius.ts
│  │  ├─ typography.ts
│  │  ├─ shadow.ts
│  │  ├─ ThemeProvider.tsx
│  │  └─ index.ts
│  ├─ types/
│  │  ├─ Result.ts      (Result<T>、分页等通用类型)
│  │  ├─ AppError.ts    (错误码/消息/可展示错误)
│  │  └─ domain/        (Product/Company/Wish/Post/Order/User 等)
│  ├─ constants/
│  │  ├─ categories.ts  (首页分类)
│  │  ├─ statuses.ts    (订单/心愿/帖子等状态枚举)
│  │  ├─ tags.ts        (可信标签/内容标签)
│  │  └─ copy.ts        (文案枚举/静态提示文案)
│  ├─ repos/
│  │  ├─ ProductRepo.ts
│  │  ├─ CompanyRepo.ts
│  │  ├─ WishRepo.ts
│  │  ├─ FeedRepo.ts
│  │  ├─ OrderRepo.ts
│  │  ├─ UserRepo.ts
│  │  └─ index.ts
│  ├─ mocks/
│  │  ├─ products.ts
│  │  ├─ categories.ts
│  │  ├─ companies.ts
│  │  ├─ wishes.ts
│  │  ├─ posts.ts
│  │  ├─ orders.ts
│  │  └─ userProfile.ts
│  ├─ store/
│  │  ├─ useCartStore.ts
│  │  └─ useUserStore.ts
│  ├─ utils/
│  │  ├─ formatPrice.ts
│  │  ├─ sleep.ts
│  │  └─ id.ts
│  └─ hooks/
│     └─ (useXXX 可选)
├─ assets/
│  └─ (icon, splash, 本地占位图 可选)
├─ app.json (或 app.config.ts)
├─ package.json
├─ tsconfig.json
├─ babel.config.js
└─ README.md
```

---

## 2) 依赖清单（含用途）

### 核心
- `expo` / `react` / `react-native` / `typescript`：Expo Managed 运行时与 TypeScript 支持
- `expo-router`：文件系统路由（Tabs + Stack），`app/` 目录即路由

### 数据与状态
- `@tanstack/react-query`：管理 Repo 异步数据（缓存、刷新、错误重试、请求状态）
- `zustand`：全局状态（购物车、用户信息、偏好、角标）

### 表单
- `react-hook-form`：表单状态管理（发布心愿等）
- `zod`：表单 schema 校验（与 react-hook-form 集成）

### 图片与体验
- `expo-image`：高性能图片加载与列表性能优化

### 弹层
- `@gorhom/bottom-sheet`：帖子挂商品小卡、企业预约抽屉等 BottomSheet 交互
  - 说明：Expo Managed 下通常还需要/依赖 `react-native-gesture-handler` 与 `react-native-reanimated`（以 Expo SDK 实际版本为准，后续初始化时一并确认）

---

## 3) 路由表（expo-router）

### Tabs（底部 5 Tab）
- `/(tabs)/home`：首页（Banner/分类/商品双列流/购物车入口）
- `/(tabs)/museum`：数字展览馆（企业列表 + 筛选 UI）
- `/(tabs)/wishes`：心愿池（页面内分段：发表/发现）
- `/(tabs)/circle`：爱买买圈（页面内分段：推荐/关注/企业）
- `/(tabs)/me`：我的（资产/订单入口/AI 农管家入口/设置等）

### 详情页（Stack）
- `/product/[id]`：商品详情
- `/company/[id]`：企业详情
- `/wish/[id]`：心愿详情
- `/post/[id]`：帖子详情

### 辅助页
- `/search`：搜索
- `/cart`：购物车
- `/orders`：订单列表
- `/orders/[id]`：订单详情
- `/settings`：设置（静态）
- `/privacy`：隐私政策（静态）
- `/about`：关于（静态）

---

## 4) 基础组件清单（≥12，含职责与复用）

- `Screen`：全局页面容器（SafeArea/StatusBar/背景色/内边距规范）；复用：所有页面
- `AppHeader`：统一顶部栏（标题/返回/右侧按钮）；复用：除首页外多数页面 + 详情页
- `SearchBar`：搜索输入外观与点击跳转；复用：首页、搜索页、展览馆
- `BannerCarousel`：首页 Banner 轮播；复用：首页
- `CategoryGrid`：分类宫格入口；复用：首页
- `Card`：统一卡片容器（圆角/阴影/间距）；复用：全站布局
- `Button`：主/次/危险按钮；复用：CTA、表单提交、空态操作
- `IconButton`：图标按钮（含可点击热区规范）；复用：收藏/更多/购物车/消息
- `Tag`：轻量标签（产地/品类/热度/可信标签）；复用：商品/心愿/帖子/企业
- `Badge`：角标/认证徽章；复用：购物车角标、企业认证、订单状态
- `Price`：价格展示（¥、单位、划线价）；复用：商品卡、详情、购物车、订单
- `ProductCard`：商品双列卡（图/标题/价格/产地/可信/加购入口）；复用：首页、搜索结果、企业推荐
- `CompanyCard`：企业卡（封面/主营/认证/距离）；复用：展览馆、搜索结果
- `WishCard`：心愿卡（标签/状态/进度）；复用：心愿发现、我的相关列表（可选）
- `PostCard`：信息流卡（图文/挂商品标签）；复用：爱买买圈列表
- `AppBottomSheet`（封装 @gorhom/bottom-sheet）：统一弹层样式/手势/遮罩；复用：帖子挂商品、企业预约等
- `Skeleton`：骨架屏；复用：所有列表页/详情页加载
- `EmptyState`：空态；复用：所有列表/搜索无结果
- `ErrorState`：错误态（含重试）；复用：所有请求页
- `Toast`：全局提示；复用：加购/占位操作/错误提示

---

## 5) 实施里程碑（Step 1 ～ Step 6）

### Step 1｜工程初始化 + 全局容器 + 反馈组件（本步就完成）
- 完成内容
  - Expo + TS 项目可运行，接入 `expo-router`
  - 根布局挂载：`QueryClientProvider`、`ThemeProvider`、`ToastHost`
  - 全局 `Screen` 容器：统一 SafeArea / StatusBar / 背景与默认内边距
  - 基础反馈组件：`Skeleton` / `EmptyState` / `ErrorState` / `Toast`
- 新增/修改文件（方向）
  - `app/_layout.tsx`、`app/(tabs)/_layout.tsx`
  - `src/components/layout/Screen.tsx`
  - `src/components/feedback/Skeleton.tsx`
  - `src/components/feedback/EmptyState.tsx`
  - `src/components/feedback/ErrorState.tsx`
  - `src/components/feedback/ToastHost.tsx`（或同等命名）
  - `src/theme/*`
- Expo 验证
  - `npx expo start` 可启动
  - 任意 Tab 页面能用 `Screen` 呈现正确的安全区与 StatusBar 风格
  - 用一个临时按钮触发 Toast 可正常显示
  - 用一个临时“假请求”切换展示 Skeleton/Empty/Error

### Step 2｜Types/Constants + Mock + Repo + React Query（数据层打底）
- 完成内容
  - `src/types/`：domain types、`Result<T>`、`AppError`
  - `src/constants/`：分类/状态/标签/文案枚举统一收敛
  - `src/mocks/`：核心数据齐全
  - `src/repos/`：Repo 方法（`list/getById` 等）返回 `Result<T>`，模拟延迟与随机错误
  - 页面接入 React Query，统一三态（Skeleton/Empty/Error）
- 新增/修改文件（方向）
  - `src/types/*`、`src/constants/*`、`src/mocks/*`、`src/repos/*`
- Expo 验证
  - 列表页能稳定呈现三态
  - ErrorState 的“重试”能触发重新请求

### Step 3｜首页 Home（固定双列 + 预留多列扩展）
- 完成内容
  - Banner、分类入口、商品流（默认固定双列）
  - 使用 `useWindowDimensions()` 预留多列扩展能力（例如后续平板/横屏可调列数）
  - 商品卡加购动效与购物车角标联动（zustand）
- 新增/修改文件（方向）
  - `app/(tabs)/home.tsx`
  - `src/components/data/BannerCarousel.tsx`
  - `src/components/data/CategoryGrid.tsx`
  - `src/components/cards/ProductCard.tsx`
  - `src/store/useCartStore.ts`
- Expo 验证
  - 列表滚动流畅、图片加载稳定
  - 点击加购后角标与合计能响应更新



#### Step 3｜首页需求补充（对齐 PRD）

> 说明：当前 Step 3 已实现 Home v1（Banner + 分类入口 + 商品规则双列网格 + 加购动效 + 购物车角标）。以下为你提供的“首页 PRD”细化需求，作为 Home v2 的补齐清单。

- 1) 特色启动动画（待实现）
  - App 启动后，先以动漫/动效形式展示品牌名「爱买买」
  - 随后副标题「AI赋能农业，夯实健康之路」以动态形式弹出
  - 动画结束后进入首页（可支持跳过）

- 2) 顶部导航栏（待对齐）
  - 左上角：显示「爱买买」Logo
  - 右侧：显示当前登录用户昵称
  - 昵称下方：展示品牌副标题「AI赋能农业，夯实健康之路」

- 3) 首页功能模块（部分已实现）
  - 轮播图 Banner（已实现占位版）
    - 用途：活动/广告/推荐商品
  - 商品分类入口（已实现占位版，待对齐图标与分类）
    - 形态：图标 + 文字
    - 分类示例：生鲜 / 蔬菜 / 水果 / 天然有机（以及其它核心分类）
  - 商品瀑布流列表（待实现）
    - 样式：不规则网格/瀑布流布局，提升浏览趣味性
    - 商品卡片：图片 / 名称 / 价格 /「加入购物车」按钮
    - 交互：支持上拉加载更多商品（分页）

- 4) 未来 AI 功能扩展预留（后续迭代，占位即可）
  - AI 溯源：点击商品查看 AI 生成的「育种-种养-流通」全历程图谱
  - AI 推荐：首页商品列表可根据用户行为进行个性化排序
  - AI 金融：农业企业/消费者的金融服务入口

- 5) 验收要点（建议）
  - 启动动画：首屏可见、动效流畅、结束后可进入首页
  - 顶部导航：Logo + 昵称 + 副标题层级清晰，支持字体缩放
  - Banner：可左右滑动，图片圆角与间距统一
  - 分类：图标与文字对齐，点击有反馈
  - 列表：瀑布流滚动流畅，支持分页加载与加载态/错误态/空态

- 6) 当前实现差异（v1 vs PRD）
  - 已实现：Banner、分类入口（图标占位）、商品规则双列网格、加购动效、购物车角标、React Query 三态基础
  - 待补齐：启动动画、顶部“Logo + 昵称 + 副标题”结构、瀑布流不规则布局、上拉分页、AI 扩展入口占位

### Step 4｜数字展览馆 Museum + 企业详情
- 完成内容
  - 企业列表（列表/地图双模式）
    - 地图：高德地图为主、腾讯地图为备用（v1 可先做“地图占位 + 坐标数据结构”，再接入原生 SDK/JS SDK）
    - 列表：筛选/排序（距离、认证、产地直供等），与地图模式共享数据源
  - 企业详情（多标签页/分段）
    - 日历/事件：展示可参观日期与活动事件；点击事件进入「预约/组团」
    - 企业档案：历史、规模、AI 种养理念（图文结构化）
    - 资质荣誉：证书/认证列表（图片预览占位）
    - 检测报告：支持 PDF 预览（v1 可先做文件占位 + 打开方式，后续接真实 PDF）
    - 实时风采：短视频/图片流（v1 占位 + 数据结构）
  - 预约参观（BottomSheet 半屏抽屉为主）
    - 表单字段：期望参观日期、人数、身份、备注（可选：公司/组织名称）
    - 校验：`react-hook-form` + `zod`（必填/范围/格式）
    - 提交后进入「待审核」状态（mock）
  - 组团看板（BottomSheet 半屏抽屉）
    - 显示当前组团：目的地、目标成团人数、已报名、截止日期
    - 一键参团：报名后进入「待支付」/「已报名」状态（mock）
    - 目标人数阈值：后台可配置；默认 30；每个企业可不同
  - 运营审核页面（平台运营）
    - 预约审核中心：列表展示预约申请，可通过/驳回/备注
    - 审核通过后进入预约池，系统持续检查同企业预约人数
    - 成团触发：达到阈值自动创建考察团；也支持运营手动发起
    - 通知：v1 用站内 Toast/消息占位（后续可接短信/站内信）
  - 支付入口预留
    - 参团确认页/抽屉内预留支付方式入口：微信支付 / 支付宝（v1 仅入口与占位流程）
- 新增/修改文件（方向）
  - `app/(tabs)/museum.tsx`、`app/company/[id].tsx`
  - `app/admin/audit.tsx`（运营审核中心）
  - `app/group/[id].tsx`（考察团详情/参团确认，占位）
  - `src/components/cards/CompanyCard.tsx`
  - `src/components/overlay/AppBottomSheet.tsx`
  - `src/components/overlay/MapView.tsx`（地图容器封装：高德/腾讯适配，占位起步）
  - `src/components/forms/BookingForm.tsx`（预约表单组件，含中文注释）
  - `src/components/data/CalendarStrip.tsx`（日历/事件入口组件）
  - `src/constants/identities.ts`（身份枚举）
  - `src/constants/payment.ts`（支付方式枚举：微信/支付宝）
  - `src/types/domain/Booking.ts`、`src/types/domain/Group.ts`
  - `src/mocks/bookings.ts`、`src/mocks/groups.ts`、`src/mocks/companyEvents.ts`
  - `src/repos/BookingRepo.ts`、`src/repos/GroupRepo.ts`
- Expo 验证
  - 展览馆 Tab：列表/地图切换正常（地图 v1 可先显示占位与企业点位列表）
  - 点击企业进入详情：分段切换顺滑；日历事件可点击
  - 预约：打开半屏抽屉 → 填写表单 → 提交成功 → 状态变为待审核（Toast/状态展示）
  - 审核页：通过/驳回能改变预约状态；通过后计入预约池
  - 组团：达到阈值自动生成考察团；企业页可看到组团看板；一键参团后进入待支付（支付入口占位）

> 身份枚举建议（v1）：消费者、采购商、学生/研学、媒体/自媒体、投资者/合作方、其他

#### Step 4 当前实现对照（v1）
- ✅ 展览馆入口（底部第二 Tab）：`app/(tabs)/museum.tsx`
  - 列表模式：企业卡片列表、筛选（距离/认证/直供/低碳）
  - 地图模式：占位地图 + 企业点位点击进入详情（高德/腾讯可切换，真实 SDK 未接入）
- ✅ 企业详情：`app/company/[id].tsx`
  - 顶部品牌海报 + 信息层级（名称/主营/位置/距离/徽章）
  - 多分段：日历/档案/资质/检测/风采/预约/组团
  - 日历事件：`src/mocks/companyEvents.ts` + `src/repos/CompanyEventRepo.ts` + `src/components/data/CalendarStrip.tsx`
  - 预约表单（半屏抽屉）：`src/components/forms/BookingForm.tsx`（字段：日期/人数/身份/备注/联系人/电话；`react-hook-form` + `zod` 校验）
  - 预约记录：显示状态（待审核/通过/驳回/邀请/参团待支付/已支付）
  - 组团看板：显示当前考察团、进度、截止日期；支持进入详情与一键参团
- ✅ 考察团详情与支付入口占位：`app/group/[id].tsx`
  - 成员列表（按预约记录聚合）、支付方式选择（微信/支付宝）、“确认参团并支付”占位流程
- ✅ 运营审核中心：`app/admin/audit.tsx`（入口：`app/(tabs)/me.tsx`）
  - 预约审核：通过/驳回/备注
  - 阈值成团：企业可配阈值（默认 30），达到阈值后自动发起考察团，并向已通过预约发送参团邀请（mock）
  - 手动发起：运营可手动创建考察团（mock）
- ✅ 数据与状态（Mock + Repo 抽象）
  - 企业阈值/坐标：`src/types/domain/Company.ts`、`src/mocks/companies.ts`
  - 预约/考察团：`src/types/domain/{Booking,Group}.ts`、`src/mocks/{bookings,groups}.ts`、`src/repos/{BookingRepo,GroupRepo}.ts`
  - 身份/支付方式枚举：`src/constants/{identities,payment}.ts`
  - 地图提供方与 Key 占位：`src/constants/map.ts`

#### Step 4 尚未实现 / 仍为占位（v1）
- 🟡 地图真实 SDK（高德/腾讯）：当前为占位实现；接入需要 Dev Client + 原生 SDK 配置（Expo Go 不支持原生地图 SDK）
- 🟡 检测报告 PDF 预览：目前为“预览占位卡”；后续需要接入真实 PDF 资源 + 预览/下载方案
- 🟡 资质荣誉（证书图集）与实时风采（短视频/图片直播）：当前为占位展示；可按数据结构补齐列表与预览交互
- 🟡 通知链路（成团邀请/审核通知）：当前用 Toast 占位；后续建议增加“站内消息”列表页承载通知历史

### Step 5｜心愿池（双 Tab：发布 / 发现 + 详情互动闭环）
- 完成内容（v1 可用 + 为后续扩展留口）
  - 页面结构：双 Tab 切换
    - `发表我的心愿`：发布入口（选择类型→填写内容→标签→@企业）
    - `发现心愿`：公开心愿瀑布流/列表浏览（= 共同心愿池）
  - 心愿类型（创建时可选）
    - 给平台：用户 ↔ 平台（功能建议/优化点）
    - 给企业：用户 ↔ 企业（允许先不选企业，后续关联；支持 @ 企业）
    - 公开心愿：用户 ↔ 用户（浏览/点赞/评论；高赞可置顶/排序）
  - 心愿详情页
    - 内容区：标题/正文/标签/@企业/创建者信息
    - 互动数据：点赞数/评论数
    - 回复区：官方/企业回复占位（v1）
    - 状态进度：发起人可改变状态（已采纳/规划中/已实现，或更细阶段后续扩展）
  - 评论系统（小红书风格）
    - 楼中楼：评论可有多条回复
    - 点赞：心愿可点赞，评论也可点赞
  - 激励与 AI（后续迭代，占位/数据结构先预留）
    - 心愿力/徽章/榜单（v2）
    - AI 分类打标/推荐（v2）
    - 企业接单/众筹/兑换（v2）
- 新增/修改文件（方向）
  - 路由
    - `app/(tabs)/wishes.tsx`（双 Tab 容器：发布/发现）
    - `app/wish/[id].tsx`（心愿详情）
  - Types/Constants/Mocks/Repos
    - `src/types/domain/Wish.ts`（扩展：type、tags、mentions、counts、status、author）
    - `src/types/domain/Comment.ts`（新增：楼中楼结构、点赞、引用）
    - `src/constants/statuses.ts`（扩展心愿状态 label）
    - `src/constants/tags.ts`（补充心愿标签枚举）
    - `src/mocks/wishes.ts`、`src/mocks/comments.ts`
    - `src/repos/WishRepo.ts`（list/create/updateStatus/like）
    - `src/repos/CommentRepo.ts`（listByWish/create/reply/like）
  - Components
    - `src/components/cards/WishCard.tsx`
    - `src/components/comments/CommentThread.tsx`（评论楼中楼，含中文注释）
    - `src/components/comments/CommentItem.tsx`
    - `src/components/forms/WishForm.tsx`（发布心愿，`react-hook-form` + `zod`，含中文注释）
    - `src/components/ui/StatusPill.tsx`（状态胶囊）
    - `src/components/ui/LikeButton.tsx`（可复用：心愿/评论）
- Expo 验证
  - 发布：类型选择→表单校验→发布成功→进入详情
  - 发现：列表加载三态正常→点赞/评论生效→高赞排序正常
  - 详情：状态变更仅发起人可操作→评论楼中楼可回复→评论点赞可用

### Step 6｜爱买买圈（信息流 + 挂商品 + 互动）
- 目标：把「爱买买圈」做成连接消费者与生产者的内容社交中枢，并与商城/展览馆/心愿池联动。

- 完成内容（v1：可用版本，先把核心链路跑通）
  - 三分段信息流（页面内 Tab）
    - `推荐`：用户 + 企业内容混合（前端先用规则混排/排序，后续对接后端/AI 推荐）
    - `关注`：仅展示已关注对象的内容（v1 可先支持关注企业，后续扩展关注用户）
    - `企业`：企业内容池（带认证标识、主营品类、可跳转绑定企业展览馆）
  - 身份体系（前端展示规则）
    - 企业账号：认证标识（Badge）+ 主营品类文案 + `companyId` 绑定（可跳转 `/company/[id]`）
    - 用户账号：个人标签（如“美食达人/阳台种植爱好者”）
  - 帖子卡片（列表复用）
    - 图文内容（图片/标题/正文摘要/标签）
    - 基础互动：点赞 / 评论 / 转发（转发先做 UI + Toast，占位微信分享卡片）
    - 商品“即时购”：帖子可挂 1 个商品
      - 图片上浮层商品标签（可点击）
      - 点击后 BottomSheet 展示商品小卡（支持一键加购，联动购物车角标）
  - 帖子详情页
    - 完整内容 + 评论区
    - 评论复用 Step 5 的楼中楼组件与点赞交互（小红书风格）
  - 风控与运营入口（占位）
    - 帖子“举报/不感兴趣”入口（Toast 占位，结构字段先预留）
    - 内容真实性标注/审核状态（v1 仅展示占位标签，v2 对接后台）

- 高级能力（v2+：先预留数据结构与入口，不强行一次做完）
  - 发布体验升级
    - 多模板发布：产品故事 / 种植日志 / 食谱教程（结构化字段）
    - AI 智能创作助手入口：AI 文案/配乐/农事标签（先做 UI/占位与 Repo 接口形态）
  - 深度互动（入口 + 占位）
    - 专家提问（向企业主发起技术咨询）
    - 打赏（支持创作者）
    - 合作意向（B 端用户私信）
  - 社交关系：关注 + 亲密度（基于互动频率），同城/同好推荐（占位）
  - 数据后台：企业内容分析面板、用户兴趣图谱（占位）
  - 精华专区、月度榜单、贡献值体系（占位）

- 新增/修改文件（方向）
  - 路由
    - `app/(tabs)/circle.tsx`（三分段信息流：推荐/关注/企业）
    - `app/post/[id].tsx`（帖子详情）
  - Types/Constants/Mocks/Repos
    - `src/types/domain/Post.ts`（扩展：author/identity/companyId/verified/tags/metrics/share 等）
    - `src/types/domain/Comment.ts`（复用 Step 5 评论结构）
    - `src/constants/tags.ts`（补充农事标签：#育苗期#/#丰收# 等；与 postTags 合并管理）
    - `src/mocks/posts.ts`（补齐企业/用户混合数据 + 挂商品样例 + 关注样例）
    - `src/repos/FeedRepo.ts`（listRecommend/listFollowing/listCompanies/getById/toggleLike 等，含中文注释）
  - Components
    - `src/components/cards/PostCard.tsx`（列表卡片：身份标识/内容/互动/商品标签）
    - `src/components/posts/PostActions.tsx`（点赞/评论/转发/更多）
    - `src/components/posts/ProductTag.tsx`（图片浮层商品标签）
    - `src/components/posts/PostComposerEntry.tsx`（发布入口 UI，占位）
    - `src/components/comments/*`（复用 Step 5 组件）
    - `src/components/overlay/AppBottomSheet.tsx`（复用：商品小卡弹层）

- Expo 验证（v1）
  - 圈子三分段 Tab 切换正常、列表三态（Skeleton/Empty/Error）齐全
  - 点进帖子详情页正常，评论楼中楼可回复/点赞
  - 帖子挂商品标签可点击 → BottomSheet 弹出 → 一键加购 → 购物车角标变化
  - 分享/举报等入口触发 Toast（占位）

### Step 7｜我的 Me + 购物车/订单/搜索/静态页 + 收尾质量
- 完成内容
  - 我的页（资产/订单入口/AI 农管家入口占位）
    - AI 农管家入口：先做“顶部按钮”形态（稳态方案，后续可升级悬浮球）
    - 资产体系拆分：`成长值`（用于会员升级）+ `爱买买积分`（用于兑换/券/抽奖）
    - 签到：7 天连续签到，第 7 天“大”奖励；断签重置；补签卡（占位，可后续启用）
    - 为你推荐：我的页仅展示 2~4 条“高确定性推荐”+ 推荐理由 + 不感兴趣；“更多”进入完整推荐列表页（后续）
    - 目标与定位（体验驱动）
      - 从“功能菜单集合”升级为：身份名片（会员成长）+ 任务/资产中心（可驱动行为）+ 订单/客服入口（直达问题）+ AI 个性推荐（可解释可反馈）+ AI 农管家（总入口）
      - 所有复杂能力先做：UI + Repo 接口占位 + Mock 数据（为后端对接留清晰接口）
    - 页面信息架构（从上到下）
      - A. 身份名片（Profile Card）
        - 动态头像框：普通默认；VIP/任务限时框（占位：frameId/type/expireAt）
        - 欢迎语：按时间段 + 兴趣/成就（如连续签到）
        - 会员体系：种子→生长→丰收；进度条 + 距离下一等级差多少成长值；成长值来源占位（消费/互动/创作）
        - 交互：点名片进资料/偏好；点会员区进权益；点头像进装扮（均可占位）
      - B. AI 农管家（入口 + 场景卡片）
        - 入口形态：顶部按钮；语音入口占位
        - 场景：智能客服/健康饮食/补货提醒/农事日历（先做 UI + Repo 占位）
      - C. 任务与资产中心（双栏两卡）
        - 我的任务/福利：高收益任务滚动列表（完善偏好/预约考察/首次发圈等），点任务可跳转并引导（占位）
        - 7 天连续签到：迷你日历/进度，奖励递增，第 7 天大奖；可选补签卡（占位）
      - D. 订单与客服中心
        - 状态聚合：待付款/待发货/待收货/退款售后（带角标数字）
        - 智能售后入口：最近异常订单卡 + 处理进度条（占位）
        - 物流沉浸式追踪：快递轨迹 + 产地实景联动（占位入口）
      - E. 消息中心（已写入 plan）：咨询/打赏/合作 + 互动 + 系统通知；未读/筛选/全部已读/跳转
      - F. 我的关注（已写入 plan）：用户/企业 tabs；搜索/排序；单行项；取消关注；进主页
      - G. 为你推荐：2~4 条 + 可解释理由 + 不感兴趣；更多进入完整列表（后续）
      - H. 设置/静态入口：设置/隐私/关于（可选账号安全/帮助反馈）
    - 路由建议（对齐现有结构）
      - `/(tabs)/me`、`/inbox/index`、`/me/following`、`/me/vip`、`/me/tasks`、`/ai/assistant`、`/orders`、`/orders/[id]`、`/user/[id]`
    - UI 关键细节（体验驱动落点）
      - 身份名片：头像框/等级/进度条/欢迎语缺一不可
      - 任务/签到：可点可得可反馈（即时 Toast + 数值变化）
      - 订单：少点一步，异常订单直接露出
      - 推荐：可解释 + 可拒绝（不感兴趣）
  - 我的关注（入口放在“我的”页）
    - 页面内 Tabs：用户 / 企业
    - 支持搜索与排序（最近关注 / 最活跃）
    - 列表项：头像 + 名称 + 身份 + 一句副信息 + 取消关注
    - 点击进入对应主页：`/user/[id]` 或 `/company/[id]`
  - 消息中心（站内消息/互动中心，入口放在「我的」里）
    - 覆盖范围：咨询/打赏/合作、点赞/评论/回复/@、关注/取关、订单与预约审核等系统通知
    - 基础能力：消息列表 + 未读角标 + 全部已读 + 进入对应页面（帖子/企业/订单等）
    - 形态建议：先做统一列表（按时间倒序），支持按类型筛选（互动/交易/系统）与“仅看未读”
    - 数据与接口：前端先用 Mock + Repo 占位，后续由后端推送/轮询/拉取替换
  - 购物车数量修改、合计、结算占位
  - 订单列表/详情（mock）
  - 搜索页（热门 + 结果列表）
  - 全站列表页三态齐全、Toast 统一、可访问性与触控热区达标
- 新增/修改文件（方向）
  - `app/(tabs)/me.tsx`
  - `app/inbox/index.tsx`（消息中心列表）
  - `app/cart.tsx`
  - `app/orders/index.tsx`、`app/orders/[id].tsx`
  - `app/search.tsx`、`app/settings.tsx`、`app/privacy.tsx`、`app/about.tsx`
  - `src/types/domain/Inbox.ts`（或 `Message.ts`：消息模型/类型枚举）
  - `src/mocks/inbox.ts`（消息 mock：咨询进度、打赏成功、合作跟进、互动通知等）
  - `src/repos/InboxRepo.ts`（list/markRead/markAllRead，含中文注释）
- Expo 验证
  - 主链路可跑通：浏览商品→加购→购物车→订单列表（占位）
  - 搜索可进入详情页
  - 从「我的」进入消息中心：列表三态正常、未读角标变化、点击消息能跳转到对应页面

---

## Step 6（v1）范围确认（已确定）

1) 发布：v1 不做完整发帖流程，仅做“发布入口/模板选择 UI + Toast 占位”，发帖/审核/发布能力放到 v2
2) 内容形态：v1 仅支持图文（最多 9 图）+ 可选挂 1 个商品；视频与多商品标签放到 v2
3) 评论：复用 Step 5 的楼中楼 + 点赞（小红书风格）；@人/表情/置顶等放到 v2（数据字段先预留）
4) 关注：v1 仅支持关注企业；关注用户放到 v2
5) 分享：v1 仅做分享按钮 + Toast 占位；微信分享卡片（封面/摘要/一键关注）待后端提供数据后接入
