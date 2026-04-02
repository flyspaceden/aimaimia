# 公司详情页优化设计方案

## 概述

将当前公司详情页从"线下活动为主"的 7-Tab 结构，重构为"农业企业展示 + 电商结合"的 4-Tab 结构。核心变化：新增商品展示作为默认 Tab，合并冗余 Tab，增加关注/分享/评分/联系等交互入口。

## 视觉稿

参考 `docs/mockup-company-detail.html`（浏览器打开查看交互效果）

---

## 一、封面区（Hero）

### 现状
- 公司 cover 图 + 渐变遮罩
- 显示：名称、主营业务、位置、距离
- 右上角仅有"更多操作"占位按钮

### 改造

**布局：**
- 背景：公司 cover 大图 + 底部渐变遮罩（保留现有）
- 左上：返回按钮（毛玻璃圆形）
- 右上：**分享按钮** + **更多操作按钮**（毛玻璃圆形）
- 底部左侧：公司头像（52px 圆形，白色半透明边框）+ 名称 + 主营业务 + 位置/距离
  - 头像来源：**无 logo 字段**，使用 `company.cover` 裁剪显示；如 cover 也为空，使用 `MaterialCommunityIcons` `storefront-outline` 图标占位
- 底部右侧：**关注按钮**（绿色圆角，已关注态切换为半透明毛玻璃）
  - **未登录**：点击显示 toast 提示"请先登录"
  - **已登录**：切换关注状态，调用 `FollowRepo.toggleFollow()`

**数据来源：**
- `company.cover` — 封面图 + 头像（复用）
- `company.name` — 名称
- `company.mainBusiness` — 主营业务
- `company.location` / `company.distanceKm` — 位置和距离（`distanceKm` 由后端基于用户经纬度计算后在列表接口返回，详情接口目前未返回该字段，需补充或前端从列表缓存中读取）
- 关注状态 — 初始状态通过在 company detail 响应中嵌入 `isFollowed` 布尔字段获取（需后端在 `GET /companies/:id` 中添加，已登录时查询 Follow 表，未登录返回 false）
- 分享 — 调用 React Native `Share.share({ message, url })` API，分享内容为：`{company.name} - {company.mainBusiness}`，URL 为深链接占位

## 二、信息条（封面下方）

### 新增内容

**左侧：企业评分**
- 星级图标（5星） + 评分数值 + 评价数量
- 数据来源：当前后端无评分字段，**mock 策略**：显示固定值 "4.8 · 暂无评价"，文字颜色使用 `colors.text.tertiary` 以暗示占位状态
- 后续迭代接入真实评分系统

**右侧：联系电话按钮**
- 图标 + "联系商家" 文字
- 点击调用 `Linking.openURL('tel:xxx')`
- 数据来源：`company.servicePhone`（后端 Company 模型已有此字段）
- **servicePhone 为空时**：隐藏此按钮，不展示

**认证标签行：**
- 横向展示 `company.badges`，使用 `<Tag>` 组件（保留现有，位置从 Tab 上方移到信息条下方）

## 三、Tab 栏

### 结构变化

| 旧 Tab（7个） | 新 Tab（4个） | 说明 |
|---|---|---|
| — | **商品** | 新增，默认选中 |
| 日历 + 预约 | **活动预约** | 合并为一个 Tab |
| 档案 + 资质 + 检测 + 风采 | **企业档案** | 合并为一个 Tab |
| 组团 | **组团** | 保留 |

### Tab 按钮样式
- 图标 + 文字的垂直布局，四等分宽度
- 选中态：图标背景绿色渐变 + 阴影上浮 + 底部绿色指示条
- 未选中态：灰色背景图标 + 浅色文字
- 图标：🛒 商品 / 📅 活动预约 / 📋 企业档案 / 👥 组团
- 实际实现使用 `MaterialCommunityIcons`：`cart-outline` / `calendar-clock` / `file-document-outline` / `account-group-outline`

## 四、商品 Tab（新增）

### 布局
1. **分类筛选条** — 横向滚动的分类标签
   - 数据来源：后端在 `GET /companies/:id/products` 响应中额外返回 `categories: string[]` 字段（该公司所有商品的去重分类列表），避免从分页数据中聚合导致不完整
   - "全部" 为默认选中
   - 选中态：绿色背景白字；未选中态：白色背景灰边
2. **双列等高网格** — 与分类页 `category/[id].tsx` 一致的 `FlatList numColumns={2}` 布局（非真正的瀑布流，不依赖 MasonryFlashList）
   - 图片 + 商品名（2行截断）+ 标签 + 价格 + 加购按钮
   - 加购按钮点击后显示 toast "已加入购物车"
   - 点击卡片跳转商品详情
   - **加购交互**：使用 `addItem(product, 1, product.defaultSkuId, product.price)`，与发现页 CompanyCard 一致

### 数据获取

**后端新增接口 `GET /companies/:id/products`：**

```
请求参数：
  - page: number (默认 1)
  - pageSize: number (默认 10)
  - category?: string (分类名称筛选)

响应：
{
  items: Array<{
    id: string
    title: string
    price: number
    image: string        // 商品主图
    defaultSkuId: string // 默认 SKU ID（用于加购）
    tags: string[]       // 商品标签
    unit: string         // 单位（斤/盒/袋）
    origin: string       // 产地
    categoryName: string // 分类名称
  }>
  total: number
  categories: string[]   // 该公司全部商品的去重分类列表
}

过滤规则：
  - 仅返回 status = ACTIVE 且 auditStatus = APPROVED 的商品
  - 排除 isReward = true 的奖励商品（即使是平台公司也不展示奖励商品）
  - 按创建时间降序排列
```

