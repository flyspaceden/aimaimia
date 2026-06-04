# 上线当天 Runbook（测试 → 生产首次发布）

> **用法**：从上到下逐条勾。**任何一步出现 ✗ 立刻停**，排查清楚再继续——尤其在碰真金（阶段 6）之前。
> **配套（真相源）**：
> - `docs/operations/staging-to-production.md` — 每步的详细背景与字段对照
> - `docs/operations/密码本.md` — 所有真实凭据（gitignored，本文只用占位符/章节号引用）
> - `docs/operations/github操作.md` — 双分支自动部署机制
> - `docs/operations/阿里云部署.md` — 实际部署状态（动作完成后回写这里）
>
> **核心理念**：每一步都带**验证**，确认代码版本 / env / 各种 key 真的正确，再放真实用户。

> **🔎 测试端已预验证（2026-06-03 更新）**：测试服务器自 2026-06-01 起支付宝已由沙箱切**生产证书模式**——与生产**同一个 AppID `2021006144601730` + 同一套 `certs/alipay/` 4 证书**，且测试后端与生产**同一台 ECS `8.163.16.32`**——并已用**真实支付宝完成真金支付**。
> ⇒ **支付宝证书模式 + RSA2 验签 + 真实扣款链路本身已跑通**，阶段 6 的支付项不再是"从零验证"。
> ⚠️ 但生产仍有两处测试端**没覆盖到**、阶段 6 必须现场验的差异：
> 1. **`notify_url`**：生产指 `api.ai-maimai.com`（测试是 `test-api`）——回调要真的能到生产后端；
> 2. **`WEBHOOK_IP_WHITELIST`**：测试端 `NODE_ENV=staging` 直接**绕过** `WebhookIpGuard`，从未验证过白名单；生产 `NODE_ENV=production` 下此项为空/配错 → 支付回调**全被拒、订单永卡未支付**。**这一项测试端等于没测，生产必须验。**

---

## 阶段 0 — 出发前确认（建议提前一天）

- [ ] **法律文本已经法律顾问审核**（唯一硬阻塞；审核稿见 `docs/legal/爱买买法律文本审核稿.docx`，改回 `.ts` 源文件后再发版）
- [ ] **keystore + 密码本已异地备份**：`aimaimai-release.keystore`（SHA-1 `FD:E0:…:CC:69`）+ 密码（密码本 §11.1），至少 2 处（本机日常备份也算一处）
- [ ] `staging` 分支就是要上线的版本，关键链路沙箱已跑通
- [ ] 选定**低流量上线窗口**，通知测试人员（上线期间测试机不要乱下单）
- [ ] 手边备好：服务器 SSH、阿里云/支付宝/顺丰后台登录、密码本

---

## 阶段 1 — 合并并推送 main（前端自动部署）

> 详见 staging-to-production.md §七。推 main 前先口头复述改动 + 回滚路径。

```bash
git checkout staging && git pull origin staging && git status   # clean
git checkout main && git pull origin main
git merge --no-ff staging -m "release: v1.0 首次上线"
git log main --oneline ^origin/main          # 复述本次包含的 commit
git push origin main
```

- [ ] GitHub Actions 的 **web 三端**（admin/seller/website）job 绿
- [ ] **backend job 首次会失败**（服务器尚未初始化）—— **预期内**，下一阶段手动初始化后即正常

---

## 阶段 2 — 服务器首次初始化（手动，只此一次）

> 详见 staging-to-production.md §十一-2。GitHub Actions 不会替你做这步。

```bash
ssh root@8.163.16.32
cd /www/wwwroot/aimaimai-prod-src
git clone https://github.com/flyspaceden/aimaimia.git . && git checkout main

# 写 backend/.env（逐字段照 staging-to-production.md §二 + 密码本取真值）
vim backend/.env
```

```bash
# 本地终端（非 ssh）scp 支付宝 4 张证书 + 私钥
scp backend/certs/alipay/{app-private-key.txt,appCertPublicKey.crt,alipayCertPublicKey.crt,alipayRootCert.crt} \
    root@8.163.16.32:/www/wwwroot/aimaimai-prod-src/backend/certs/alipay/
```

```bash
# 回到服务器，首次启动（必须 pm2 start，不是 reload）
cd /www/wwwroot/aimaimai-prod-src/backend
npm ci
npx prisma generate
npx prisma migrate deploy        # 56 条，对照 §6.4 确认无意外
npm run build
pm2 start dist/src/main.js --name aimaimai-api-prod -- --env=production   # ⚠️ 是 dist/src/main.js（tsconfig 含 test/prisma → 产物嵌套在 dist/src/，不是 dist/main.js）
pm2 save
```

