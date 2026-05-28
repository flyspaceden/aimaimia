# 爱买买 — 从测试环境（staging）切换到生产环境（main）操作手册

> **适用场景**：测试环境功能验收通过，准备首次部署 / 或日常版本发布到生产
> **最后大修**：2026-05-20（基于 A12 上线前审查 v2 + 双轨/售后/发票/顺丰/App 新功能盘点）
>
> **配套文档**：
> - `docs/operations/阿里云部署.md` — 服务器/域名/数据库的实际部署状态（**真相源，gitignored**）
> - `docs/operations/github操作.md` — 双分支自动部署的触发规则
> - `docs/operations/版本管理.md` — App 三阶段发布
> - `docs/operations/密码本.md` — 真实凭据（**gitignored，本地保留**）
> - `docs/operations/app-发布与OTA手册.md` — App 维度的 OTA / Build 决策
>
> **凭据约定**：本文出现的 `<...>` 占位符，真实值一律去 `密码本.md` 取，**严禁明文写入任何会被 commit 的文件**

---

## 〇、上线前必须先确认的事（拍板项）

> **进度快照（2026-05-27 更新）**：支付宝外部配置 + 顺丰外部配置全部就位 ✅；`WEBHOOK_IP_WHITELIST` 已抄录支付宝 11 段 ✅；支付宝服务器 IP 白名单已配 ✅；website main 锁 2026-05-23 已 revert 加回 ✅。剩 **法律合规文本 1 项硬卡**（异步法务审核），加上 push main 当天的服务器部署动作。

| 项 | 状态 | 要在切换前回答 |
|----|------|----------------|
| **ICP 备案** | ✅ | `ai-maimai.com` 主域 + 子域名（`api / admin / seller / app / www`，加上各自 `test-` 前缀的测试域名）全部已通过备案 |
| **业务版本** | ⏳ | `staging` 分支当前 commit 是否就是要上生产的版本？是否已在测试环境跑完所有 critical path？包括：**消费积分双轨（提现到支付宝 + 抵扣）/ 退货顺丰面单 / 自动开票 / 售后退款失败重试** |
| **数据库迁移** | ⏳ | `backend/prisma/migrations/` 当前累计 **54 条**，**生产从未部署过**，需全量 deploy。是否已逐条 review §6.4 的清单，特别是 5 条 🔴 破坏性变更？|
| **支付宝生产配置** | ✅ | 生产 `APP_ID=2021006144601730` / PID `2088480327393784` / 4 张证书全部就位（本地 `backend/certs/alipay/`，密码本 §6.1）；APP 支付签约（2026-04-06）+ 转账签约（2026-04-11）；2026-05-26 b.alipay.com 提额材料补充完成，额度已恢复。⏳ push main 当天 `scp` 证书到生产服务器 + 写 8 行 `.env` |
| **支付宝转账（提现）订阅** | ✅ | 2026-05-26 已在开放平台订阅事件 `alipay.fund.trans.order.changed`（FROM 平台 / HTTP / 回调 `/api/v1/payments/alipay/transfer-notify`） |
| **支付宝开放平台后台配置** | ✅ | 2026-05-27 应用网关已切到生产 `https://api.ai-maimai.com/api/v1/payments/alipay/notify` + 加签方式 RSA2 公钥证书模式（密码本 §6.1） |
| **支付回调 IP 白名单** | ✅ | 2026-05-27 已抄录支付宝异步通知 11 段（10 IPv4 CIDR + 1 IPv6）写入 `.env.prod` 的 `WEBHOOK_IP_WHITELIST`（详见密码本 §6.1「IP 白名单清单」）。上线后需每周扫 nginx log 验证有无段外 IP。**注意**：顺丰 callback / 微信支付 notify **都不挂** `WebhookIpGuard`（顺丰靠 URL token，微信靠 RSA 签名），无需写入；详见 `shipment.controller.ts:54` 和 `payment.controller.ts:184` |
| **支付宝服务器 IP 白名单** | ✅ | 2026-05-27 已配置：模式「配置全量接口」+ IP `8.163.16.32`（ssh 实测 ECS 出站 IP）。AppID `2021006144601730` 名下所有接口强制走此 IP，纵深防御应用私钥泄露 → 攻击者从其他 IP 也调不动支付宝 OpenAPI（含转账接口）。详见密码本 §6.1「服务器 IP 白名单」 |
| **顺丰生产凭证** | ✅ | 生产 clientCode `HHNYKCL5OWXM` / checkWord `mO1AN9899...` / 月结账号 `7551253482` / 面单模板 `fm_150_standard_HHNYKCL5OWXM` / 推送 secret 全部下发并存入密码本 §7。沙箱 6 个核心 API 联调通过 |
| **顺丰生产 API 上线审核** | ✅ | 2026-05-27 丰桥后台 6 个核心 API（下订单/云打印/路由查询/订单结果查询/订单确认取消/订单筛选）+ 2 个推送接口生产环境上线审核全部通过，可走真金真单。剩真机端到端待第一笔生产订单验证 |
| **顺丰丰桥后台推送配置** | ✅ | 2026-05-26 已在丰桥后台为 RoutePushService + PushOrderState 两个推送接口配置生产 URL（都带 token 段，状态"已上线"）。两推送共享后端同一 endpoint `/sf/callback/:token`，按 body 结构自动分发 |
| **App 渠道** | ⏳ | 本次切换是否需要同步发 App OTA / Build？走 EAS `production` profile，与 web 部署是两件事。**关沙箱开关（`EXPO_PUBLIC_ALIPAY_SANDBOX=false`）属 env 改动必须 Build，不能 OTA** |
| **微信支付入口** | ⏳ | v1.0 `EXPO_PUBLIC_WECHAT_PAY_AVAILABLE` 留空 → 微信入口灰掉。开启前置：①微信商户 APP 支付权限审核 ②生产凭据 + 证书写 .env ③真金联调 ④改 eas.json 加 env 重新 Build（密码本 §十三 链条已细化） |
| **website main 锁** | ✅ | 2026-05-23 commit `8905a6d` 已 revert 临时去掉的状态，恢复 `&& github.ref == 'refs/heads/main'` 锁。当前 `.github/workflows/deploy-website.yml:101`（website 站点）+ line 255（huahai 站点）两个共用物理目录的站点都已上锁，admin/seller/backend 按分支分流不需要锁 |
| **法律合规文本** | ❌ | `src/content/legal/privacyPolicy.ts` + `termsOfService.ts` 是否已填实？两份文件目前是起草模板，含大量【待填】字段（公司全称 / 注册地址 / 统一社会信用代码 / 联系方式），文件头部明确写"**正式上线前必须经法律顾问审核**"。App 上架审核（U06）+ 上架合规（`app-compliance-guide.md`）也会卡这一项 |
| **回滚预案** | ⏳ | 已确认回滚命令（见末尾「九、回滚预案」）+ 5 条破坏性 migration 的 fail-forward 策略 |
| **环境共用资源已知** | ⏳ | 是否已 review §1.1「staging↔prod 共用资源风险表」？特别是 Redis 单实例共用、阿里云配额按账户级共享。OSS 已 2026-05-26 启用硬隔离独立 bucket ✅ |
| **手动改动有记录** | ⏳ | 上线前后所有"绕过 git"的人工动作（宝塔 / 阿里云控制台 / 支付宝&微信&顺丰商户后台 / 服务器 .env / pg SQL）是否在动作完成后**立刻**写入 §1.2 列的归属文档？|

任何一项答不上来，**先停下，不要 push main**。

---

## 一、整体差异速查（staging vs production）

> 来源：`.github/workflows/deploy-website.yml:69-92`（按分支 detect-changes 输出 + Determine environment）

