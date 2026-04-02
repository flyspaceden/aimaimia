# 延迟深度链接（Deferred Deep Link）设计方案

> 推荐码从扫码到注册的全链路无感知传递

## 1. 需求概述

用户扫描推荐人的推荐码 QR 后，无论是否已安装 App，全程无感知地建立推荐绑定关系：

- **已装 App**：Universal Link / App Link 直接打开 App，从 URL 提取推荐码自动绑定
- **未装 App**：打开网页落地页 → 采集设备指纹 + 存 Cookie → 引导下载 → 首次启动自动匹配 → 注册后自动绑定

同一落地页也用于 App 通用二维码（无推荐码），纯下载引导。

## 2. 用户流程

### 2.1 链路 1：已装 App

```
扫码 → 系统识别 Universal Link → 直接打开 App
     → expo-router 捕获 URL：app.爱买买.com/r/{CODE}
     → 提取推荐码
     → 已登录 → 直接调用绑定接口
     → 未登录 → 存入 AsyncStorage，等注册/登录后自动绑定
```

### 2.2 链路 2：未装 App

```
扫码 → 打开网页落地页（app.爱买买.com/r/{CODE}）
     → 网页静默执行：① 存 Cookie  ② 上报指纹+推荐码到服务器
     → 显示下载引导页面
     → 微信环境额外显示"在浏览器中打开"引导遮罩
     → 用户下载安装 App
     → 首次启动 → 静默两步匹配：① Cookie 读取  ② 指纹兜底
     → 拿到推荐码 → 存入 AsyncStorage
     → 用户注册成功 → 自动调用绑定接口 → 完成
```

### 2.3 推荐链接格式

```
https://app.爱买买.com/r/{8位推荐码}
```

Punycode 等价形式：`https://app.xn--ckqa175y.com/r/{CODE}`

### 2.4 通用下载链接（无推荐码）

```
https://app.爱买买.com/download
```

与推荐链接共用同一落地页，只是不触发推荐码采集逻辑。

## 3. 技术方案：Cookie 为主 + 指纹兜底

### 3.1 为什么需要两层

| 扫码环境 | Cookie 方案 | 指纹方案 |
|---------|------------|---------|
| iOS Safari / 相机 | ✅ Cookie 与 SFSafariViewController 共享 | ✅ 可用 |
| Android Chrome / 相机 | ✅ Cookie 与 Chrome Custom Tab 共享 | ✅ 可用 |
| 微信内置浏览器 | ❌ Cookie 与系统浏览器不共享 | ✅ 可用（主要依赖） |

微信是国内最主要的扫码场景，Cookie 方案在微信中失效，所以指纹匹配作为兜底必不可少。

### 3.2 Cookie 方式流程

```
网页端：
  POST /api/v1/deferred-link → 返回 cookieId
  → 写入 Cookie：name=_ddl_id, value=cookieId, domain=app.爱买买.com, maxAge=7天, secure, httpOnly=false

App 端（首次启动）：
  → 打开零尺寸 SFSafariViewController(iOS) / Chrome Custom Tab(Android)
  → 访问 app.爱买买.com/resolve 页面
  → 该页面读取 Cookie 中的 _ddl_id
  → 调用 GET /api/v1/deferred-link/resolve?cookieId=xxx
  → 拿到推荐码 → 通过 URL scheme (aimaimai://referral?code=xxx) 回传给 App
  → App 收到后关闭隐藏浏览器，存入 AsyncStorage
```

### 3.3 指纹匹配流程

```
网页端（与 Cookie 同时执行）：
  POST /api/v1/deferred-link 上报 { referralCode, userAgent, screenWidth, screenHeight, language }
  → 服务器记录 IP + 计算指纹哈希

App 端（Cookie 方式未拿到推荐码时）：
  POST /api/v1/deferred-link/match { userAgent, screenWidth, screenHeight, language }
  → 服务器获取 IP，计算指纹
  → 精确匹配 fingerprint hash → 模糊匹配（同 IP + 相似 UA）
  → 48 小时内未消费的最新一条
  → 返回推荐码
```

### 3.4 指纹计算

```
fingerprint = SHA256(IP + "|" + UA + "|" + screenWidth + "x" + screenHeight + "|" + language)
```

