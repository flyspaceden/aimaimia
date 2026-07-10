# 爱买买 — 部署架构与运维手册

## 一、系统架构总览

```
                    ai-maimai.com (一个主域名，6 条生产子域名)
                              │
        ┌─────────┬───────────┬───────────┬───────────┬────────────────┬────────────────┐
        ▼         ▼           ▼           ▼          │
     ai-maimai.com  seller.    admin.      api.     delivery-seller. delivery-admin.
     官网       ai-maimai.com  ai-maimai.com ai-maimai.com ai-maimai.com  ai-maimai.com
     (静态)     (静态)     (静态)      (反向代理)   (静态)          (静态)
        │         │           │           │            │                │
        │         └───────────┼───────────┴────────────┴────────────────┘
        │                     全部调用 api.ai-maimai.com
        │                     │                      │
        │              ┌──────▼──────┐               │
        │              │  NestJS     │               │
        │              │  :3000      │               │
        │              └──────┬──────┘               │
        │                     │                      │
        │              ┌──────▼──────┐               │
        │              │ PostgreSQL  │               │
        │              │ + Redis     │               │
        │              └─────────────┘               │
        │                                            │
   (可留在                                     买家App（备案后）
    GitHub Pages)                              也调用 api.ai-maimai.com
```

### 核心原则
- **6 个前端入口（官网、买家 App、企业系统、管理后台、配送中心、配送管理后台）全部调用同一个 NestJS 后端**
- **后端已有六套隔离认证/密钥面**：买家 JWT / 卖家 `SELLER_JWT_SECRET` / 管理员 `ADMIN_JWT_SECRET` / 配送用户 `DELIVERY_USER_JWT_SECRET` / 配送卖家 `DELIVERY_SELLER_JWT_SECRET` / 配送管理 `DELIVERY_ADMIN_JWT_SECRET`
- **子域名天然隔离**：各前端的 localStorage/Cookie 互不影响，XSS 攻击面隔离
- **配送第三方服务复用现有配置**：支付宝、微信支付、顺丰月结/丰桥、阿里云 OSS、阿里云短信不单独申请新账号；配送上线新增的是独立 `DELIVERY_DATABASE_URL`、三套配送 JWT secret、配送前端域名/CORS、以及仅 seed 时使用的 `DELIVERY_SEED_PASSWORD`。

## 二、域名与子域名规划

| 子域名 | 用途 | 部署方式 |
|--------|------|---------|
| `ai-maimai.com` | 官网（营销页面 + 商户入驻申请） | GitHub Pages 或 Nginx 静态托管 |
| `seller.ai-maimai.com` | 企业（卖家）系统 | Nginx 静态托管 |
| `admin.ai-maimai.com` | 管理后台 | Nginx 静态托管 |
| `delivery-seller.ai-maimai.com` | 配送中心（卖家侧） | Nginx 静态托管 |
| `delivery-admin.ai-maimai.com` | 配送管理后台 | Nginx 静态托管 |
| `api.ai-maimai.com` | 后端 API | Nginx 反向代理 → localhost:3000 |

### 测试域名补充

| 子域名 | 用途 | 目标目录 |
|--------|------|---------|
| `test-admin.ai-maimai.com` | 管理后台测试环境 | `/www/wwwroot/test-admin/` |
| `test-seller.ai-maimai.com` | 企业系统测试环境 | `/www/wwwroot/test-seller/` |
| `test-delivery-admin.ai-maimai.com` | 配送管理后台测试环境 | `/www/wwwroot/test-delivery-admin/` |
| `test-delivery-seller.ai-maimai.com` | 配送中心测试环境 | `/www/wwwroot/test-delivery-seller/` |
| `test-api.ai-maimai.com` | 后端测试环境 | `/www/wwwroot/aimaimai-staging-src/backend` |

### 为什么用子域名而非路径