| 维度 | Staging（测试） | Production（生产） |
|------|----------------|-------------------|
| Git 分支 | `staging` | `main` |
| 后端进程名 | `aimaimai-api-test` | `aimaimai-api-prod` |
| 后端端口 | `3001` | `3000` |
| 后端源码目录 | `/www/wwwroot/aimaimai-staging-src` | `/www/wwwroot/aimaimai-prod-src` |
| 后端域名 | `test-api.ai-maimai.com` | `api.ai-maimai.com` |
| Admin 站点 | `test-admin.ai-maimai.com` → `/www/wwwroot/test-admin/` | `admin.ai-maimai.com` → `/www/wwwroot/admin/` |
| Seller 站点 | `test-seller.ai-maimai.com` → `/www/wwwroot/test-seller/` | `seller.ai-maimai.com` → `/www/wwwroot/seller/` |
| Website 站点 | 只在 main 推送时部署到 `/www/wwwroot/website/`（main 锁已恢复，详见 §4.2）| `/www/wwwroot/website/` |
| 数据库 | `testaimaimai` / 用户 `testaimaimai` | `aimaimai` / 用户 `aimaimai` |
| `NODE_ENV` | `staging` | **`production`** ← 触发 CORS 强校验 + Webhook IP 强校验 + AlipayService 证书加载失败硬抛 |
| 支付宝 | 沙箱 `openapi-sandbox.dl.alipaydev.com`（公钥模式）| 正式 `https://openapi.alipay.com/gateway.do`（**RSA2 证书模式**）|
| 顺丰 | `SF_ENV=UAT` 走 `SF_API_URL_UAT` 沙箱地址 + `SF_MONTHLY_ACCOUNT_UAT=7551234567` | **`SF_ENV=PROD`** 走 `SF_API_URL` 正式地址 + 真实月结账号 |
| 顺丰推送签名 | `SF_PUSH_SECRET` 任意 32 位 hex | **生产环境启动期强校验**：未配置则 `SfExpressService.onModuleInit` 抛异常 |
| 短信 | 真实（华海签名） | 真实（同签名，模板可换可不换）|
| OSS Bucket | `huahai-aimaimai` | **`huahai-aimaimai-prod`**（2026-05-26 新建独立 bucket + 独立 RAM 子账号 `aimaimai-prod-oss`，详见密码本 §4.3.2）|
| App `EXPO_PUBLIC_API_BASE_URL` | `https://test-api.ai-maimai.com/api/v1` | `https://api.ai-maimai.com/api/v1` |
| App 支付宝沙箱开关 | `EXPO_PUBLIC_ALIPAY_SANDBOX=true` | **`false`**（**env 改动必须 Build，不能 OTA**）|
| App OTA Channel | `preview` | `production` |

### 1.1 staging ↔ prod 共用资源风险表（隐形通道汇总）

代码层面已彻底隔离（不同分支 / 进程 / 目录 / 域名 / 数据库），但**有 5 类"隐形通道"会跨环境**。任何在 staging 做的事可能通过这些通道影响生产，必须有意识地管理：

| # | 通道 | 共用程度 | 已知风险 | 缓解状态 |
|---|------|---------|---------|---------|
| ① | **migration 文件** | 同一代码库 | staging 跑通的 migration push main 后自动在生产数据库执行；5 条 🔴 不可纯 SQL 回退 | ✅ §六整章 + §6.4 54 条逐条标级 + §九 回滚预案。**每次 push main 必须 review** |
| ② | **OSS bucket** | **已硬隔离**：staging 用 `huahai-aimaimai`，prod 用 `huahai-aimaimai-prod`（2026-05-26 新建） | 物理隔离 → 不会污染、不会误删跨环境、独立账单/RAM 子账号 | ✅ 已实现。AccessKey ID `LTAI5t6N4HK8e6Qj26NGsXjg` 曾在 Claude 对话出现，**上线前需在 RAM 控制台轮换**（密码本 §4.3.2 + §4.3.3 已留 checklist）|
| ③ | **Redis 实例** | 同一 `127.0.0.1:6379` | 业务 cache key 有 namespace 不会撞 ✅；**但 Socket.IO Redis adapter 的跨实例广播 channel `socket.io#${ns}#` 会让 staging 和 prod 互发事件**（理论上生产用户能收到 staging 触发的客服/订单 WS 推送）| ⚠️ 实际影响：staging 当前无真实用户流量，**无感**。中期建议给 Redis adapter 加 `key: 'prod:' / 'staging:'` 前缀（`RedisIoAdapter` 改 10 行）。短期缓解：staging 永远不接真客服会话 |
| ④ | **阿里云账号配额**（SMS / OSS / DashScope） | 共用 RAM AccessKey | staging 测试发短信 / 调 AI / 上传图 → 全用生产账户配额计费 | ⚠️ 详见 §1.2 配额风险表。**短信 / OSS 成本可忽略；DashScope 按 token 计费要监控** |
| ⑤ | **手动改动** | 完全绕过 git | 改宝塔站点 / 阿里云控制台 / 支付宝&微信&顺丰商户后台 / 服务器 `.env` / `psql -c "UPDATE ..."` 等 = 谁改了别人不知道 = **回滚找不到** | ⚠️ §1.3 集中清单 + 强制要求"动作完成立刻记录"|

⚠️ 这 5 类**不在 GitHub Actions 自动监管范围内**——靠纪律和文档。

### 1.2 阿里云账号配额风险（共用资源 ④）

| 资源 | 单价 / 配额 | staging 实际用量预估 | 风险等级 |
|------|------------|---------------------|---------|
| **短信**（SMS） | 0.045 元/条 | staging 测试每天 ≤ 50 条 → 月 < 70 元 | 🟢 可忽略 |
| **OSS 存储** | 0.12 元/GB·月 | staging 上传测试图 < 1GB | 🟢 可忽略 |
| **OSS 流量**（外网下行） | 0.50 元/GB | 用户访问 staging 产品图 < 1GB/月 | 🟢 可忽略 |
| **DashScope（百炼）** | 按 token 计费，qwen-plus 输入 0.0008 元/千 token / 输出 0.002 元/千 token | AI 语音意图解析每次 ≈ 200 token，staging 真机测每天 ≤ 100 次 → 月 < 5 元 | 🟡 **要监控**：若 staging 集成测试自动化调起 AI，token 可能暴涨 |
| **阿里云 DirectMail** | 0.10 元/封 | 邮箱验证码 / 找回密码 < 100 封/月 | 🟢 可忽略 |
| **阿里云 ECS** | 共用一台 ECS 跑 staging + prod | 单进程 ~200MB RAM × 2 = 400MB / 4 核机器 | 🟢 已规划 |

**建议**：每月初查一次阿里云费用账单（`https://usercenter2.aliyun.com/finance/expense-report`），如某项突然涨 10× 立即排查 staging 是否有泄漏（如 AI 调用死循环）。

### 1.3 手动改动归属文档清单（共用资源 ⑤）

这些动作**完全不进 git**，必须在动作完成的当天写入对应文档，否则一个月后没人记得改过什么：

| 动作类型 | 归属文档 | 段落示例 |
|---------|---------|---------|
| 新建宝塔站点 / 改 Nginx / 申请 SSL | `阿里云部署.md` | "变更日志 2026-MM-DD" |
| 服务器 `.env` 任何字段变更 | `阿里云部署.md` + `密码本.md` | 后者放真实值，前者写变更原因和日期 |
| 装新服务（Redis / PG / Node）/ 改 PM2 配置 | `阿里云部署.md` | 第三节"服务器环境" |
| 数据库直跑 `psql` SQL（数据修复 / 排查） | `阿里云部署.md` "SQL 操作记录" | 含完整 SQL + 影响行数 + 操作人 + 原因 |
| 支付宝商户后台改设置（应用网关 / 回调 / 事件订阅 / 加签方式）| `密码本.md §6.1` | "已签约能力" + 改动日期 |
| 微信开放平台 / 微信支付商户后台 | `密码本.md §5.1 / §5.2` | "上线前 checklist" |
| 顺丰丰桥后台（推送地址 / 模板变更）| `密码本.md §7` | 推送回调 secret + 改动日期 |
| 阿里云控制台改（短信模板 / OSS 权限 / RAM 子账号）| `密码本.md §4.x` | 对应子节 |
| App 商店改（华为 / 小米 / 应用宝 上架材料）| `app-发布与OTA手册.md §六` + `app-compliance-guide.md` | 上架记录 |
| EAS Build / OTA 任何动作 | `app-发布与OTA手册.md §六` + memory `project_app_release_status` | 当前 APK 状态快照 |

**强制纪律**：任何手动改动后必须立即同步对应文档；如发现"线上某行为变了但代码没改"，第一时间查这些文档。

---

## 二、后端 `.env` 逐项差异（**最容易踩坑的部分**）

> 📍 生产 `.env` 物理路径：`/www/wwwroot/aimaimai-prod-src/backend/.env`
> 📍 修改后必跑：`pm2 reload aimaimai-api-prod --update-env`（**`--update-env` 不能漏，否则进程读不到新值**；reload 失败再 restart）