- 前端 `CompanyRepo` 新增 `listProducts(companyId, { page, category })` 方法

### 分页与滚动架构

**滚动嵌套问题处理：**
- 当前页面使用 `ScrollView` 作为父容器，商品 Tab 内部不能再嵌套可滚动的 `FlatList`
- 解决方案：商品 Tab 激活时，**替换父级 `ScrollView` 为 `FlatList`**，将封面区+信息条+Tab栏作为 `ListHeaderComponent`，商品列表作为 FlatList 数据
- 其他 Tab（活动预约/企业档案/组团）保持 `ScrollView` 包裹
- 这是按 Tab 切换容器类型的模式，避免嵌套滚动问题

### 三态处理
- **加载中**：双列 Skeleton 占位卡片（4个）
- **无商品**：`<EmptyState title="暂无商品" description="该企业还未上架商品" />`
- **加载失败**：`<ErrorState title="商品加载失败" onAction={refetch} />`

## 五、活动预约 Tab（合并）

### 布局
将原"日历"和"预约"两个 Tab 合并为上下两段：

**上半部分：活动日历**（保留现有逻辑）
- 日历条（7天滚动窗口）+ 当天活动列表
- 活动卡片：时间胶囊 + 标题 + 类型标签 + 地点 + 名额 + 状态 + 预约按钮
- "查看全部日程" 按钮打开 BottomSheet

**下半部分：我的预约**（从原"预约" Tab 移入）
- 用分隔线 + 小标题 "我的预约" 分隔
- 预约卡片列表：日期 + 状态标签 + 人数/身份/活动名
- 未登录时显示登录提示

### 数据来源
- 活动：`CompanyEventRepo.listByCompany()`（不变）
- 预约：`BookingRepo.listByCompany()`（不变）
- 预约提交：`BookingRepo.create()`（不变）

## 六、企业档案 Tab（合并）

### 布局
合并原"档案""资质""检测""风采"四个 Tab，使用**卡片分段**展示：

**卡片 1：企业简介**
- 标题图标 📋 + "企业简介"
- 企业描述文本
- 键值对列表：主营业务、企业类型、地址、距离
- 企业亮点（如有）

**卡片 2：资质认证**
- 标题图标 🏅 + "资质认证"
- 认证标签网格（绿色背景 + 勾号图标）
- 数据来源：`company.badges` + `company.certifications`

**卡片 3：检测报告**
- 标题图标 🔬 + "检测报告"
- 三个统计数字卡：检测批次、合格率、最近检测时间
- "查看完整报告" 按钮（占位）
- 数据来源：`company.latestTestedAt`，其他为 mock 占位
- **mock 策略**：检测批次显示 "—"，合格率显示 "—"，最近检测显示 `latestTestedAt ?? '暂无'`；统计数字使用 `colors.text.tertiary` 颜色暗示占位

**卡片 4：企业风采**
- 标题图标 📸 + "企业风采"
- 图片网格：3列，第一张跨2列
- 数据来源：当前只有 `company.cover`，后续需要后端提供企业图片列表。先用 cover 重复展示

## 七、组团 Tab

### 保留现有逻辑
- 组团状态看板说明卡
- 组团列表：标题 + 目的地 + 进度条 + 截止日期 + 状态 + 参团按钮
- 参团 BottomSheet：团信息 + 支付方式选择 + 确认参团

### 微调
- 状态说明卡改为渐变背景，视觉上更突出
- 其他逻辑不变

---

## 八、移除的旧元素

- **快捷信息卡行**（目标成团人数 / 最近检测）：移除。成团信息在组团 Tab 展示，检测信息在企业档案 Tab 展示，不再重复
- **旧的 7 个 Tab**：全部替换为新的 4 Tab 结构

## 九、需要后端配合的改动

| 改动 | 优先级 | 说明 |
|---|---|---|
| `GET /companies/:id/products` 分页接口 | **必须** | 支持 page/pageSize/category 参数，排除奖励商品，返回商品列表 + categories 字段（详见第四节） |
| `GET /companies/:id` 添加 `isFollowed` 字段 | **必须** | 已登录时查询 Follow 表返回布尔值，未登录返回 false |
| `GET /companies/:id` 添加 `servicePhone` 字段 | **必须** | 当前详情响应可能未包含此字段，需确认并补充 |
| 企业评分/评价 | 延后 | 先 mock，后续迭代 |
| 企业图片列表 | 延后 | 先用 cover 重复，后续扩展 CompanyProfile |

## 十、前端文件改动范围

| 文件 | 改动 |
|---|---|
| `app/company/[id].tsx` | 主页面重构（Tab 结构、滚动架构、新增商品 Tab） |
| `src/repos/CompanyRepo.ts` | 新增 `listProducts()` 方法 |
| `src/types/domain/Company.ts` | 新增 `isFollowed`、`servicePhone` 字段 |
| `backend/src/modules/company/company.controller.ts` | 新增 `GET /:id/products` 端点 |
| `backend/src/modules/company/company.service.ts` | 新增商品查询逻辑、详情接口添加 isFollowed/servicePhone |
| `backend/src/modules/company/company.module.ts` | 如需注入 Product/Follow 相关 service |

## 十一、不在本次范围

- 企业评分/评价系统（mock 占位）
- 企业图片管理后台（使用 cover 占位）
- 商品 SKU 选择弹窗（点加购直接加默认 SKU）
- 关注功能后端改造（已有 follow 模块，本次仅前端对接 + detail 接口添加 isFollowed）
- `company.logo` 字段新增（使用 cover 裁剪替代）