| 方案 | 安全性 | 问题 |
|------|--------|------|
| 路径 `ai-maimai.com/admin` | 差 | Cookie/localStorage 共享，XSS 一端沦陷全部暴露 |
| 子域名 `admin.ai-maimai.com` | 好 | 浏览器天然隔离，三套 JWT 各存各的 |
| 独立域名 | 最强但没必要 | 多花钱且管理麻烦，子域名已足够 |

## 三、服务器环境要求

### 最低配置（初期）
- **云服务器**：2核4G（阿里云/腾讯云 ECS），约 100-200 元/月
- **操作系统**：Ubuntu 22.04 LTS 或 CentOS 8+
- **磁盘**：50GB SSD

### 软件依赖
| 软件 | 版本 | 用途 |
|------|------|------|
| Node.js | 18+ (推荐 20 LTS) | NestJS 运行时 |
| PostgreSQL | 15+ | 主数据库 |
| Redis | 7+ | 队列/缓存 |
| Nginx | 1.24+ | 反向代理 + 静态托管 |
| PM2 | 5+ | Node 进程管理 |
| Certbot | 最新 | SSL 证书自动续期 |

## 四、DNS 配置

在域名服务商后台添加以下 A 记录：

```
记录类型    主机记录    记录值            备注
A          @          <服务器IP>        官网（如用 GitHub Pages 则改为 CNAME）
A          www        <服务器IP>        官网 www 别名
A          seller     <服务器IP>        企业系统
A          admin      <服务器IP>        管理后台
A          delivery-seller <服务器IP>   配送中心
A          delivery-admin  <服务器IP>   配送管理后台
A          api        <服务器IP>        后端 API
A          test-seller <服务器IP>       企业系统测试环境
A          test-admin  <服务器IP>       管理后台测试环境
A          test-delivery-seller <服务器IP> 配送中心测试环境
A          test-delivery-admin  <服务器IP> 配送管理后台测试环境
A          test-api    <服务器IP>       后端测试环境
```

## 五、Nginx 配置

### api.ai-maimai.com（后端 API 反向代理）
```nginx
server {
    listen 80;
    server_name api.ai-maimai.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持（如有需要）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # 文件上传大小限制
    client_max_body_size 20m;
}
```