### 2.1 必改字段对照表

| 变量 | Staging 值 | Production 值 |
|------|-----------|--------------|
| `NODE_ENV` | `staging` | **`production`** |
| `PORT` | `3001` | `3000` |
| `DATABASE_URL` | `postgresql://testaimaimai:<TEST_DB_PASSWORD>@127.0.0.1:5432/testaimaimai` | `postgresql://aimaimai:<PROD_DB_PASSWORD>@127.0.0.1:5432/aimaimai` |
| `REDIS_URL` | `redis://127.0.0.1:6379` | 同左（与 staging 共用 Redis 实例。**注意**：若有 key 冲突需为生产单独起 Redis db index 或换实例。Socket.IO Redis adapter 也会用，未配置则降级 in-memory 单实例广播）|
| `TRUST_PROXY` | （可留空）| **`1`**（宝塔 Nginx 反代后必须配，否则 `req.ip` 拿到 127.0.0.1，WebhookIpGuard 直接拒所有真实回调；详见 `main.ts:35`）|
| `CORS_ORIGINS` | 含 `test-*.ai-maimai.com` + Punycode | **去掉 `test-` 前缀**：`https://admin.ai-maimai.com,https://seller.ai-maimai.com,https://api.ai-maimai.com,https://app.ai-maimai.com,https://ai-maimai.com,https://www.ai-maimai.com` + 保留中文域名 Punycode `https://xn--ckqa175y.com,...`（301 跳转完成前不能删）|
| `JWT_SECRET` | `<TEST_JWT_SECRET>` | **`<PROD_JWT_SECRET>`（重新生成，禁止复用 staging）** |
| `ADMIN_JWT_SECRET` | `<TEST_ADMIN_JWT_SECRET>` | **`<PROD_ADMIN_JWT_SECRET>`（独立，与 JWT_SECRET 不同）** |
| `SELLER_JWT_SECRET` | `<TEST_SELLER_JWT_SECRET>` | **`<PROD_SELLER_JWT_SECRET>`（独立）** |
| `JWT_EXPIRES_IN` | `15m` | `15m`（access token 15 分钟；refresh 30 天写死在代码里）|
| `DATA_ENCRYPTION_KEY` | （可留空，兜底走 `JWT_SECRET` → `'nongmai-dev-data-key'`）| **`<PROD_DATA_ENCRYPTION_KEY>`（32 字节随机 hex，用于 PII 字段 AES-256-GCM 加密）**。**强烈建议生产必填**：`encryption.ts:20-26` 的兜底顺序是 `DATA_ENCRYPTION_KEY → JWT_SECRET → 弱默认`，若依赖 JWT_SECRET 作为加密 key，则 JWT 泄露 = 加密 key 同步泄露（发票 bankInfo / 税号等 PII 全暴露），必须独立配置 |
| `PAYMENT_WEBHOOK_SECRET` | `<TEST_PAYMENT_WEBHOOK_SECRET>` | **`<PROD_PAYMENT_WEBHOOK_SECRET>`（独立，HMAC-SHA256）** |
| `LOGISTICS_WEBHOOK_SECRET` | `<TEST_LOGISTICS_WEBHOOK_SECRET>` | **`<PROD_LOGISTICS_WEBHOOK_SECRET>`（独立）** |
| `WEBHOOK_IP_WHITELIST` | 可留空（开发环境放行）| **必填**：`<支付宝生产回调IP段>`，逗号分隔，支持 CIDR。**为空时 `NODE_ENV=production` → 所有挂 `WebhookIpGuard` 的 webhook 直接 `ForbiddenException`，支付订单永远停在未支付**（`webhook-ip.guard.ts:40-44`）。**只配支付宝**：顺丰 callback / 微信支付 notify 不在守卫范围内（`shipment.controller.ts:54` / `payment.controller.ts:184`），各自靠 token / RSA 签名独立防伪 |
| `WECHAT_MOCK` | `false` | `false` |
| `WECHAT_APP_ID` | `wxeb8e8dc219da02dd`（当前两环境共用同一应用）| 同左 + 在微信开放平台后台**确认 release keystore 签名 MD5 已注册**（详见密码本 §11.1）|
| `WECHAT_APP_SECRET` | `<TEST_WECHAT_SECRET>` | 同左 |
| `SMS_MOCK` | `false`（2026-04-19 起 staging 也真实发） | `false` |
| `SMS_ACCESS_KEY_ID` / `SMS_ACCESS_KEY_SECRET` | 共用阿里云 RAM 账号 | 同左 |
| `SMS_SIGN_NAME` | `深圳华海农业科技集团` | 同左 |
| `SMS_TEMPLATE_CODE` | `<TEST_SMS_TEMPLATE>` | **生产模板**（如已为生产单独审核了模板号，需切换；否则共用 `SMS_501860621`）|
| `EMAIL_SMTP_HOST/PORT/USER/PASS` | 阿里云 DirectMail（邮箱验证码）| 同左 |
| `OSS_BUCKET` | `huahai-aimaimai` | **`huahai-aimaimai-prod`**（2026-05-26 新建独立 bucket）|
| `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | 共用 §4.1 主账号 Key `LTAI5tC8...` | **独立 RAM 子账号** `aimaimai-prod-oss` 的 Key（密码本 §4.3.2，⚠️ 上线前需轮换消除 Claude 污点）|
| `OSS_REGION` | `oss-cn-hangzhou` | 同左（生产 bucket 同地域）|
| `UPLOAD_LOCAL` | `false`（OSS 生产） | `false` |
| `UPLOAD_LOCAL_PRIVATE` | `false` | `false`（启用私有签名静态资源时改 true）|
| `INVOICE_PDF_ALLOWED_URL_PREFIXES` | 默认走 OSS / UPLOAD_BASE_URL | 同左（如手工开票要上传 PDF 到第三方 CDN，在此列前缀白名单）|
| `INVOICE_PROVIDER_RESET_AFTER_MINUTES` | `10` | `10`（Provider 开票预占超过 N 分钟后管理端才能重置）|
| `SF_ENV` | `UAT` | **`PROD`** |
| `SF_API_URL` | `https://bsp-oisp.sf-express.com/std/service`（生产地址，仅当 `SF_ENV=PROD` 时使用）| 同左 |
| `SF_API_URL_UAT` | `https://sfapi-sbox.sf-express.com/std/service`（沙箱，仅 `SF_ENV=UAT` 使用） | 留空或同左（生产不读）|
| `SF_CLIENT_CODE` / `SF_CHECK_WORD` | UAT 凭据（`HHNYKCL5OWXM` 等） | **生产凭据**（顺丰商务下发的正式 clientCode / checkWord，与 UAT 完全不同）|
| `SF_MONTHLY_ACCOUNT_UAT` | `7551234567`（顺丰统一沙箱卡）| 留空或同左（生产不读）|
| `SF_MONTHLY_ACCOUNT_PROD` | 留空 | **生产月结账号**（联调通过后顺丰下发）|
| `SF_CALLBACK_URL` | `https://test-api.ai-maimai.com/api/v1/shipments/sf/callback/<SF_PUSH_SECRET>` | **`https://api.ai-maimai.com/api/v1/shipments/sf/callback/<生产SF_PUSH_SECRET>`**（改完后还要去顺丰丰桥后台同步）|
| `SF_PUSH_SECRET` | 32 位 hex（`openssl rand -hex 16`）| **重新生成 32 位 hex**（启动期校验：生产 + 空值 → 抛异常）|
| `SF_TEMPLATE_CODE` | UAT 模板（以 `_<SF_CLIENT_CODE>` 结尾）| **生产模板**（同样以生产 `_<SF_CLIENT_CODE>` 结尾，启动校验后缀）|
| `SF_ALLOW_E2E_MOCK` | `false` | `false`（生产强制不可启用）|
| `DASHSCOPE_API_KEY` | `<DASHSCOPE_KEY>` | 同左（共用阿里云百炼账号，按 quota 计费）|
| `ALIPAY_APP_ID` | `9021000162667503`（沙箱） | **`<ALIPAY_PROD_APP_ID>`** |
| `ALIPAY_PRIVATE_KEY_PATH` | （沙箱用 `ALIPAY_PRIVATE_KEY` 公钥模式）| **`certs/alipay/app-private-key.txt`** |
| `ALIPAY_APP_CERT_PATH` | （沙箱无）| **`certs/alipay/appCertPublicKey.crt`** |
| `ALIPAY_PUBLIC_CERT_PATH` | （沙箱无）| **`certs/alipay/alipayCertPublicKey.crt`** |
| `ALIPAY_ROOT_CERT_PATH` | （沙箱无）| **`certs/alipay/alipayRootCert.crt`** |
| `ALIPAY_GATEWAY` | `https://openapi-sandbox.dl.alipaydev.com/gateway.do` | **`https://openapi.alipay.com/gateway.do`** |
| `ALIPAY_ENDPOINT` | `https://openapi-sandbox.dl.alipaydev.com` | **`https://openapi.alipay.com`** |
| `ALIPAY_NOTIFY_URL` | `https://test-api.ai-maimai.com/api/v1/payments/alipay/notify` | **`https://api.ai-maimai.com/api/v1/payments/alipay/notify`**（必须带 `/api/v1` 前缀，否则回调打到 404；`alipay.service.ts:105` 在 `createAppPayOrder` 时显式传给支付宝）|