微信 UA 归一化：去除 `MicroMessenger/x.x.x` 等微信特征后缀后再计算，使得微信中采集的指纹与系统浏览器中 App 发出的指纹尽可能一致。

## 4. 数据模型

### 4.1 新增 Prisma 模型

```prisma
model DeferredDeepLink {
  id            String   @id @default(cuid())
  referralCode  String                          // 推荐码
  fingerprint   String                          // 指纹哈希（SHA256）
  ipAddress     String                          // 原始 IP
  userAgent     String                          // 原始 UA（截断至 500 字符）
  screenInfo    String?                         // "widthxheight"
  language      String?                         // 浏览器语言
  cookieId      String   @unique                // 写入 Cookie 的唯一 ID
  matched       Boolean  @default(false)        // 是否已被匹配消费
  expiresAt     DateTime                        // 过期时间（创建后 48 小时）
  createdAt     DateTime @default(now())

  @@index([fingerprint, matched, expiresAt])    // 指纹匹配查询
  @@index([ipAddress, matched, expiresAt])      // 模糊匹配查询
  @@index([expiresAt])                          // 过期清理
}
```

## 5. API 设计

三个接口均为 `@Public()`（无需登录态）。

### 5.1 POST /api/v1/deferred-link

创建延迟深度链接记录。

**请求体：**
```json
{
  "referralCode": "AB2C3D4E",
  "userAgent": "Mozilla/5.0 ...",
  "screenWidth": 390,
  "screenHeight": 844,
  "language": "zh-CN"
}
```

**服务端逻辑：**
1. 校验 `referralCode` 在 `MemberProfile` 中存在，不存在返回 400
2. 获取客户端 IP
3. 归一化 UA（去除微信特征）
4. 计算 `fingerprint = SHA256(IP + "|" + normalizedUA + "|" + screenInfo + "|" + language)`
5. 生成 `cookieId`（cuid）
6. 创建记录，`expiresAt = now + 48h`
7. 返回 `{ cookieId }`

**响应：**
```json
{ "cookieId": "clxyz..." }
```

### 5.2 GET /api/v1/deferred-link/resolve

通过 Cookie 中的 cookieId 查找推荐码。

**参数：** `?cookieId=clxyz...`

**服务端逻辑：**
1. 查询 `DeferredDeepLink` 表：`cookieId` 匹配 + `matched = false` + `expiresAt > now`
2. 命中 → 标记 `matched = true`，返回推荐码
3. 未命中 → 返回 null

**响应：**
```json
{ "referralCode": "AB2C3D4E" }
// 或
{ "referralCode": null }
```

### 5.3 POST /api/v1/deferred-link/match

通过设备指纹匹配推荐码（兜底）。

**请求体：**
```json
{
  "userAgent": "Mozilla/5.0 ...",
  "screenWidth": 390,
  "screenHeight": 844,
  "language": "zh-CN"
}
```

**服务端逻辑：**
1. 获取客户端 IP，归一化 UA，计算指纹哈希
2. 第一优先级：精确匹配 `fingerprint`（未消费 + 未过期 + 按 createdAt DESC 取第一条）
3. 第二优先级：模糊匹配（同 `ipAddress` + UA 相似度 > 80%，未消费 + 未过期 + 最新一条）
4. 命中 → 标记 `matched = true`，返回推荐码
5. 未命中 → 返回 null

**响应：**
```json
{ "referralCode": "AB2C3D4E" }
// 或
{ "referralCode": null }
```

## 6. 换绑逻辑修改

### 6.1 现有逻辑

`BonusService.useReferralCode()`：已绑定推荐人则拒绝（"已绑定推荐人，无法重复绑定"）。

### 6.2 新逻辑

```
检查用户是否已购买 VIP（MemberProfile.tier === 'VIP'）
  → 已购买 VIP → 拒绝："已加入 VIP 团队，无法更换推荐人"
  → 未购买 VIP → 允许换绑：
    → 更新 ReferralLink（inviterUserId + codeUsed）
    → 更新 MemberProfile.inviterUserId
```

已消费的 INVITE 红包不追回（低频场景，不值得增加复杂度）。

## 7. 网页落地页

### 7.1 路由

在现有 website 项目中新增，部署在 `app.爱买买.com` 域名下：

