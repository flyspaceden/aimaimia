# 爱买买 — 第三方服务接入指南

> 本文档详细说明每个第三方服务的注册流程、API Key 获取方式、所需环境变量，以及对应代码中的替换位置。
> 获取 Key 后在 `backend/.env` 中填写对应变量即可启用真实通道。

---

## 目录

1. [微信支付 (WeChat Pay)](#1-微信支付-wechat-pay)
2. [支付宝 (Alipay)](#2-支付宝-alipay)
3. [微信登录 (WeChat OAuth)](#3-微信登录-wechat-oauth)
4. [阿里云短信 (Alibaba Cloud SMS)](#4-阿里云短信-alibaba-cloud-sms)
5. [阿里云 OSS (Cloud Storage)](#5-阿里云-oss-cloud-storage)
6. [快递100 (Kuaidi100 物流查询)](#6-快递100-kuaidi100-物流查询)
7. [高德地图 (Amap Web API)](#7-高德地图-amap-web-api)
8. [讯飞语音识别 (iFlytek STT)](#8-讯飞语音识别-iflytek-stt)
9. [Expo Push 推送通知](#9-expo-push-推送通知)
10. [环境变量汇总](#10-环境变量汇总)
11. [接入优先级建议](#11-接入优先级建议)

---

## 1. 微信支付 (WeChat Pay)

### 官方地址

| 项目 | 链接 |
|------|------|
| 官网 | https://pay.weixin.qq.com/ |
| API v3 文档 | https://pay.weixin.qq.com/doc/v3/merchant/4012072195 |
| 证书申请文档 | https://pay.weixin.qq.com/doc/v3/merchant/4012072428 |

### 前置条件

- **营业执照**（企业或个体工商户，个人无法申请）
- 法人身份证正反面照片
- 对公银行账户信息

### 注册步骤

1. 打开 https://pay.weixin.qq.com/ ，点击右上角绿色「**接入微信支付**」按钮
2. 按提示上传营业执照、法人身份证、银行账户等材料
3. 等待审核（1-2 个工作日）
4. 审核通过后，在线签约激活支付能力

### 获取 API Key

1. 以**超级管理员**身份登录商户平台
2. 进入 **账户中心 → 账户设置 → API安全**
3. 点击「**设置APIv3密钥**」— 自定义一个 32 位字符串，这是 AES-256-GCM 对称加密密钥
4. 在同一页面点击「**申请商户API证书**」— 下载证书文件（`.pem`）

### 你将获得

| 参数 | 说明 | 示例 |
|------|------|------|
| `商户号 (mchId)` | 10 位数字 | `1600000001` |
| `APIv3 Key` | 32 字节对称密钥 | 自定义字符串 |
| `商户API证书` | `.pem` 证书文件 | 下载保存到服务器 |
| `证书序列号` | 证书对应的序列号 | 平台查看 |

### 环境变量

```env
WECHAT_PAY_MCH_ID=你的商户号
WECHAT_PAY_API_V3_KEY=你的APIv3密钥
WECHAT_PAY_CERT_SERIAL=证书序列号
WECHAT_PAY_PRIVATE_KEY_PATH=./certs/wechat_pay_private_key.pem
PAYMENT_WEBHOOK_SECRET=自定义Webhook签名密钥
```

### 代码替换位置

| 文件 | 行号 | 当前状态 | 替换内容 |
|------|------|----------|----------|
| `backend/src/modules/payment/payment.service.ts` | 57-98 | `[占位] 发起渠道退款`，返回假 `REFUND-${Date.now()}` | 接入 `wechatpay-node-v3` SDK 发起真实退款 |
| 同上 | 144-263 | Webhook 回调处理（已完善） | 仅需添加微信官方签名验证 |

### 推荐 SDK

```bash
npm install wechatpay-node-v3
```

---

## 2. 支付宝 (Alipay)

### 官方地址

| 项目 | 链接 |
|------|------|
| 开放平台 | https://open.alipay.com |
| 应用管理 | https://openhome.alipay.com/platform/mas.htm |
| 创建应用文档 | https://opendocs.alipay.com/open/03k9zr |

### 前置条件

- 支付宝账号（个人可注册开发者，但收款需企业账号）
- 营业执照（企业开发者）

### 注册步骤

1. 打开 https://open.alipay.com ，使用支付宝账号登录
2. 完成手机验证 + 个人/企业信息提交
3. 选择「**自研开发服务**」（自用）
4. 进入控制台 → **我的应用 → 网页&移动应用** → 创建新应用

### 获取 API Key

1. 下载支付宝官方的「**密钥生成工具**」（支持 Windows/Mac）
2. 生成 RSA2 密钥对（PKCS1 格式）— 产出 `应用私钥` 和 `应用公钥`
3. 在应用的开发设置中，将签名方式设为「**公钥**」，上传你的 `应用公钥`
4. 支付宝会返回 `支付宝公钥` 用于验签

### 你将获得

| 参数 | 说明 |
|------|------|
| `AppId` | 应用 ID（数字） |
| `应用私钥 (APP_PRIVATE_KEY)` | 你生成的私钥，**不要泄露** |
| `支付宝公钥 (ALIPAY_PUBLIC_KEY)` | 支付宝返回的公钥，用于验证回调 |

### 环境变量

```env
ALIPAY_APP_ID=你的应用ID
ALIPAY_PRIVATE_KEY=你的应用私钥
ALIPAY_PUBLIC_KEY=支付宝公钥
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
```

### 代码替换位置

同微信支付，位于 `backend/src/modules/payment/payment.service.ts`。根据 `PaymentChannel` 枚举（`WECHAT_PAY` / `ALIPAY`）路由到对应 SDK。

### 推荐 SDK

```bash
npm install alipay-sdk
```

---

## 3. 微信登录 (WeChat OAuth)

### 官方地址

| 项目 | 链接 |
|------|------|
| 微信开放平台 | https://open.weixin.qq.com |
| 移动应用接入指南 | https://developers.weixin.qq.com/doc/oplatform/Mobile_App/Resource_Center_Homepage.html |

### 前置条件

- 微信开放平台开发者账号（需企业认证，费用 300 元/年）
- 已上架或可测试的移动应用

### 注册步骤

1. 打开 https://open.weixin.qq.com ，注册开发者账号
2. 完成企业认证（需营业执照 + 对公打款验证）
3. 进入「**管理中心 → 移动应用**」→ 创建移动应用
4. 填写应用信息（包名、签名等），提交审核
5. 审核通过后获取 `AppID` 和 `AppSecret`

### 你将获得

| 参数 | 说明 |
|------|------|
| `AppID` | 移动应用 ID（`wx` 开头） |
| `AppSecret` | 应用密钥 |

### 环境变量

```env
WECHAT_MOCK=false
WECHAT_APP_ID=你的AppID
WECHAT_APP_SECRET=你的AppSecret
```

### 代码替换位置

| 文件 | 行号 | 当前状态 | 替换内容 |
|------|------|----------|----------|
| `backend/src/modules/auth/auth.service.ts` | 209-262 | `WECHAT_MOCK=true` 时生成假 openId | 设置 `WECHAT_MOCK=false`，实现 `exchangeCodeForToken()` 调用微信 OAuth API |

---

## 4. 阿里云短信 (Alibaba Cloud SMS)

### 官方地址

| 项目 | 链接 |
|------|------|
| 短信服务产品页 | https://www.aliyun.com/product/sms/ |
| 入门指南 | https://help.aliyun.com/zh/sms/getting-started/get-started-with-sms |
| 创建模板文档 | https://help.aliyun.com/zh/sms/user-guide/create-message-templates-1 |
| API 文档 | https://help.aliyun.com/zh/sms/getting-started/use-sms-api |
| 阿里云注册 | https://account.aliyun.com/register/register.htm |
| AccessKey 管理 | https://ram.console.aliyun.com/manage/ak |

### 前置条件

- 阿里云账号（已完成实名认证）
- 营业执照（短信签名审核需要）

### 注册步骤

1. 打开 https://account.aliyun.com/register/register.htm 注册阿里云账号（支持手机/支付宝/钉钉注册）
2. 完成**实名认证**（个人或企业）
3. 进入短信服务控制台，开通短信服务

### 创建短信签名

1. 进入 **国内消息 → 签名管理**
2. 点击「添加签名」，填写签名名称（如「爱买买」）
3. 上传营业执照等证明材料
4. 等待审核（工作时间 9:00-21:00，约 2 小时）

### 创建短信模板

1. 进入 **国内消息 → 模板管理**
2. 点击「添加模板」，创建以下模板：

| 模板类型 | 用途 | 模板内容示例 | 要求 |
|----------|------|-------------|------|
| 验证码 | 登录/注册 | `您的验证码为${code}，5分钟内有效，请勿泄露。` | 必须包含「验证码/注册码/校验码/动态码」 |
| 通知短信 | 订单提醒 | `您的订单${orderNo}已发货，请注意查收。` | 无特殊限制 |

3. 等待模板审核通过，记录 `TemplateCode`（如 `SMS_123456789`）

### 获取 AccessKey

1. 打开 https://ram.console.aliyun.com/manage/ak
2. 点击「**创建 AccessKey**」
3. 完成手机/人脸验证
4. **立即保存** `AccessKey Secret`（仅显示一次！）

> **安全建议**：不要使用主账号 AccessKey，创建 RAM 子用户并仅授予短信权限 `AliyunDysmsFullAccess`

### 你将获得

| 参数 | 说明 | 示例 |
|------|------|------|
| `AccessKey ID` | 访问密钥 ID | `LTAI5t...` |
| `AccessKey Secret` | 访问密钥（仅显示一次） | `xxxxxxxx` |
| `SignName` | 短信签名 | `爱买买` |
| `TemplateCode` | 验证码模板编号 | `SMS_123456789` |

### 环境变量

```env
SMS_MOCK=false
ALIYUN_SMS_ACCESS_KEY_ID=你的AccessKeyID
ALIYUN_SMS_ACCESS_KEY_SECRET=你的AccessKeySecret
ALIYUN_SMS_SIGN_NAME=爱买买
ALIYUN_SMS_TEMPLATE_CODE=SMS_123456789
```

### 代码替换位置

| 文件 | 行号 | 当前状态 | 替换内容 |
|------|------|----------|----------|
| `backend/src/modules/auth/auth.service.ts` | 38-44 | `console.log('[SMS Mock] 验证码...')` | 设置 `SMS_MOCK=false`，调用阿里云 SMS SDK |
| `backend/src/modules/seller/auth/seller-auth.service.ts` | 29-45 | 同上（卖家端） | 同上 |

### 推荐 SDK

```bash
npm install @alicloud/dysmsapi20170525 @alicloud/openapi-client
```

---

## 5. 阿里云 OSS (Cloud Storage)

### 官方地址

| 项目 | 链接 |
|------|------|
| OSS 控制台 | https://oss.console.aliyun.com/overview |
| Bucket 管理 | https://oss.console.aliyun.com/bucket |
| OSS 帮助中心 | https://help.aliyun.com/zh/oss/ |

### 前置条件

- 阿里云账号（已完成实名认证，同短信服务共用）

### 创建 Bucket

1. 打开 https://oss.console.aliyun.com/bucket
2. 点击「**创建 Bucket**」
3. 填写配置：

| 配置项 | 推荐值 | 说明 |
|--------|--------|------|
| Bucket 名称 | `nongmai-assets` | 全局唯一 |
| 地域 | `华东1（杭州）` | 选择离服务器近的 |
| 存储类型 | `标准存储` | 图片/文件频繁访问 |
| 读写权限 | `公共读` | 图片需要公网访问 |

4. 点击确定创建

### 配置跨域 (CORS)

1. 进入 Bucket → **数据安全 → 跨域设置**
2. 添加规则：来源 `*`，允许方法 `GET, PUT, POST`，允许头 `*`

### 获取 AccessKey

同短信服务（第 4 节），使用同一个 AccessKey 即可。

### 你将获得

| 参数 | 说明 | 示例 |
|------|------|------|
| `AccessKey ID` | 同短信服务 | `LTAI5t...` |
| `AccessKey Secret` | 同短信服务 | `xxxxxxxx` |
| `Bucket` | Bucket 名称 | `nongmai-assets` |
| `Region` | 地域 | `oss-cn-hangzhou` |
| `Endpoint` | 访问域名 | `oss-cn-hangzhou.aliyuncs.com` |

### 环境变量

```env
UPLOAD_LOCAL=false
OSS_REGION=oss-cn-hangzhou
OSS_ACCESS_KEY_ID=你的AccessKeyID
OSS_ACCESS_KEY_SECRET=你的AccessKeySecret
OSS_BUCKET=nongmai-assets
OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
UPLOAD_BASE_URL=https://nongmai-assets.oss-cn-hangzhou.aliyuncs.com
```

### 代码替换位置

| 文件 | 行号 | 当前状态 | 替换内容 |
|------|------|----------|----------|
| `backend/src/modules/upload/upload.service.ts` | 52-112 | `UPLOAD_LOCAL=true`，`fs.writeFile` 存本地 | 设置 `UPLOAD_LOCAL=false`，调用 `ali-oss` SDK |
| 同上 | 130-153 | `fs.unlinkSync` 删本地文件 | 调用 OSS SDK 删除远程文件 |
| 同上 | 100-107 | 已有注释模板 | 取消注释，填入配置 |

### 推荐 SDK

```bash
npm install ali-oss
```

---

## 6. 快递100 (Kuaidi100 物流查询)

### 官方地址

| 项目 | 链接 |
|------|------|
| API 开放平台 | https://api.kuaidi100.com/ |
| 企业注册 | https://api.kuaidi100.com/register/enterprise/ |
| 管理后台 | https://api.kuaidi100.com/manager/page/myinfo/enterprise |

### 前置条件

- 企业信息（注册企业账号）

### 注册步骤

1. 打开 https://api.kuaidi100.com/ ，点击右上角「**注册**」
2. 选择「**企业注册**」
3. 填写企业基本信息，完成注册
4. 登录后进入 **管理后台 → 我的信息 → 企业信息**

### 你将获得

| 参数 | 说明 |
|------|------|
| `customer` | 企业编号（授权码） |
| `key` | 授权密钥 |

### 核心 API

| API | 用途 | 方式 |
|-----|------|------|
| 实时查询 | 主动查询快递轨迹 | POST 请求 |
| 订阅推送 | 物流状态变更时回调通知 | 配置 Webhook URL |

### 环境变量

```env
KUAIDI100_CUSTOMER=你的企业编号
KUAIDI100_KEY=你的授权密钥
KUAIDI100_WEBHOOK_URL=https://你的域名/api/v1/shipments/callback
```

### 代码替换位置

| 文件 | 行号 | 当前状态 | 替换内容 |
|------|------|----------|----------|
| `backend/src/modules/shipment/shipment.service.ts` | 48-99 | Webhook 回调 stub，无签名验证 | 添加快递100签名验证 + 主动查询 API |

### 推荐 SDK

```bash
# 快递100 无官方 Node SDK，直接用 axios 调用 REST API
npm install axios  # 已安装
```

---

## 7. 高德地图 (Amap Web API)

### 官方地址

| 项目 | 链接 |
|------|------|
| 开放平台 | https://lbs.amap.com/ |
| 创建应用和 Key | https://lbs.amap.com/api/webservice/create-project-and-key |
| 获取 Key 指南 | https://lbs.amap.com/api/webservice/guide/create-project/get-key |

### 前置条件

- 高德开放平台开发者账号（个人即可注册）

### 注册步骤

1. 打开 https://lbs.amap.com/ ，点击右上角「**注册**」创建开发者账号
2. 登录后点击「**控制台**」
3. 进入 **应用管理** → 点击「**创建新应用**」
4. 输入应用名称（如「爱买买」）和类型
5. 点击「**添加 Key**」，选择服务平台为 **Web服务**
6. 同意条款后提交

### 你将获得

| 参数 | 说明 |
|------|------|
| `Key` | Web 服务 API Key |

### 核心 API

| API | 用途 | 端点 |
|-----|------|------|
| 地理编码 | 地址 → 经纬度 | `GET /v3/geocode/geo` |
| 逆地理编码 | 经纬度 → 地址 | `GET /v3/geocode/regeo` |
| 距离计算 | 两点间距离 | `GET /v3/distance` |
| POI 搜索 | 附近农产品市场等 | `GET /v3/place/around` |

### 环境变量

```env
AMAP_API_KEY=你的WebServiceKey
```

### 代码替换位置

| 文件 | 当前状态 | 替换内容 |
|------|----------|----------|
| `backend/src/modules/address/address.service.ts` | 仅存储地址文本，无地理编码 | 添加高德 API 调用实现地址→坐标转换 |

### 推荐方式

```bash
# 高德无官方 Node SDK，直接 HTTP 调用
# 使用已有的 axios
```

---

## 8. 讯飞语音识别 (iFlytek STT)

### 官方地址

| 项目 | 链接 |
|------|------|
| 讯飞开放平台 | https://www.xfyun.cn/ |
| 文档中心 | https://www.xfyun.cn/doc/ |
| 语音转写 API | https://www.xfyun.cn/doc/asr/lfasr/API.html |

### 前置条件

- 讯飞开放平台账号（个人即可注册）

### 注册步骤

1. 打开 https://www.xfyun.cn/ ，注册账号（支持微信扫码/手机注册）
2. 完成个人认证
3. 登录后点击右上角「**控制台**」
4. 进入 **我的应用** → 创建新应用
5. 在应用详情页获取凭证

### 你将获得

| 参数 | 说明 |
|------|------|
| `APPID` | 应用 ID |
| `APISecret` | API 密钥 |
| `APIKey` | API Key |

> 免费额度：5 小时语音识别时长

### 环境变量

```env
XUNFEI_APP_ID=你的APPID
XUNFEI_API_KEY=你的APIKey
XUNFEI_API_SECRET=你的APISecret
```

### 代码替换位置

| 文件 | 行号 | 当前状态 | 替换内容 |
|------|------|----------|----------|
| `backend/src/modules/ai/ai.service.ts` | 137-188 | `TODO: 对接讯飞 STT`，mock AI 对话 | 接入讯飞 WebSocket STT API |
| 同上 | 214-236 | 关键词匹配意图识别 | 可选：接入 LLM 做意图解析 |

### 推荐 SDK

```bash
# 讯飞使用 WebSocket 协议，需用 ws 库
npm install ws  # 可能已安装
```

---

## 9. Expo Push 推送通知

### 官方地址

| 项目 | 链接 |
|------|------|
| 推送概览 | https://docs.expo.dev/push-notifications/overview/ |
| 设置指南 | https://docs.expo.dev/push-notifications/push-notifications-setup/ |
| Notifications SDK | https://docs.expo.dev/versions/latest/sdk/notifications/ |

### 特点

- **无需额外 API Key** — Expo Push 服务内置免费
- 需在**真机**上测试（模拟器不支持推送）
- iOS 需要 Apple Developer 账号配置 APNs 证书

### 前端设置步骤

1. 安装依赖：
```bash
npx expo install expo-notifications expo-device expo-constants
```

2. 在 App 入口配置通知处理器
3. 请求通知权限，获取 Expo Push Token
4. 将 Token 发送到后端存储

### 后端发送推送

```
POST https://exp.host/--/api/v2/push/send

{
  "to": "ExponentPushToken[xxxxx]",
  "title": "订单已发货",
  "body": "您的订单已发货，请注意查收",
  "sound": "default",
  "data": { "orderId": "xxx" }
}
```

### 环境变量

```env
# Expo Push 无需 API Key，但需要存储用户的 Push Token
# 可选：如果用 Expo Access Token 增加安全性
EXPO_ACCESS_TOKEN=可选的ExpoAccessToken
```

### 代码替换位置

当前后端没有推送模块，需要新建：
- 新建 `backend/src/modules/notification/` 模块
- 在用户登录时收集 Push Token 存入数据库
- 在订单状态变更、物流更新等节点调用推送 API

---

## 10. 环境变量汇总

将以下内容添加到 `backend/.env`（获取到 Key 后逐个取消注释）：

```env
# ============================================
# 现有配置（保持不变）
# ============================================
DATABASE_URL="postgresql://nongmai:nongmai123@localhost:5432/nongmai"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="nongmai-dev-jwt-secret-2026"
JWT_EXPIRES_IN="15m"
ADMIN_JWT_SECRET="nongmai-admin-dev-jwt-secret-2026"
ADMIN_JWT_EXPIRES_IN="8h"
SELLER_JWT_SECRET="nongmai-seller-dev-jwt-secret-2026"
SELLER_JWT_EXPIRES_IN="8h"
PORT=3000

# ============================================
# 1. 短信服务（阿里云 SMS）
# ============================================
SMS_MOCK=true                                    # 改为 false 启用真实短信
# ALIYUN_SMS_ACCESS_KEY_ID=你的AccessKeyID
# ALIYUN_SMS_ACCESS_KEY_SECRET=你的AccessKeySecret
# ALIYUN_SMS_SIGN_NAME=爱买买
# ALIYUN_SMS_TEMPLATE_CODE=SMS_123456789

# ============================================
# 2. 微信登录
# ============================================
WECHAT_MOCK=true                                 # 改为 false 启用微信登录
# WECHAT_APP_ID=你的AppID
# WECHAT_APP_SECRET=你的AppSecret

# ============================================
# 3. 微信支付
# ============================================
# WECHAT_PAY_MCH_ID=你的商户号
# WECHAT_PAY_API_V3_KEY=你的APIv3密钥
# WECHAT_PAY_CERT_SERIAL=证书序列号
# WECHAT_PAY_PRIVATE_KEY_PATH=./certs/wechat_pay_private_key.pem
# PAYMENT_WEBHOOK_SECRET=自定义Webhook签名密钥

# ============================================
# 4. 支付宝
# ============================================
# ALIPAY_APP_ID=你的应用ID
# ALIPAY_PRIVATE_KEY=你的应用私钥
# ALIPAY_PUBLIC_KEY=支付宝公钥

# ============================================
# 5. 云存储（阿里云 OSS）
# ============================================
UPLOAD_LOCAL=true                                # 改为 false 启用 OSS
# OSS_REGION=oss-cn-hangzhou
# OSS_ACCESS_KEY_ID=你的AccessKeyID
# OSS_ACCESS_KEY_SECRET=你的AccessKeySecret
# OSS_BUCKET=nongmai-assets
# OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
# UPLOAD_BASE_URL=https://nongmai-assets.oss-cn-hangzhou.aliyuncs.com

# ============================================
# 6. 物流查询（快递100）
# ============================================
# KUAIDI100_CUSTOMER=你的企业编号
# KUAIDI100_KEY=你的授权密钥
# KUAIDI100_WEBHOOK_URL=https://你的域名/api/v1/shipments/callback

# ============================================
# 7. 高德地图
# ============================================
# AMAP_API_KEY=你的WebServiceKey

# ============================================
# 8. 讯飞语音识别
# ============================================
# XUNFEI_APP_ID=你的APPID
# XUNFEI_API_KEY=你的APIKey
# XUNFEI_API_SECRET=你的APISecret

# ============================================
# 9. Expo Push（可选）
# ============================================
# EXPO_ACCESS_TOKEN=可选的ExpoAccessToken
```

---

## 11. 接入优先级建议

按业务关键度排序：

| 优先级 | 服务 | 理由 | 注册难度 | 预计耗时 |
|--------|------|------|----------|----------|
| **P0** | 阿里云短信 | 登录注册核心功能，无短信无法使用 | 中（需实名+签名审核） | 注册 30 分钟 + 审核 2 小时 |
| **P0** | 阿里云 OSS | 商品图片/用户头像必须持久化 | 低（同阿里云账号） | 20 分钟 |
| **P1** | 微信支付 | 订单支付核心流程 | 高（需营业执照+审核） | 注册 1 小时 + 审核 1-2 天 |
| **P1** | 支付宝 | 订单支付备选通道 | 中（RSA 密钥配置） | 注册 30 分钟 + 审核 1 天 |
| **P2** | 微信登录 | 社交登录（手机号登录已可用） | 高（需企业认证 300 元/年） | 注册 1 小时 + 审核 3-5 天 |
| **P2** | 快递100 | 物流追踪展示 | 低 | 15 分钟 |
| **P3** | 高德地图 | 地址定位辅助 | 低 | 10 分钟 |
| **P3** | 讯飞 STT | AI 语音功能增强 | 低 | 15 分钟 |
| **P3** | Expo Push | 推送通知（需新建模块） | 低（免费内置） | 前端 30 分钟 + 后端 2 小时 |

### 建议接入顺序

```
第一批（核心功能）：阿里云 SMS + 阿里云 OSS（共用一个阿里云账号）
第二批（支付流程）：微信支付 + 支付宝
第三批（体验增强）：快递100 + 高德地图 + 微信登录
第四批（AI 增强）：讯飞 STT + Expo Push
```

---

> **提示**：所有阿里云服务（SMS + OSS）共用同一个阿里云账号和 AccessKey，建议一次性注册完成。
> **安全提醒**：生产环境务必使用 RAM 子用户的 AccessKey，不要使用主账号 Key。