> **注**：`ALIPAY_TRANSFER_NOTIFY_URL` env **代码当前不读**（`alipay.fund.trans.uni.transfer` API 不接受 notify_url 入参），转账 webhook 是支付宝开放平台**账户级订阅**配置，不在代码里。详见 §三 第 2 行的运营操作。
| `BODY_LIMIT` | （默认 `1mb`） | 同左（除非有大文件上传业务）|
| `AI_SEMANTIC_SLOTS_ENABLED` | `true` | 默认 `true`，按上线节奏决定先关闭再灰度 |
| `AI_PRODUCT_SEMANTIC_FIELDS_ENABLED` | `false` | `false`（v1.0 暂不启用，留 v1.1）|
| `AI_SEMANTIC_SCORING_ENABLED` | `false` | `false`（同上）|

### 2.2 启动强校验（生产专属）

后端启动时会做以下强校验，**任何一项不通过都会拒绝启动 / 拒绝业务**：

1. `backend/src/main.ts:71-73` — `isProduction && !CORS_ORIGINS` → `throw Error('生产环境必须配置 CORS_ORIGINS')`，进程起不来
2. `backend/src/common/guards/webhook-ip.guard.ts:40-44` — `NODE_ENV=production` 且未配 `WEBHOOK_IP_WHITELIST` → **所有挂 `WebhookIpGuard` 的 webhook 路由**（仅支付宝 notify/refund/transfer-notify 三条，见 `payment.controller.ts:52/73/305`）抛 `ForbiddenException`，支付订单永远停在未支付。顺丰 callback 和微信支付 notify 不受影响
3. **`backend/src/modules/shipment/sf-express.service.ts:onModuleInit`** — `SF_ENV=PROD` 且未配 `SF_PUSH_SECRET` → 抛异常；`SF_TEMPLATE_CODE` 后缀必须以 `_<SF_CLIENT_CODE>` 结尾，否则抛
4. **`backend/src/modules/payment/alipay.service.ts:onModuleInit`** — 生产 + 证书加载失败 → 抛异常（之前是静默降级，C11 已修）
5. **`backend/src/modules/admin/auth/admin-auth.module.ts:16` / `seller-auth.module.ts:19`** — 三个 JWT secret 全部 `getOrThrow`，缺一个就起不来

### 2.3 .env.example 当前缺失的占位（**部署前需手动加到生产 .env**）

`backend/.env.example` 目前**未声明**以下生产必配项（应当补占位行）：

- `CORS_ORIGINS=` — 生产空值会启动 throw
- `ALIPAY_NOTIFY_URL=` — 只在注释里（line 99/106），代码实际从 env 读
- `DATA_ENCRYPTION_KEY=` — 加密 fallback 会偷偷复用 JWT_SECRET
- `TRUST_PROXY=` — 反代下必须配 1

**这 4 个不补到 .env.example 不影响生产部署**（直接写到生产 `.env` 即可），但建议合并到 staging 测试期内一起补。

注：`ALIPAY_TRANSFER_NOTIFY_URL` 不在此列——代码完全不读它，是纯运营 checklist 项（开放平台后台订阅），无需在 .env 占位。

---

## 三、第三方服务回调地址（容易遗漏，必须逐个开台子改）

| 服务 | 后台位置 | 改成什么 |
|------|---------|---------|
| **支付宝（开放平台正式应用）** | open.alipay.com → 应用详情 → 开发设置 → **应用网关** + **回调地址** | `https://api.ai-maimai.com/api/v1/payments/alipay/notify`（注意：实际生效的是下单时后端传的 `notify_url`，但开放平台后台的"应用网关"是兜底，必须同步配）|
| **支付宝转账 webhook（消费积分提现）** | 同上 → **事件订阅** → 选择 `alipay.fund.trans.order.changed` | **`https://api.ai-maimai.com/api/v1/payments/alipay/transfer-notify`**（**不配置**则提现到账只能靠后端 cron 每 10 分钟主动查询，用户体感"卡 5-10 分钟"）。注意：转账接口本身不接受 notify_url 入参，必须在开放平台后台账户级订阅 |
| **支付宝授权回调域名** | 同上 → 授权回调地址 | `https://api.ai-maimai.com`、`https://app.ai-maimai.com` |
| **顺丰丰桥（正式环境）** | 联系顺丰商务 / 丰桥后台 → 路由推送配置 | `https://api.ai-maimai.com/api/v1/shipments/sf/callback/<SF_PUSH_SECRET>`（**末尾 secret 段必须与后端 `.env` 一致**，双源信任防伪造）|
| **微信开放平台（移动应用）** | open.weixin.qq.com → 应用详情 → 开发信息 | 包名 `com.aimaimai.shop` + **release keystore 签名 MD5**（`76:6B:AF:B6:A3:B3:4A:67:87:61:E4:B0:7E:36:65:C4`，与 EAS 上传的 keystore 一致）|
| **阿里云短信** | dysms.console.aliyun.com → 国内消息 → 模板管理 | 若生产单独建了模板，把生产 `SMS_TEMPLATE_CODE` 写进 `.env`；签名"深圳华海农业科技集团"沿用 |
| **阿里云 OSS** | 共用 bucket，无需改 | 同 staging |
| **阿里云 DirectMail** | mail.aliyun.com → 发件人地址 | 已配 `noreply@mail.ai-maimai.com`，无需改 |
| **DashScope（百炼）** | 共用 KEY，无需改 | 同 staging |

---

## 四、前端三端（admin / seller / website）切换

### 4.1 自动化部分（GitHub Actions 已处理）

`.github/workflows/deploy-website.yml` 已按分支注入构建变量（line 72-91）：

- 推 `main` → `VITE_API_BASE_URL=https://api.ai-maimai.com/api/v1` + `VITE_WS_BASE_URL=https://api.ai-maimai.com`，部署到 `/www/wwwroot/admin/` `/www/wwwroot/seller/` `/www/wwwroot/website/`
- 推 `staging` → `VITE_API_BASE_URL=https://test-api.ai-maimai.com/api/v1`，部署到 `/www/wwwroot/test-admin/` `/www/wwwroot/test-seller/` + **临时**也部署到 `/www/wwwroot/website/`

`admin/.env` `seller/.env` 里写的是**本地开发值**（`http://localhost:3000/api/v1`），**不会**进生产构建产物——构建时由 workflow 用 inline env 覆盖。**不需要手动改这两个文件**。

### 4.2 website main 锁（✅ 2026-05-23 已恢复）

`.github/workflows/deploy-website.yml:101` 当前是：
```yaml
if: needs.detect-changes.outputs.website == 'true' && github.ref == 'refs/heads/main'
```

历史背景：2026-05 早期为赶华为隐私政策抢上架，临时去掉过这个 `github.ref` 条件让 staging 推送也部署 website。2026-05-23 commit `8905a6d` 已 revert 加回。huahai 站点（line 255）也是同样的锁。

**作用**：避免 staging push 用 staging build 覆盖 `/www/wwwroot/website/`，导致生产官网回到测试版（连测试 API + 测试数据库）。

如未来再次为某种紧急原因临时去掉，**必须**在解封后第一时间通过新的 revert PR 加回，且每次去掉前先看一眼本节确认理解后果。

### 4.3 需要人工确认的部分