- [ ] `pm2 list` → `aimaimai-api-prod` 状态 **online**，重启次数正常
- [ ] `pm2 logs aimaimai-api-prod --lines 50 --nostream` → **无证书加载错误、无启动校验抛错**

> 若启动即崩，多半是**启动强校验**拦住了（这是好事，说明 env 缺项）：看日志中文报错——`CORS_ORIGINS` / `DATA_ENCRYPTION_KEY`（为空或等于 JWT_SECRET）/ `WEBHOOK_IP_WHITELIST` / 三套 JWT / 顺丰 `SF_PUSH_SECRET` / 支付宝证书，缺哪个补哪个再 `pm2 restart`。

---

## 阶段 3 — 环境 / Key 正确性自检 ⭐（核心，碰真金前必须全 ✓）

> 在服务器 `cd /www/wwwroot/aimaimai-prod-src/backend` 下逐条跑。命令设计为**只输出 PASS/FAIL，不打印密钥本身**。

### 3.1 基础环境

```bash
grep -E '^NODE_ENV=production$'  .env && echo "✓ NODE_ENV" || echo "✗ NODE_ENV 必须=production"
grep -E '^PORT=3000$'            .env && echo "✓ PORT 3000" || echo "✗ PORT 必须=3000"
grep -E '^TRUST_PROXY=1'         .env && echo "✓ TRUST_PROXY=1" || echo "✗ 反代后必须 TRUST_PROXY=1（否则 Webhook IP 校验拒所有回调）"
grep -E '^LOTTERY_CLAIM_SECRET=.+' .env && echo "✓ LOTTERY_CLAIM_SECRET" || echo "✗ 缺 LOTTERY_CLAIM_SECRET（生产无条件必填，cart/lottery 启动即崩 — 2026-06-04 踩过）"
grep -E '^UPLOAD_SIGN_SECRET=.+'   .env && echo "✓ UPLOAD_SIGN_SECRET" || echo "✗ 缺 UPLOAD_SIGN_SECRET（UPLOAD_LOCAL_PRIVATE=true 时必填）"
```

### 3.2 三套 JWT secret：都存在、互不相同、不复用 staging

```bash
# 三个值去重后必须=3（互不相同）
awk -F= '/^(JWT_SECRET|ADMIN_JWT_SECRET|SELLER_JWT_SECRET)=/{print $2}' .env | sort -u | wc -l
#   期望输出：3
```

- [ ] 输出为 **3**（若 <3 说明有重复或缺失）
- [ ] 人工确认这三个值**不是**从 staging `.env` 复制来的（重新随机生成的）

### 3.3 数据加密 key：存在 且 ≠ JWT_SECRET

```bash
DEK=$(awk -F= '/^DATA_ENCRYPTION_KEY=/{print $2}' .env)
JWT=$(awk -F= '/^JWT_SECRET=/{print $2}' .env)
[ -n "$DEK" ] && [ "$DEK" != "$JWT" ] && echo "✓ DATA_ENCRYPTION_KEY 独立" || echo "✗ 缺失或等于 JWT_SECRET（PII 不可逆风险，且生产会拒绝启动）"
unset DEK JWT
```

### 3.4 CORS / Webhook 白名单

```bash
grep -E '^CORS_ORIGINS=' .env | grep -q 'test-' && echo "✗ CORS 仍含 test- 前缀" || echo "✓ CORS 无 test- 前缀"
grep -Eq '^CORS_ORIGINS=.*admin\.ai-maimai\.com' .env && echo "✓ CORS 含生产 admin 域名" || echo "✗ CORS 缺生产域名"
grep -Eq '^WEBHOOK_IP_WHITELIST=.+' .env && echo "✓ WEBHOOK_IP_WHITELIST 非空" || echo "✗ 为空 → 支付宝回调全被拒，订单永远未支付"
```

### 3.5 支付宝（最关键，决定真金）