### seller.ai-maimai.com（企业系统）
```nginx
server {
    listen 80;
    server_name seller.ai-maimai.com;
    root /var/www/seller/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;  # SPA 路由回退
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### admin.ai-maimai.com（管理后台）
```nginx
server {
    listen 80;
    server_name admin.ai-maimai.com;
    root /var/www/admin/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### delivery-seller.ai-maimai.com（配送中心）
```nginx
server {
    listen 80;
    server_name delivery-seller.ai-maimai.com;
    root /www/wwwroot/delivery-seller/;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### delivery-admin.ai-maimai.com（配送管理后台）
```nginx
server {
    listen 80;
    server_name delivery-admin.ai-maimai.com;
    root /www/wwwroot/delivery-admin/;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### ai-maimai.com（官网，如果不用 GitHub Pages）
```nginx
server {
    listen 80;
    server_name ai-maimai.com www.ai-maimai.com;
    root /var/www/website/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### SSL 证书（所有子域名一次性申请）
```bash
certbot --nginx \
  -d ai-maimai.com \
  -d www.ai-maimai.com \
  -d seller.ai-maimai.com \
  -d admin.ai-maimai.com \
  -d delivery-seller.ai-maimai.com \
  -d delivery-admin.ai-maimai.com \
  -d api.ai-maimai.com \
  -d test-seller.ai-maimai.com \
  -d test-admin.ai-maimai.com \
  -d test-delivery-seller.ai-maimai.com \
  -d test-delivery-admin.ai-maimai.com \
  -d test-api.ai-maimai.com
```

## 六、后端部署步骤

### 1. 环境变量配置（生产 .env）
```env
# 基础
NODE_ENV=production
PORT=3000
TRUST_PROXY=1

# 数据库
DATABASE_URL=postgresql://user:password@localhost:5432/aimaimai?schema=public
DELIVERY_DATABASE_URL=postgresql://delivery_user:<DELIVERY_DB_PASSWORD>@localhost:5432/aimaimai_delivery?schema=public

# Redis
REDIS_URL=redis://localhost:6379

# JWT（主业务三套 + 配送三套独立密钥，务必用强随机值）
JWT_SECRET=<买家端随机密钥>
ADMIN_JWT_SECRET=<管理端随机密钥>
SELLER_JWT_SECRET=<卖家端随机密钥>
DELIVERY_USER_JWT_SECRET=<配送用户随机密钥>
DELIVERY_ADMIN_JWT_SECRET=<配送管理后台随机密钥>
DELIVERY_SELLER_JWT_SECRET=<配送中心随机密钥>
# 仅在手动运行配送 seed 时设置；必须强随机，禁止提交到仓库
DELIVERY_SEED_PASSWORD=<配送 seed 初始账号强密码>

# CORS（允许的前端域名；Socket.IO 未单独配置 ALLOWED_ORIGINS 时复用此值）
CORS_ORIGINS=https://ai-maimai.com,https://www.ai-maimai.com,https://app.ai-maimai.com,https://seller.ai-maimai.com,https://admin.ai-maimai.com,https://delivery-admin.ai-maimai.com,https://delivery-seller.ai-maimai.com

# 可选：仅在 Socket.IO 需要不同白名单时设置；设置后必须包含实际 App/管理后台域名
# ALLOWED_ORIGINS=https://app.ai-maimai.com,https://admin.ai-maimai.com

# H5 微信登录（扫码后 /invite/:code 网页授权）
WECHAT_H5_APP_ID=<WECHAT_SERVICE_ACCOUNT_APP_ID>
WECHAT_H5_APP_SECRET=<WECHAT_SERVICE_ACCOUNT_APP_SECRET>
WECHAT_H5_AUTH_REDIRECT_BASE=https://app.ai-maimai.com/invite

# 文件上传
UPLOAD_LOCAL_PRIVATE=false
```

### 2. 初始化数据库
```bash
cd backend
npx prisma generate
npx prisma migrate deploy
npx prisma generate --schema prisma-delivery/schema.prisma
npx prisma migrate deploy --schema prisma-delivery/schema.prisma
npx prisma db seed           # 写入种子数据（管理员账号等）
# 配送演示 seed 仅用于 staging / 测试库初始化；生产不要无脑执行
DELIVERY_SEED_PASSWORD='<强随机初始密码>' npm run prisma:delivery:seed
```

### 2.1 测试环境 `.env` 追加项

测试环境在 `/www/wwwroot/aimaimai-staging-src/backend/.env` 中同样需要补齐以下占位，并把 `CORS_ORIGINS` 扩到测试子域名：

```env
DELIVERY_DATABASE_URL=postgresql://delivery_user:<STAGING_DELIVERY_DB_PASSWORD>@localhost:5432/test_aimaimai_delivery?schema=public
DELIVERY_USER_JWT_SECRET=<STAGING_DELIVERY_USER_JWT_SECRET>
DELIVERY_ADMIN_JWT_SECRET=<STAGING_DELIVERY_ADMIN_JWT_SECRET>
DELIVERY_SELLER_JWT_SECRET=<STAGING_DELIVERY_SELLER_JWT_SECRET>
DELIVERY_SEED_PASSWORD=<STAGING_DELIVERY_SEED_PASSWORD>
CORS_ORIGINS=https://app.ai-maimai.com,https://test-admin.ai-maimai.com,https://test-seller.ai-maimai.com,https://test-delivery-admin.ai-maimai.com,https://test-delivery-seller.ai-maimai.com,https://test-api.ai-maimai.com
WECHAT_H5_APP_ID=<STAGING_WECHAT_SERVICE_ACCOUNT_APP_ID>
WECHAT_H5_APP_SECRET=<STAGING_WECHAT_SERVICE_ACCOUNT_APP_SECRET>
WECHAT_H5_AUTH_REDIRECT_BASE=https://app.ai-maimai.com/invite
```

### 2.2 GitHub Actions / 服务器后端发布顺序

`deploy-website.yml` 的 backend job 现在按以下顺序在服务器执行，staging / production 都一致，只是目录和 PM2 名称不同：

```bash
cd /www/wwwroot/<aimaimai-*-src>/backend
npm ci
npx prisma generate
npx prisma migrate deploy
npx prisma generate --schema prisma-delivery/schema.prisma
npx prisma migrate deploy --schema prisma-delivery/schema.prisma
npm run build   # 同时复制 src/generated/delivery-client 到 dist/src/generated/delivery-client
pm2 reload <aimaimai-api-*> --update-env
```

> 2026-06-20：staging 首次配送迁移时曾因旧迁移目录排在初始化迁移前导致
> `20260618120000_task5_delivery_auth_units` 失败；处理方式为先确认
> `testdelivery` 仅有 `_prisma_migrations`、无业务表，再执行
> `npx prisma migrate resolve --rolled-back 20260618120000_task5_delivery_auth_units --schema prisma-delivery/schema.prisma`
> 后重新 `migrate deploy`。同日修复 `npm run build`，避免 `nest build`
> 清空 `dist` 后遗漏配送 Prisma client，导致 PM2 启动时报
> `Cannot find module '../../../generated/delivery-client'`。staging `.env`
> 已补 `DELIVERY_SEED_PASSWORD`，并已执行 `npm run prisma:delivery:seed`
> 初始化配送测试账号、示范商家、商品、清单模板和基础配置；真实密码只保存在服务器
> `.env` 和本次操作记录中，不写入仓库。

### 3. 构建并启动
```bash
npm run build
pm2 start dist/main.js --name aimaimai-api
pm2 save
pm2 startup    # 开机自启
```

### 4. 验证
```bash
curl https://api.ai-maimai.com/api/v1/health    # 健康检查（如有）
pm2 logs aimaimai-api                         # 查看日志
```

## 七、前端部署步骤

### 企业系统（seller/）
```bash
cd seller
# 修改 API 地址（src/api/client.ts 或 .env）
# VITE_API_BASE_URL=https://api.ai-maimai.com/api/v1
npm run build
# 上传 dist/ 到服务器 /var/www/seller/dist/
```

### 管理后台（admin/）
```bash
cd admin
# 修改 API 地址
# VITE_API_BASE_URL=https://api.ai-maimai.com/api/v1
npm run build
# 上传 dist/ 到服务器 /var/www/admin/dist/
```

### 配送中心（delivery-seller/）
```bash
cd delivery-seller
# VITE_API_BASE_URL=https://api.ai-maimai.com/api/v1
# VITE_WS_BASE_URL=https://api.ai-maimai.com
npm run build
# 上传 dist/ 到服务器 /www/wwwroot/delivery-seller/
```

### 配送管理后台（delivery-admin/）
```bash
cd delivery-admin
# VITE_API_BASE_URL=https://api.ai-maimai.com/api/v1
# VITE_WS_BASE_URL=https://api.ai-maimai.com
npm run build
# 上传 dist/ 到服务器 /www/wwwroot/delivery-admin/
```

### 测试环境目标目录总表

```text
/www/wwwroot/test-admin/
/www/wwwroot/test-seller/
/www/wwwroot/test-delivery-admin/
/www/wwwroot/test-delivery-seller/
```

### 生产环境目标目录总表

```text
/www/wwwroot/admin/
/www/wwwroot/seller/
/www/wwwroot/delivery-admin/
/www/wwwroot/delivery-seller/
```

### 官网（website/）
```bash
cd website
npm run build
# 上传 dist/ 到服务器 /var/www/website/dist/
# 或继续用 GitHub Pages
```

## 八、商户入驻流程（App 上线前的过渡方案）

```
商户在官网填写入驻申请
        │
        ▼
POST /api/v1/merchant-applications（公开接口，无需登录）
        │
        ▼
数据库创建 MerchantApplication（status=PENDING）
        │
        ▼
管理员在管理后台看到待审核列表
        │
        ├── 审核通过 → 自动创建 Company + CompanyStaff(OWNER)
        │              → 通知商户（短信/电话）
        │              → 商户用手机号登录 seller.ai-maimai.com
        │              → 开始上货（商品 auditStatus=PENDING，管理员再审核）
        │
        └── 审核拒绝 → 通知商户原因，可重新申请
```

### 商户上货与 App 的关系
- **商户上货完全不依赖 App**：商品数据存在数据库，企业系统独立运行
- App 上线后，买家端自动展示已审核通过（APPROVED + ACTIVE）的商品
- App 上线前，商户可以提前完成：公司信息完善、商品录入、价格设置、库存管理

## 九、Bug 排查指南

### 按系统定位

| 现象 | 排查入口 | 工具 |
|------|---------|------|
| 网站提交失败 | 浏览器 F12 → Network → 看 API 请求/响应 | Chrome DevTools |
| 企业系统操作异常 | 同上，看 `/seller/*` API | Chrome DevTools |
| 管理后台审核失败 | 同上，看 `/admin/*` API | Chrome DevTools |
| API 返回 500 | 服务器查日志 | `pm2 logs aimaimai-api` |
| 数据不一致 | 直接查数据库 | `psql` 或数据库客户端 |

### 关键原则
- **所有 Bug 归结为两类**：前端展示问题 or 后端 API 问题
- 前端是纯静态站点，只要 API 返回正确，前端就不会出错
- 后端是单一服务，所有日志集中在一个地方

## 十、后续扩展路径

| 阶段 | 动作 | 触发条件 |
|------|------|---------|
| 初期 | 单服务器部署全部组件 | 现在 |
| App 上线 | 配置 CORS 增加 App 域名 | 备案通过 |
| 流量增长 | 数据库迁移到云 RDS，加 CDN | 日活 > 1000 |
| 高可用 | 后端多实例 + 负载均衡 | 日活 > 10000 |

## 十一、生产变更记录

### 2026-06-18 数字资产“消费资产”命名与 VIP 口径修正

- **代码发布**：`staging` 推送 `08c1c75 fix(digital-asset): rename credit assets to consumption assets`；`main` 合并提交 `2b3872a release: 合并 staging 到 main（数字资产消费资产命名）`。
- **生产部署**：GitHub Actions `Deploy Sites & Backend` run `27735452366` 成功，执行后端、管理后台、官网和花海静态站部署；无数据库 migration。
- **业务口径**：撤回“VIP 礼包金额计入消费资产”的临时改动，保持 VIP 礼包只产生本人/直接推荐人种子资产；消费资产只由普通商品真实实付商品金额按倍率档位生成。
- **验证结果**：数字资产相关 Jest 38 个用例通过，`npm run test:legal` 22 个用例通过，根目录 `npx tsc -b --noEmit --pretty false` 通过；临时 main worktree 后端 Jest 因未安装 `backend/node_modules` 未运行成功，已在具备依赖的开发 worktree 完成同内容验证。

### 2026-06-18 数字资产推荐 VIP 种子资产历史补偿

- **代码发布**：`staging` 推送 `fa3fbdf fix(digital-asset): backfill referral vip seed assets`；`main` 合并提交 `3ba41ed release: 合并 staging 到 main（数字资产推荐种子资产回填）`。
- **生产部署**：GitHub Actions `Deploy Sites & Backend` run `27734523652` 成功，仅后端部署执行。
- **生产数据补偿**：`Digital Asset Backfill` production dry-run run `27734576044` 显示 `referralWouldCredit=3`、`errors=0`、`invalidPackage=0`；execute run `27734613896` 成功补发 `referralCredited=3`；最终 dry-run run `27734647699` 显示 `wouldCredit=0`、`referralWouldCredit=0`、`errors=0`。
- **安全口径**：补偿仍走 `DigitalAssetService.backfillExistingVipAssets()` 的 Serializable 事务和 `vip-purchase:*:referral-seed` 幂等键；重复执行不会重复入账。