1. **Nginx 站点存在且已配 SSL**：`admin.ai-maimai.com` / `seller.ai-maimai.com` 在宝塔有站点 + 已签 SSL，根目录指向 `/www/wwwroot/admin/` / `/www/wwwroot/seller/`
2. **SPA fallback**：宝塔站点伪静态加 `try_files $uri $uri/ /index.html;`，否则刷新页面 404
3. **CORS 同源**：前端域名必须出现在后端 `CORS_ORIGINS` 里（见 §2.1）
4. **超管账号**：生产数据库不要复用 staging 的 `admin / 123456`，**首次部署后立刻在管理后台改密**（"账号安全"页面）

---

## 五、买家 App 切换（与 web 解耦，独立流程）

### 5.1 EAS Build / OTA 配置

`eas.json` 已写好 `production` profile：
- `EXPO_PUBLIC_API_BASE_URL=https://api.ai-maimai.com/api/v1`
- `EXPO_PUBLIC_ALIPAY_SANDBOX=false` ← **生产必须 false**，否则 App 会调沙箱网关，生产订单全部失败
- `EXPO_PUBLIC_ENV=production` ← 触发 `app/_layout.tsx` 的 `<EnvBanner />` 不渲染（preview / development build 顶部有 22px 红色"测试环境"横条，生产 build 无）
- `channel=production`、Android `app-bundle`、`autoIncrement=true`

**单包名方案约束**（2026-05-27 起）：

包名 `com.aimaimai.shop` android/ios 共用，无法在同一台手机同时装测试和生产版本。测试机和生产机靠物理设备隔离：

- 测试团队的手机永远只装 internal distribution 的 `preview` / `development` build（顶部有红条 + 走 test-api + 支付宝沙箱）
- 真实用户永远从应用商店下载 `production` build（无红条 + 走 api + 支付宝真金）
- 同一台手机切换环境 = 卸载重装
- 微信 / 支付宝回调只有一套（生产环境），preview / development 的支付必走沙箱；微信支付沙箱能力受限，真金联调必须用生产环境真实小额订单

### 5.2 何时发 OTA / 何时发 Build

按 `docs/operations/app-发布与OTA手册.md` 的决策表判断。要点：
- **JS 层改动**（页面、文案、调用 API） → OTA：`eas update --branch production --message "..."`
- **原生层 / 依赖 / 权限 / 配置变更**（`app.json` / 新插件 / 新依赖 / 改 `android.package` / **关闭沙箱开关**） → Build：`eas build --profile production --platform android`
- **关闭支付宝沙箱**（`EXPO_PUBLIC_ALIPAY_SANDBOX=true → false`）属于 **eas.json env 改动 → 必须 Build，不能 OTA**（env 是构建时内联）
- **模块顶层副作用 / 新增 native 模块** → 必须 Build（参考 memory `feedback_ota_top_level_side_effects.md` — 顶层 require 副作用会导致 OTA 白屏）

### 5.3 深链域名

`app.json` 已配 `app.ai-maimai.com`：
- Android `intentFilters` → `host: app.ai-maimai.com` + `pathPrefix: /r/`
- iOS `associatedDomains` → `applinks:app.ai-maimai.com`

确认 `app.ai-maimai.com` 已部署 `apple-app-site-association` 和 `assetlinks.json`（详见 `docs/superpowers/specs/2026-03-27-deferred-deep-link-design.md`）。

### 5.4 App 上线后的状态记录

每次 `eas build` / `eas update` 完成后，**必须**更新：
- `docs/operations/app-发布与OTA手册.md` 第六章（当前 OTA / 当前 APK 状态）
- `docs/operations/阿里云部署.md` 中与 App 生产发布相关的实际部署记录

---

## 六、数据库迁移（破坏性最高，要最小心）

### 6.1 自动化部分

GitHub Actions backend job（`deploy-website.yml:233-238`）会按顺序跑：
```
npx prisma generate
npx prisma migrate deploy
npm run build
pm2 reload aimaimai-api-prod --update-env
```

这意味着：
- ✅ 推 `main` 自动应用 `backend/prisma/migrations/` 里所有未上生产的迁移
- ❌ **不会**自动跑 `db seed`（生产**严禁** seed，会重置基础数据）
- ❌ **不会**自动备份（push 前必须人工备份）

### 6.2 push main 前必做

```bash
# 1. 服务器上备份当前生产库（在阿里云 ECS 上跑，首次部署因为是空库也建议留一份基线）
ssh <SERVER>
mkdir -p /www/backup
pg_dump -Fc -d aimaimai -f /www/backup/aimaimai_$(date +%Y%m%d_%H%M%S).dump

# 2. 本地检查本次推送的迁移
git log staging --oneline ^main -- backend/prisma/migrations/

# 3. 逐个判断破坏性（按 §6.4 表对照等级）
```

### 6.3 破坏性变更的反向 SQL

`prisma migrate deploy` **没有自动 down 命令**，必须人工写反向 SQL。**Enum ADD VALUE 不可纯 SQL 回退**——PostgreSQL 不支持删枚举值，只能 fail-forward（修代码不修库）。

任何破坏性变更，**push main 前**必须把对应的反向 SQL 写进 PR 描述或本文档「十、本次发布的差异与反向操作」模板对应的发布记录。

### 6.4 当前累计迁移清单（54 条，按时序）

**生产从未部署，需全量一次性 deploy**。等级标记：🟢 安全（加表 / 加可空字段 / 加索引 / 加枚举值）/ 🟡 谨慎（NOT NULL+DEFAULT、数据修复 UPDATE）/ 🔴 危险（DROP / RENAME / 改枚举语义 / 状态机）。

| # | 迁移名 | 等级 | 主题 |
|---|--------|------|------|
| 01 | `20260228041229_init` | 🟡 | 全表初始化（约 60 张表）|
| 02-10 | `20260228*` 9 条 | 🟢 | 加字段 / 加索引 / 加唯一约束 / Cart 抽奖关联 |
| 11 | `20260228210000_add_checkout_session` | 🟡 | 引入 CheckoutSession（订单流程重构核心）|
| 12 | `20260301010000_fix_checkout_idempotency_composite_unique` | 🟡 | DROP+CREATE 复合唯一约束 |
| 13 | `20260301020000_add_ondelete_restrict_and_indexes` | 🟡 | 多张表加 ON DELETE RESTRICT |
| 14 | `20260305030000_sync_coupon_and_checkout_schema` | 🟢 | DO $$ 块幂等建枚举 |
| 15-16 | `20260305*` 2 条 | 🟢 | CouponTriggerEvent + 复合索引 |
| 17 | `20260306010000_rename_reward_account_type_enums` | 🔴 | **`RED_PACKET→VIP_REWARD` / `NORMAL_RED_PACKET→NORMAL_REWARD` enum RENAME VALUE，PG 不可纯 SQL 回退** |
| 18-19 | `20260306020000_*` / `20260309180000_*` | 🟢 | 抽奖原价 / VIP 礼包 bizType |
| 20 | `20260309234436_sync_schema` | 🟡 | `ProductSKU.cost SET NOT NULL`（**如有 NULL 行会失败**）+ DropForeignKey Cart_userId_fkey |
| 21-23 | `20260310*` 3 条 | 🟢 | 提现拒绝原因 + 多商户 shipment + 卖家系统模型 |
| 24-25 | `20260315*` / `20260320010000_*` | 🟢 | 商品语义字段 / VIP 六分配置 |
| 26 | `20260320020000_vip_gift_multi_sku` | 🟡 | **RENAME COLUMN**（VipGiftOption→VipGiftItem）|
| 27-30 | `20260324*` ~ `20260327010000_*` | 🟢 | 商户入驻 / VIP 多档位 / 发票失败原因 / 延迟深链 |
| 31 | `20260327020000_add_configurable_tag_system` | 🟡 | RENAME COLUMN（标签系统）|
| 32 | `20260330010000_unified_after_sale` | 🔴 | **`ReplacementRequest RENAME TO after_sale_request`**（表 RENAME，不可前向兼容）+ 多 enum + 增字段 |
| 33-35 | `20260402*` / `20260409*` / `20260410*` | 🟢 | SKU 限购 / 快递100 task_id |
| 36 | `20260412010000_rename_kuaidi100_to_sf` | 🔴 | **`Shipment.kuaidi100TaskId→sfOrderId` RENAME COLUMN** + after_sale 同理 |
| 37-40 | `20260413*` ~ `20260421*` | 🟢 | 员工密码 / 管理员手机 / 标签排序 / 客服模型 / 商品提交次数 |
| 41 | `20260423010000_add_buyer_seller_reset_purposes` | 🔴 | **`SmsPurpose ADD VALUE BUYER_RESET/SELLER_RESET`（×2）** — 加值安全但同事务内不能用，且不可纯 SQL 回退 |
| 42-43 | `20260501*` 2 条 | 🟡 | 买家备注 + DROP+CREATE checkout idempotency unique |
| 44 | `20260506010000_add_vip_platform_split_allocation_rule` | 🔴 | **`AllocationRuleType ADD VALUE VIP_PLATFORM_SPLIT`**（fail-forward only）|
| 45 | `20260509010000_after_sale_chain_closure` | 🔴 | **preflight DO $$ 抛 orphan refundId**；增 ENUM 值 `NO_REASON_EXCHANGE` + 多新 enum + FK + 售后状态机扩展 |
| 46 | `20260510160000_add_after_sale_tracking_events` | 🟡 | RENAME COLUMN（轨迹事件）|
| 47 | `20260510170000_sf_style_shipping_pricing` | 🔴 | 多步：先加可空 → 回填 → 改 NOT NULL（`ProductSKU.weightGram` 转 NOT NULL，**不可回退**）|
| 48 | `20260510180000_fix_sf_shipping_additional_fee` | 🟡 | UPDATE 数据修复 |
| 49 | `20260515010000_invoice_chain_closure` | 🔴 | Invoice 加 6 字段 + 回填 `requestedAt = createdAt` 后 SET NOT NULL + 多新 enum |
| 50 | `20260515020000_invoice_auto_issue` | 🟢 | `failedAttempts / lastAutoIssueAttemptAt` 加索引 |
| 51 | `20260518010000_fix_vip_package_order_amount` | 🟡 | **大型 UPDATE Order 数据修复**（VIP 礼包订单金额回正）|
| 52 | `20260518020000_stock_aware_cart_and_after_sale_idempotency` | 🟢 | 加字段 / 加幂等索引 |
| 53 | `20260519010000_reward_dual_track` | 🔴 | **`WithdrawStatus ADD VALUE PROCESSING` / `RewardEntryType ADD VALUE DEDUCT`** |
| 54 | `20260519010001_reward_dual_track_columns` | 🔴 | `WithdrawRequest` 加 12 字段 + 4 索引 + `status` DEFAULT 改为 PROCESSING + 幂等键 |