| 路由 | 用途 |
|------|------|
| `/r/:code` | 推荐码入口（触发指纹采集 + Cookie 存储） |
| `/download` | 通用下载入口（纯引导，无推荐逻辑） |
| `/resolve` | App 隐藏浏览器访问，读取 Cookie 并回传推荐码 |

### 7.2 `/r/:code` 页面逻辑

```
1. 从 URL 提取推荐码
2. 检测环境（iOS / Android / 微信 / 桌面）
3. 尝试 Universal Link 唤起 App（延迟 2 秒检测是否跳走）
4. 未跳走 → 显示下载引导
5. 静默执行：POST /api/v1/deferred-link → 拿到 cookieId → 写入 Cookie
```

### 7.3 `/resolve` 页面逻辑

此页面由 App 的隐藏浏览器（SFSafariViewController / Chrome Custom Tab）访问：

```
1. 读取 Cookie 中的 _ddl_id
2. 有 cookieId → 调用 GET /api/v1/deferred-link/resolve?cookieId=xxx
3. 拿到推荐码 → 重定向到 aimaimai://referral?code={CODE}
4. 无 Cookie / 匹配失败 → 重定向到 aimaimai://referral?code=none
```

App 监听 `aimaimai://referral` scheme 回调获取结果。

### 7.4 环境适配

| 环境 | 行为 |
|------|------|
| iOS Safari / 相机扫码 | 尝试 Universal Link 唤起；失败则显示 App Store 下载按钮 |
| Android Chrome / 相机扫码 | 尝试 App Link 唤起；失败则显示应用商店下载按钮 |
| 微信内置浏览器 | 不尝试唤起，直接显示引导遮罩："点击右上角 ⋯ → 在浏览器中打开" |
| 桌面浏览器 | 显示二维码（内容为当前 URL），提示"请用手机扫码" |

### 7.5 页面内容

- App logo + "爱买买"
- "加入爱买买，发现优质农产品"
- 下载按钮（自动识别 iOS / Android）
- 微信遮罩层（仅微信环境显示）

## 8. App 端实现

### 8.1 app.json 配置更新

```json
{
  "expo": {
    "scheme": "aimaimai",
    "ios": {
      "bundleIdentifier": "com.aimaimai.shop",
      "associatedDomains": ["applinks:app.xn--ckqa175y.com"]
    },
    "android": {
      "package": "com.aimaimai.shop",
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": {
            "scheme": "https",
            "host": "app.xn--ckqa175y.com",
            "pathPrefix": "/r/"
          },
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

### 8.2 Universal Link 拦截

在 `app/_layout.tsx` 中添加 URL 监听：

```
App 启动或从后台唤醒 → 检查传入 URL
  → 匹配 app.爱买买.com/r/{CODE} 模式 → 提取推荐码
  → 已登录 + 未购买 VIP → 直接调用绑定接口
  → 未登录 → 存入 AsyncStorage（key: pending_referral_code）
```

### 8.3 首次启动延迟匹配

在 `app/_layout.tsx` 中，App 首次启动时（AsyncStorage 标记 `ddl_checked = false`）：

```
步骤 1（Cookie 方式）：
  → 打开隐藏 SFSafariViewController / Chrome Custom Tab
  → 访问 app.爱买买.com/resolve
  → 监听 aimaimai://referral?code=xxx 回调
  → 拿到推荐码 → 存 AsyncStorage → 标记 ddl_checked = true

步骤 2（指纹兜底，步骤 1 未拿到时）：
  → POST /api/v1/deferred-link/match
  → 拿到推荐码 → 存 AsyncStorage → 标记 ddl_checked = true

如果两步都未拿到 → 标记 ddl_checked = true（不再重试）
```

### 8.4 注册成功后自动绑定

```
注册接口返回成功（拿到 userId + token）
  → 读取 AsyncStorage: pending_referral_code
  → 有值 → POST /api/v1/bonus/referral { code }
  → 成功 → 清除 pending_referral_code
  → 失败（推荐码无效等） → 静默忽略，清除 pending_referral_code