```bash
grep -Eq '^ALIPAY_APP_ID=2021006144601730$' .env && echo "✓ 生产 AppID" || echo "✗ AppID 不是生产 2021006144601730"
grep -Eq '^ALIPAY_GATEWAY=https://openapi\.alipay\.com' .env && echo "✓ 正式网关" || echo "✗ 网关不是 openapi.alipay.com（可能还指沙箱）"
grep -Eq '^ALIPAY_NOTIFY_URL=https://api\.ai-maimai\.com/api/v1/payments/alipay/notify$' .env && echo "✓ notify_url 正确" || echo "✗ notify_url 错（必须带 /api/v1）"

# ⚠️ 致命陷阱：生产是证书模式，绝不能配 ALIPAY_PUBLIC_KEY（否则 alipay.service.ts:29 会错走公钥模式）
grep -Eq '^ALIPAY_PUBLIC_KEY=.+' .env && echo "✗ 危险：生产不应设 ALIPAY_PUBLIC_KEY" || echo "✓ 未设 ALIPAY_PUBLIC_KEY（正确，走证书模式）"

# 4 个证书/私钥文件存在
for f in app-private-key.txt appCertPublicKey.crt alipayCertPublicKey.crt alipayRootCert.crt; do
  [ -s "certs/alipay/$f" ] && echo "✓ $f" || echo "✗ 缺 certs/alipay/$f"
done

# 证书 md5 与密码本 §6.1 比对（公钥证书，非敏感）
md5 -q certs/alipay/appCertPublicKey.crt    # 期望 22c0a5a6d219e5f9bbc5320f75263df5
md5 -q certs/alipay/alipayCertPublicKey.crt # 期望 74e4294b508df30c7b2422cd4d06d12f
md5 -q certs/alipay/alipayRootCert.crt      # 期望 b6612a80b13013892c8c5c0829f62367

# 应用证书与私钥配对（两行 md5 必须相等 = 配对成功）
openssl x509 -noout -modulus -in certs/alipay/appCertPublicKey.crt | openssl md5
openssl rsa  -noout -modulus -in certs/alipay/app-private-key.txt  | openssl md5
```

- [ ] 3 个证书 md5 与密码本 §6.1 一致
- [ ] 私钥/证书 modulus md5 两行**相等**（配对正确）

### 3.6 顺丰（生产 PROD）

```bash
grep -Eq '^SF_ENV=PROD$' .env && echo "✓ SF_ENV=PROD" || echo "✗ 仍是 UAT 沙箱"
grep -Eq '^SF_PUSH_SECRET=.+' .env && echo "✓ SF_PUSH_SECRET 非空" || echo "✗ 为空（生产启动会抛异常）"
# 模板号必须以 _<SF_CLIENT_CODE> 结尾
CC=$(awk -F= '/^SF_CLIENT_CODE=/{print $2}' .env); TC=$(awk -F= '/^SF_TEMPLATE_CODE=/{print $2}' .env)
[[ "$TC" == *"_$CC" ]] && echo "✓ 模板号后缀匹配 clientCode" || echo "✗ SF_TEMPLATE_CODE 后缀必须以 _$CC 结尾"
grep -Eq '^SF_MONTHLY_ACCOUNT_PROD=.+' .env && echo "✓ 生产月结账号" || echo "✗ 缺生产月结账号"; unset CC TC
```

### 3.7 OSS / 微信

```bash
grep -Eq '^OSS_BUCKET=huahai-aimaimai-prod$' .env && echo "✓ 生产独立 bucket" || echo "✗ bucket 不是 huahai-aimaimai-prod"
# 微信支付入口 v1.0 关闭：后端登录用的 WECHAT_APP_ID/SECRET 要在；WECHAT_PAY_* 可留空（App 入口已灰）
grep -Eq '^WECHAT_APP_ID=.+' .env && echo "✓ 微信登录 AppID 在" || echo "✗ 缺 WECHAT_APP_ID"
```

### 3.8 进程与代码版本

```bash
git -C /www/wwwroot/aimaimai-prod-src rev-parse --short HEAD   # 应等于本次发布的 main SHA
git -C /www/wwwroot/aimaimai-prod-src status -s                # 应 clean
# ⚠️ 本项目无 /health 路由；用公开端点 /products 验活（返回 {"ok":true,...}）
curl -s http://127.0.0.1:3000/api/v1/products                  # {"ok":true,"data":{"items":[],...}}
curl -s https://api.ai-maimai.com/api/v1/products              # 走 Nginx 端到端
```

- [ ] 代码 SHA = 本次发布版本，工作区 clean
- [ ] 本地 + 域名两个 health 都 200

---

## 阶段 4 — 数据 Bootstrap + 自检

```bash
# 用现成脚本（幂等，详见 staging-to-production.md §十一-3）
ADMIN_BOOTSTRAP_PASSWORD='<强密码>' npx ts-node prisma/production-bootstrap.ts
```