**5 条 🔴 真正不可纯 SQL 回退的迁移**：M17 / M32 / M36 / M41 / M44 / M53（enum RENAME VALUE / 表 RENAME / 列 RENAME / enum ADD VALUE）。

**首次切换不需要写反向 SQL**（生产是空库，旧名根本不存在）。**后续如果某次发布需回滚**，按以下规则：
- 加表 / 加可空字段 / 加索引：可以先回滚代码，跑反向 `DROP` 语句
- 改 NOT NULL：反向 `ALTER COLUMN xxx DROP NOT NULL`
- RENAME COLUMN：反向 `ALTER TABLE xxx RENAME COLUMN new_name TO old_name`
- 表 RENAME / Enum RENAME VALUE / Enum ADD VALUE：**无法纯 SQL 回退，必须 fail-forward**（修代码不修库），或从备份恢复

---

## 七、推送 main 的实际操作步骤

> ⚠️ **必须先和用户口头确认本次推送内容 + 明确告知回滚路径，再 push**（CLAUDE.md 强制流程 #10）

```bash
# 0. 确认本地 staging 是干净的且与远端同步
git checkout staging
git pull origin staging
git status   # 应该 clean

# 1. 切到 main，与远端同步
git checkout main
git pull origin main

# 2. 把 staging 合并到 main（推荐 --no-ff 保留合并节点便于回滚）
git merge --no-ff staging -m "release: 合并 staging → main，包含 v1.0 全量功能"

# 3. 复述给用户：本次合并包含哪些 commit、改了哪些模块、是否有破坏性迁移
git log main --oneline ^origin/main
git diff origin/main...main --stat

# 4. 用户确认后再 push
git push origin main
```

push 后的事情：
- GitHub Actions 自动跑 `detect-changes` → 选中 `backend` / `admin` / `seller` / `website` 的子 job
- backend job 会 SSH 到服务器：`git pull` + `npm ci` + `prisma generate` + `prisma migrate deploy` + `npm run build` + `pm2 reload aimaimai-api-prod`
- web 三端构建 + rsync 到对应目录
- **观察 Actions 全部绿勾后**，再做生产环境验证

---

## 八、上线后验证清单

```bash
# 1. 后端健康
curl https://api.ai-maimai.com/api/v1/health   # {"status":"ok"}

# 2. PM2 进程状态（SSH 到服务器）
pm2 list   # aimaimai-api-prod 状态 online，重启次数没异常涨

# 3. 后端日志（最近 100 行无 ERROR）
pm2 logs aimaimai-api-prod --lines 100 --nostream

# 4. 数据库连通
psql -U aimaimai -d aimaimai -c "select count(*) from \"User\";"

# 5. CORS 实测（在 admin.ai-maimai.com 控制台执行）
fetch('https://api.ai-maimai.com/api/v1/health').then(r => r.json()).then(console.log)
# 应该返回 200 且无 CORS 错误

# 6. WebSocket（客服）连通（在 admin.ai-maimai.com 客服工作台页面）
# DevTools → Network → WS 应看到 wss://api.ai-maimai.com/ws/cs 连接成功

# 7. 支付宝回调连通（小额真实下单 1 元 → 走支付 → 看后端日志是否收到 notify）
pm2 logs aimaimai-api-prod | grep alipay
# 应看到 "支付回调成功" + providerTxnId

# 8. 支付宝退款（立刻发起 1 元退款，验证真实退回银行卡）
# 在管理后台/卖家后台触发，日志看 "退款成功"

# 9. 消费积分提现（小额 10 元）
# - 触发提现 → 后端调 alipay.fund.trans.uni.transfer
# - 看 transfer-notify webhook 是否真到（pm2 logs | grep transfer-notify）
# - 若没收到 webhook 但提现状态变 PAID，说明走的是 cron 兜底（每 10 分钟）
# - 若 webhook 配置正确，应在几秒内变 PAID

# 10. 短信发一条真实验证码（用真手机注册一个测试账号）

# 11. 顺丰生产下单（走一单测试，看是否能拿到运单号 + 推送回调更新订单状态）

# 12. Admin 前端验证
# 打开 https://admin.ai-maimai.com，登录后确认接口请求打到 https://api.ai-maimai.com；
# 刷新一个二级路由页面，确认不 404；
# 用账号密码 + 手机号 SMS 两种方式都能登录；
# 立刻改超管默认密码

# 13. Seller 前端验证
# 打开 https://seller.ai-maimai.com，登录后确认接口请求打到 https://api.ai-maimai.com；
# 刷新一个二级路由页面，确认不 404

# 14. App 生产 APK
# eas build --profile production --platform android → 安装 → 登录 → 加购 → 1 元支付 → 申请退款 → 提现
# 全链路真机验收
```

任何一项异常 → **立刻执行回滚**（见下节），不要尝试修复后再 push 一次。

---

## 九、回滚预案

### 9.1 纯代码回滚（无 schema 改动）

```bash
git checkout main
git revert <BAD_SHA> --no-edit       # 一个 commit 一条 revert
git push origin main                 # workflow 自动重新部署
```

如果本次发布是通过 `git merge --no-ff staging` 产生的 merge commit 回滚，使用：

```bash
git checkout main
git revert -m 1 <MERGE_SHA> --no-edit
git push origin main
```

### 9.2 含数据库迁移的回滚

> `prisma migrate deploy` **没有**自动 down 命令，必须人工跑反向 SQL **或** fail-forward。
>
> **PostgreSQL 不支持删枚举值，已 ADD VALUE 的 enum 无法纯 SQL 回退**——这种迁移只能 fail-forward（保留新枚举值，回滚代码到能处理旧+新值的版本，或修代码忽略新值）。