```

### 8.5 已登录用户扫码换绑

用户在 App 内扫了别人的推荐码（通过 scanner 页面或 Universal Link）：

```
已登录 → 调用 useReferralCode 接口
  → 成功（未购买 VIP）→ 提示"推荐人已更新"
  → 失败（已购买 VIP）→ 提示"已加入 VIP 团队，无法更换推荐人"
```

## 9. 域名与配置统一

### 9.1 域名规划

| 用途 | 域名 | Punycode |
|------|------|----------|
| 官网 | 爱买买.com | xn--ckqa175y.com |
| App Deep Link + 落地页 | app.爱买买.com | app.xn--ckqa175y.com |
| 管理后台 | admin.爱买买.com | admin.xn--ckqa175y.com |
| 卖家中心 | seller.爱买买.com | seller.xn--ckqa175y.com |

### 9.2 全局替换

所有代码中的 `nongmai.app` 或 `nongmai` 域名引用统一替换为 `app.爱买买.com`（punycode: `app.xn--ckqa175y.com`）。

涉及文件：
- `app.json`：associatedDomains
- `app/me/referral.tsx`：deepLink 变量
- `app/me/scanner.tsx`：parseReferralCode 中的 URL 匹配正则

### 9.3 服务器部署文件

部署时需要在 `app.爱买买.com` 的 `/.well-known/` 目录下放置：

**apple-app-site-association（iOS Universal Link）：**
```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAM_ID.com.aimaimai.shop",
        "paths": ["/r/*"]
      }
    ]
  }
}
```

**assetlinks.json（Android App Link）：**
```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.aimaimai.shop",
      "sha256_cert_fingerprints": ["APP_SIGNING_CERT_SHA256"]
    }
  }
]
```

## 10. 安全防护

### 10.1 威胁与对策

| 威胁 | 对策 |
|------|------|
| 刷接口伪造指纹，污染匹配池 | IP 限流：POST /deferred-link 同一 IP 10 次/小时 |
| 遍历 cookieId 窃取推荐码 | cookieId 用 cuid（25 位随机），不可猜测；resolve 接口 IP 限流 20 次/小时 |
| 指纹碰撞劫持（同 WiFi 多人） | 匹配后立即标记 matched=true（一次性消费）；精确匹配优先，模糊匹配需 IP + UA 同时相似 |
| 重放攻击 | matched=true 后不可重复消费 |
| 过期数据堆积 | 定时任务每日凌晨清理 expiresAt < now 的记录 |
| 伪造推荐码 | 创建时校验推荐码在 MemberProfile 中存在 |
| CORS 滥用 | 白名单只允许 app.爱买买.com 来源 |
| 微信 UA 差异导致指纹不匹配 | UA 归一化：去除微信特征后缀后再计算指纹 |

### 10.2 接口限流

```
POST /api/v1/deferred-link       → 同一 IP：10 次/小时
GET  /api/v1/deferred-link/resolve → 同一 IP：20 次/小时
POST /api/v1/deferred-link/match   → 同一 IP：5 次/小时
```

### 10.3 数据生命周期

- 记录创建后 48 小时过期
- 匹配成功后立即标记已消费
- 定时任务每日 03:00 清理过期记录

## 11. 涉及的现有代码修改

| 文件 | 修改内容 |
|------|---------|
| `backend/prisma/schema.prisma` | 新增 DeferredDeepLink 模型 |
| `backend/src/modules/bonus/bonus.service.ts` | useReferralCode 改为支持换绑（VIP 前） |
| `app.json` | 更新 associatedDomains、新增 Android intentFilters |
| `app/_layout.tsx` | 新增 URL 监听 + 首次启动延迟匹配逻辑 |
| `app/me/referral.tsx` | deepLink 域名替换 |
| `app/me/scanner.tsx` | URL 匹配正则域名替换 |
| `src/store/useAuthStore.ts` | 注册成功后检查并绑定 pending_referral_code |

## 12. 新增代码

| 模块 | 内容 |
|------|------|
| `backend/src/modules/deferred-link/` | DeferredLinkModule、Controller、Service、DTO |
| `website/src/pages/Referral.tsx` | 落地页（下载引导 + 指纹采集 + Cookie 存储） |
| `website/src/pages/Resolve.tsx` | Cookie 读取 + scheme 回传页面 |
| `src/services/deferredLink.ts` | App 端延迟匹配逻辑封装 |