```bash
# 数据自检（psql）
psql -U aimaimai -d aimaimai -c "SELECT id FROM \"User\" WHERE id='PLATFORM';"
psql -U aimaimai -d aimaimai -c "SELECT id FROM \"Company\" WHERE id='PLATFORM_COMPANY';"
psql -U aimaimai -d aimaimai -c "SELECT id FROM \"NormalTreeNode\" WHERE id='NORMAL_ROOT';"
psql -U aimaimai -d aimaimai -c "SELECT count(*) FROM \"RuleConfig\";"           -- 期望 ≥ 56
psql -U aimaimai -d aimaimai -c "SELECT count(*) FROM \"ProductSKU\" WHERE cost IS NULL OR cost=0;"  -- 必须 0
psql -U aimaimai -d aimaimai -c "SELECT count(*) FROM \"AdminUser\" WHERE username='admin';"          -- 1
```

- [ ] PLATFORM / PLATFORM_COMPANY / NORMAL_ROOT 都在
- [ ] RuleConfig ≥ 56，超管 admin 存在
- [ ] **cost 为空/0 的 SKU 数 = 0**（否则分润会按全额算 → 多分真金不可逆）

---

## 阶段 5 — 第三方回调连通（不花钱的连通性）

- [ ] `admin.ai-maimai.com` 登录正常，接口打到 `api.ai-maimai.com`，二级路由刷新不 404
- [ ] `seller.ai-maimai.com` 同上
- [ ] 客服工作台 DevTools → WS 连到 `wss://api.ai-maimai.com/...` 成功
- [ ] 真手机注册一个账号，**收到真实短信验证码**

---

## 阶段 6 — 真金 Canary（放真实用户之前，自己当测试用户、最小额）

> 验证"生产证书模式 + 真实资金"。**支付宝证书模式 / 验签 / 真金扣款已在测试端预跑通**（见文首「测试端已预验证」），本阶段在生产重点验的不是"证书能不能用"，而是 **notify 能否到生产后端 + `WEBHOOK_IP_WHITELIST` 是否放行**（测试端 `NODE_ENV=staging` 绕过了白名单，等于没测过这一项）。

- [ ] **¥1 真实下单 → 支付** → `pm2 logs | grep alipay` 看到 notify 成功（生产关键点：证明 `api.ai-maimai.com` 回调可达 + `WEBHOOK_IP_WHITELIST` 真的放行了支付宝 IP；证书验签本身测试端已验过）
- [ ] 对该单 **¥1 退款** → 确认真实退回
- [ ] **¥10 提现**到自己的真支付宝 → 真到账 + `pm2 logs | grep transfer-notify` 收到回调（没收到但变 PAID = 走了 cron 兜底）
- [ ] 走 **1 笔真顺丰单** → 拿到运单号 + 推送回调更新订单状态
- [ ] 确认**企业支付宝账户有足够余额**覆盖预期提现（余额不足时提现会失败回滚）

任何一步异常 → 不要放量，先查（这才是真正暴露问题的时刻）。

---

## 阶段 7 — 收尾

- [ ] **立刻在管理后台「账号安全」改超管密码**，新密码写入密码本 §2.x
- [ ] 把首次部署的所有人工动作（.env 变更、证书路径、bootstrap、改密）回写 `阿里云部署.md` 变更日志
- [ ] 开启上线后第一周监控（staging-to-production.md §十二）：PM2 重启 / 支付回调失败率 / 提现卡单 / **企业支付宝余额 vs 待付提现** / 退款失败 cron / 顺丰失败 / 超卖
- [ ] App：如需同步发版，走 `eas build --profile production`（沙箱开关已 false，属 env 改动必须 Build）

---

## 回滚速查

```bash
# 纯代码回滚（merge commit 用 -m 1）
git checkout main && git revert -m 1 <MERGE_SHA> --no-edit && git push origin main

# 紧急停服 / 切维护页
pm2 stop aimaimai-api-prod

# 含迁移的回滚：先停服 → 回滚代码 → 人工反向 SQL 或从备份恢复
#   5 条不可纯 SQL 回退迁移见 §6.4（首次空库部署不涉及，二次发布才需）
pg_restore --clean --if-exists -d aimaimai /www/backup/aimaimai_<TS>.dump
```

> 首次上线务必在阶段 2 前 `pg_dump -Fc -d aimaimai -f /www/backup/aimaimai_$(date +%Y%m%d_%H%M%S).dump` 留一份空库基线。