先判断迁移兼容性：
- **兼容性迁移**（加表 / 加可空字段 / 加索引）：先回滚代码 → 反向 `DROP` 语句即可
- **NOT NULL 转换 / RENAME COLUMN**：先回滚代码 → 反向 `ALTER COLUMN ... DROP NOT NULL` 或 `RENAME COLUMN ...`
- **Enum ADD VALUE / 表 RENAME / 改状态机 / 改资金或奖励计算**：**先停服或切维护页**，避免旧代码和新 schema 继续写入不一致数据；再考虑 fail-forward 或备份恢复

```bash
# 1. 如为不兼容迁移，先停服或切维护页
pm2 stop aimaimai-api-prod

# 2. 回滚代码（merge commit 用 git revert -m 1 <MERGE_SHA>）
git revert <BAD_SHA> --no-edit
git push origin main

# 3. 兼容性迁移可等 backend job 跑完；不兼容迁移不要恢复流量，先跑反向 SQL
# 4. 上服务器跑反向 SQL（如能写）
ssh <SERVER>
psql -U aimaimai -d aimaimai -f /tmp/rollback_<MIGRATION_NAME>.sql

# 5. 如果情况严重，从备份恢复（恢复前保持停服或维护页）
pg_restore --clean --if-exists -d aimaimai /www/backup/aimaimai_<TIMESTAMP>.dump

# 6. 确认健康检查通过后恢复服务
pm2 reload aimaimai-api-prod --update-env
```

### 9.3 紧急停服

```bash
# 在阿里云宝塔把 api.ai-maimai.com 站点改为返回 503 维护页
# 或直接停 pm2 进程
pm2 stop aimaimai-api-prod
```

### 9.4 App 回滚

- OTA 错了：再发一个回滚版的 OTA（`eas update --branch production --message "rollback"`）覆盖
- Build 错了：商店版无法立刻回滚，只能加急再 build 一版热修；老用户继续用旧 OTA channel
- 详见 `docs/operations/app-发布与OTA手册.md`

---

## 十、本次发布的差异与反向操作模板

> 这一节只保留模板。每次推 main 前，把对应版本的实例写到 PR 描述 / release note / `docs/operations/阿里云部署.md` 变更记录。

```
### 本次发布版本
- staging commit: <SHA>
- main commit (合并后): <SHA>
- 发布日期: <YYYY-MM-DD>

### 改动清单
- [ ] 后端模块: <list>
- [ ] Admin 页面: <list>
- [ ] Seller 页面: <list>
- [ ] Website 页面: <list>
- [ ] 数据库迁移: <list>
- [ ] App OTA / Build: <yes/no + channel/version>

### 破坏性变更（如有）
- 迁移 `<MIGRATION_NAME>`: <描述>
  - 回滚类别: <可反向 SQL / fail-forward only / 需备份恢复>
  - 反向 SQL: 见 `/tmp/rollback_<MIGRATION_NAME>.sql`（如可写）
  - 反向步骤: <step1> → <step2>

### 回滚命令
- 代码回滚: `git revert <SHA> && git push origin main`
- 数据库回滚: <如有破坏性变更，写在这里>
- App 回滚: <如发了 OTA/Build，写在这里>
```

---

## 十一、第一次切到生产时的额外动作（仅首次）

只需要做一次的事情，做完即归档：

1. ✅ **`deploy-website.yml` 的 main 锁已恢复**（2026-05-23 commit `8905a6d`）
   - 当前 line 101：`if: needs.detect-changes.outputs.website == 'true' && github.ref == 'refs/heads/main'` ✅
   - huahai 站点 line 255 同样有锁 ✅
   - 此步骤已完成，归档保留作历史记录

2. **首次服务器初始化**（**push main 之前必做，workflow 不会替你做**）

   GitHub Actions backend job 假定 3 个前提：`/www/wwwroot/aimaimai-prod-src` 已是 git 仓库 / `backend/.env` 已存在 / `pm2 reload aimaimai-api-prod` 能找到现存进程。首次部署这 3 个都没有，必须人工初始化一次。

   ```bash
   # ① SSH 到生产服务器
   ssh root@8.163.16.32

   # ② git clone main 分支（目录已由宝塔预建）
   cd /www/wwwroot/aimaimai-prod-src
   git clone https://github.com/flyspaceden/aimaimia.git .
   git checkout main
   git status   # clean

   # ③ 写 backend/.env（按 §二 逐字段对照 + docs/operations/.env.prod 本地副本）
   #    凭据全部来自密码本（DB / JWT × 3 / 支付宝 4 件套路径 / 微信 §5.2 / 顺丰 §7 / OSS §4.3.2）
   #    特别注意：WEBHOOK_IP_WHITELIST 必填（支付宝 IP 段，§十一 第 5 项）
   #              TRUST_PROXY=1（反代后必须）
   #              DATA_ENCRYPTION_KEY=（独立 32 字节 hex，不要省）
   vim /www/wwwroot/aimaimai-prod-src/backend/.env

   # ④ scp 支付宝 4 张证书（本地终端跑，不是 ssh 里）
   scp backend/certs/alipay/{appCertPublicKey.crt,alipayCertPublicKey.crt,alipayRootCert.crt,app-private-key.txt} \
       root@8.163.16.32:/www/wwwroot/aimaimai-prod-src/backend/certs/alipay/
   # 微信支付 2 张证书（apiclient_key.pem + apiclient_cert.pem），若开启微信入口同步 scp

   # ⑤ 首次启动（必须用 pm2 start 而非 reload）
   cd /www/wwwroot/aimaimai-prod-src/backend
   npm ci
   npx prisma generate
   npx prisma migrate deploy   # 54 条 migration 全量首次部署，看 §6.4 清单确认无意外
   npm run build
   pm2 start dist/main.js --name aimaimai-api-prod -- --env=production
   pm2 save                     # 持久化进程列表，服务器重启后自动拉起
   pm2 logs aimaimai-api-prod --lines 50 --nostream   # 看启动期强校验是否全过

   # ⑥ 健康检查
   curl http://127.0.0.1:3000/api/v1/health   # {"status":"ok"}
   curl https://api.ai-maimai.com/api/v1/health   # 走 Nginx 一次端到端
   ```

   完成后才能 push main 让 workflow 的 `pm2 reload --update-env` 接管后续部署。

3. **生产数据库初始化**：`prisma migrate deploy`（GitHub Actions 自动跑 / 首次手动跑过一次）+ 手动 SQL 插入最少必要的基础数据。
   **关键常量来源（不要凭印象编 ID）**：`backend/src/modules/bonus/engine/constants.ts`
   - `PLATFORM_USER_ID = 'PLATFORM'`（平台用户的 userId）
   - `PLATFORM_COMPANY_ID = 'PLATFORM_COMPANY'`（平台公司的 id）
   - `NORMAL_ROOT_ID = 'NORMAL_ROOT'`（普通用户三叉树根）
   - VIP 三叉树根 `A1...A20`（按需扩到 MAX_ROOT_NODES）

   ```sql
   -- ① 平台用户（必须先建，作为平台公司的 ownerId / 平台 RewardAccount.userId）
   INSERT INTO "User" (id, phone, status, "createdAt", "updatedAt")
   VALUES ('PLATFORM', '13900000000', 'ACTIVE', NOW(), NOW());

   -- ② 平台公司（爱买买 app）
   INSERT INTO "Company" (id, name, "shortName", "isPlatform", status, "createdAt", "updatedAt")
   VALUES ('PLATFORM_COMPANY', '爱买买app', '爱买买', true, 'ACTIVE', NOW(), NOW());

   -- ③ 普通树根节点 NORMAL_ROOT
   INSERT INTO "NormalTreeNode" (id, "userId", "parentId", level, "childrenCount", "createdAt", "updatedAt")
   VALUES ('NORMAL_ROOT', 'PLATFORM', NULL, 0, 0, NOW(), NOW());

   -- ④ VIP 三叉树根节点 A1-A10（详见 backend/prisma/seed.ts:1687-1701 模板）
   -- 注：当前 seed 只到 A3，需要手工补 A4-A10 或调整 seed 后单跑（生产严禁全量 seed）
   -- 每个根节点需配套创建 User + UserProfile + MemberProfile(tier=VIP) + VipProgress + VipTreeNode

   -- ⑤ 初始超管账号（首次部署后立刻改密）
   -- bcrypt-hash 用 `node -e "console.log(require('bcrypt').hashSync('<新密码>', 10))"` 本地生成
   INSERT INTO "AdminUser" (id, username, "passwordHash", phone, status, "createdAt", "updatedAt")
   VALUES (gen_random_uuid()::text, 'admin', '<bcrypt-hash-of-strong-password>', '13900000000', 'ACTIVE', NOW(), NOW());
   -- 上线后立刻在管理后台"账号安全"页再改一次密！

   -- ⑥ RuleConfig 初始化（提现规则 / 抵扣规则 / 发票自动开票开关等）
   -- 详见 backend/prisma/seed.ts 中 RuleConfig.createMany 模板（约 line 1500+）
   -- 至少要 seed: WITHDRAW_TAX_RATE / DEDUCTION_RATIO_NORMAL / DEDUCTION_RATIO_VIP / INVOICE_AUTO_ISSUE / INVOICE_AUTO_ISSUE_MAX_ATTEMPTS
   ```
   **不跑 `db seed`**（会重置基础数据）。建议把上面 SQL 写到 `backend/prisma/production-bootstrap.sql` 单独维护

4. **超管账号改密**：默认 `admin / 123456` 必须立即改为强密码并写入 `密码本.md §2.x`

5. **WEBHOOK_IP_WHITELIST 首次填值**：
   - **仅写支付宝**生产回调 IP 段：查支付宝开放平台文档（搜"支付宝服务端 IP"），https://opendocs.alipay.com/open/200/ipwhitelist
   - 顺丰 callback / 微信支付 notify **不在这个白名单管辖范围**（各自靠 URL token / RSA 签名），无需 IP 段
   - 写入 `WEBHOOK_IP_WHITELIST` 后 `pm2 reload aimaimai-api-prod --update-env`
   - 记录 IP 段来源、查询日期、后台截图到 `docs/operations/阿里云部署.md` 或 `密码本.md`

6. **顺丰商务沟通**（2026-05-26 已完成，凭据见密码本 §7）：
   - ✅ 申请生产月结账号 `7551253482`
   - ✅ 拿到生产 clientCode `HHNYKCL5OWXM` / checkWord `mO1AN9899...` / 模板号 `fm_150_standard_HHNYKCL5OWXM`
   - ✅ 把生产推送回调地址 `https://api.ai-maimai.com/api/v1/shipments/sf/callback/84a7d77ac0ec13252cdb5fc4e244be7b` 配进丰桥后台（2 个推送接口 RoutePushService + PushOrderState 都已上线）

7. **支付宝开放平台**（2026-05-27 大部分已完成，凭据见密码本 §6.1）：
   - ✅ 沙箱应用切换为正式应用（生产 AppID `2021006144601730`，沙箱 AppID `9021000162667503` 独立保留供测试用）
   - ✅ 应用网关 `https://api.ai-maimai.com/api/v1/payments/alipay/notify` + 加签方式 RSA2 公钥证书模式
   - ⏳ 授权回调地址（OAuth 用）—— v1.0 代码未用到支付宝 OAuth，**决策延后**，未来加"支付宝快捷登录"再配
   - ✅ 订阅事件 `alipay.fund.trans.order.changed` + webhook `https://api.ai-maimai.com/api/v1/payments/alipay/transfer-notify`（消费积分提现链路秒到，无需 cron 兜底）
   - ✅ 接口加签方式：密钥/证书模式（已设置）
   - ❌ 服务器 IP 白名单：未配置，建议 push main 前补上作纵深防御（防应用私钥泄露后被滥用），填 ECS 出口 IP
   - ⏳ 上传生产应用证书四件套到服务器 `/www/wwwroot/aimaimai-prod-src/backend/certs/alipay/`（push main 当天 `scp` 一条命令，参见密码本 §6.1）

8. **微信开放平台**：
   - 确认上传的是 release keystore 的签名 MD5（`76:6B:AF:B6:A3:B3:4A:67:87:61:E4:B0:7E:36:65:C4`）
   - 包名 `com.aimaimai.shop` 审核通过
   - 实际状态记录到 `docs/operations/阿里云部署.md` 或 `app-发布与OTA手册.md`

9. **OSS 硬隔离**（**2026-05-26 已实现**）：放弃软隔离前缀方案，直接为生产建独立 bucket + 独立 RAM 子账号，物理隔离。当前状态：
   - bucket：`huahai-aimaimai-prod`（华东1杭州 / 私有 / 版本控制开启 / AES256 加密 / 本地冗余 / tag env=prod app=aimaimai）
   - CORS：6 个生产域名（`https://*.ai-maimai.com` / `https://ai-maimai.com` / `https://xn--ckqa175y.com`）+ methods GET/POST/PUT/DELETE/HEAD + headers `*` + expose `ETag` `x-oss-request-id` + 600s cache
   - RAM 子账号：`aimaimai-prod-oss@1012909846841930.onaliyun.com`，授权 `AliyunOSSFullAccess`（2026-05-27 完成）
   - 凭据：密码本 §4.3.2（含 AccessKey ID + Secret）
   - 代码无需改动：`UploadService` 走 `OSS_BUCKET` env，写 `huahai-aimaimai-prod` 就自动隔离
   - ⚠️ **上线前 TODO**：AccessKey ID `LTAI5t6N4HK8e6Qj26NGsXjg` 在创建过程中出现在 Claude 对话上下文，建议在 RAM 控制台 → 用户 → AccessKey 管理 → 创建新 AccessKey → 更新生产 `.env` + 密码本 → 禁用旧 Key（密码本 §4.3.3 已留 checklist）

10. **法律合规文本填实**（**上线 + App 上架双重前置**）：
    - 编辑 `src/content/legal/privacyPolicy.ts` — 把所有【待填】字段替换为真实内容（公司全称、注册地址、统一社会信用代码、联系电话、联系邮箱）
    - 编辑 `src/content/legal/termsOfService.ts` — 同上
    - **必须经法律顾问审核**（文件头部已写明，分润奖励条款尤其要审）
    - 上线前推一次 OTA（这两个是纯 JS 内容文件）
    - App 上架审核时应用商店会逐字检查，不符合规范直接拒绝

11. **首次 App 上架**：走 `docs/operations/app-compliance-guide.md`（营业执照 / 软著 / App 备案 / 应用商店上架）

12. **更新 `docs/operations/阿里云部署.md` 变更记录**：记录首次生产部署日期 + 所有人工动作 + 凭据所在密码本章节

---

## 十二、上线后第一周的监控重点

> 这一节是 v1.0 上线特殊关注项，渡过第一周稳定后可归档

| 监控项 | 检查频率 | 异常阈值 | 排查路径 |
|--------|---------|---------|---------|
| 后端 PM2 重启次数 | 每天 | 当天 > 3 次 | `pm2 logs aimaimai-api-prod --err --lines 200` |
| 支付回调失败率 | 每天 | 失败率 > 1% | grep `alipay.*notify` + `Refund.status=FAILED` count |
| 消费积分提现 PROCESSING 卡单 | 每小时 | 超过 30 分钟还在 PROCESSING | `WithdrawRequest.status=PROCESSING AND queryAttempts > 0` |
| **企业支付宝余额 vs 待付提现总额** | 每周 | 余额 < 待付 PROCESSING 总额 | b.alipay.com 余额页 vs `SELECT SUM(amount) FROM "WithdrawRequest" WHERE status='PROCESSING'`。**触发后立刻去网银充值**（决策：未做自动调拨 + 未预充提现池，详见密码本 §6.1） |
| 售后退款失败 cron 重试 | 每天 | 同一笔重试 > 3 次 | `Refund.status=FAILED AND afterSaleRequestId IS NOT NULL` |
| 自动开票 FAILED | 每天 | 当天 > 5 单 | `Invoice.status=FAILED AND failedAttempts >= max` |
| 顺丰下单失败 | 每天 | 当天 > 3 单 | grep `SfExpressService.*error` |
| 库存 R12 超卖 | 每天 | 当天 > 0 | `ProductSKU.stock < 0`（R12 是预期行为，但需通知卖家补货）|
| 客服会话堆积 | 每小时 | QUEUING > 10 个 | `CsSession.status=QUEUING ORDER BY createdAt` |
| App 崩溃率（蒲公英/EAS）| 每天 | crash rate > 1% | EAS dashboard / 蒲公英后台 |

监控可以先用 `pm2 monit` + 手工 psql 查询，后续接入 Grafana / 钉钉告警（v1.1 规划）。
