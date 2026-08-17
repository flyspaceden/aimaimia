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

# 正常商城自提：首次部署时保持 false，迁移/点位/staging 验收后再单独授权开启
PICKUP_FULFILLMENT_ENABLED=false
PICKUP_TOKEN_SECRET=<自提凭证独立强随机密钥>

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
PICKUP_FULFILLMENT_ENABLED=false
PICKUP_TOKEN_SECRET=<STAGING_PICKUP_TOKEN_SECRET>
CORS_ORIGINS=https://app.ai-maimai.com,https://test-admin.ai-maimai.com,https://test-seller.ai-maimai.com,https://test-delivery-admin.ai-maimai.com,https://test-delivery-seller.ai-maimai.com,https://test-api.ai-maimai.com
WECHAT_H5_APP_ID=<STAGING_WECHAT_SERVICE_ACCOUNT_APP_ID>
WECHAT_H5_APP_SECRET=<STAGING_WECHAT_SERVICE_ACCOUNT_APP_SECRET>
WECHAT_H5_AUTH_REDIRECT_BASE=https://app.ai-maimai.com/invite
```

自提灰度开启顺序（staging 先行）：

1. 生成独立 `PICKUP_TOKEN_SECRET`，保持 `PICKUP_FULFILLMENT_ENABLED=false`，先执行迁移、构建和 PM2 重启。
2. 迁移只自动关联“超级管理员”；经理、员工和自定义角色默认都不获得 `pickup_points:*`，由超级管理员在角色页显式授权，授权后让对应管理员重新登录以刷新前端权限快照。随后在平台管理后台选择正常经营的测试企业，建立 staging 测试自提点，确认独立权限、商家归属、脱敏、软删除/恢复和管理端事务审计正常；卖家中心仍只验证本企业维护边界。
3. 仅在 staging 改为 `PICKUP_FULFILLMENT_ENABLED=true`，使用 `pm2 reload <staging-api> --update-env` 生效，完成普通/团购/VIP 的支付、备货、凭证和核销回归。
4. 任一状态机、退款或凭证异常立即恢复 `false` 并重启 staging API；生产开启必须另行获得发布授权。

凭证密钥轮换限制：当前凭证 digest 没有密钥版本。不得在存在 `PREPARING` 或 `READY` 自提履约时直接替换 `PICKUP_TOKEN_SECRET`，否则这些订单的短码和二维码会失效。轮换前必须先关闭 feature flag、确认活跃自提履约为 0，并完成已有订单核销或受控取消；随后更换密钥、重启、创建新测试订单验证后再重新开启。未来若需要不停机轮换，应先实现 key version 与前一密钥兼容校验，不能只改环境变量。

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

## 十一、变更记录

### 2026-08-17 平台中心仓与卖家自提工作队列 staging 发布

- **范围**：仅 `staging`，未改 `main` / production。远端源码由 `6a36a154`（中心仓模型）推进到 `864dab38`，包含平台中心仓开关自动绑定唯一平台公司、企业授权范围、平台备货/核销权限，以及卖家“自提订单”只显示 `PICKUP + PAID` 的待处理订单。
- **首次失败与恢复**：run `31992991707` 在 `20260816010000_add_platform_hub_pickup_points` 给 `AdminRolePermission` 写权限关系时遗漏必填 `id`，PostgreSQL 拒绝迁移；部署脚本自动恢复后端到 `21f85566` 并完成健康检查。随后将迁移修正为稳定 `rpf_ + md5(roleId:permissionId)`，仅当 staging `migrate status` 明确指向该已回滚失败记录时受控执行 `migrate resolve --rolled-back`，其他迁移异常继续 fail-closed。
- **部署结果**：run `31994109519` 成功；`deploy-backend`、`deploy-admin`、`deploy-seller` 和 staging 微信转账预检均通过，修正后的 migration 已在 `testaimaimai` 应用，`aimaimai-api-test` 健康检查通过。一次性恢复逻辑随后从部署 workflow 移除，不保留在长期发布链路。
- **待验收**：尚未在 staging 创建中心仓点位，尚未执行普通/团购/VIP 真实自提、平台核销、真实支付/退款或真机验收。必须先在管理后台创建并启用测试中心仓，再验证买家小程序和卖家/平台后台闭环。

### 2026-08-17 后端依赖安装卡死与 SSH 保活

- staging 提交 `d42cd6fd` 的后端部署在 `npm ci` 输出依赖警告后持续静默，约 132 分钟后由中间网络以 `client_loop: send disconnect: Broken pipe` 中断，GitHub Actions 以 255 失败；Prisma、构建、PM2 reload 和健康检查均未执行，旧 PM2 服务继续返回 200。相同 lockfile 在干净本地 `npm ci --no-audit --no-fund --timing` 中 14 秒完成，新增纯 JS `qrcode` 包约 2.6 秒且无 install script，因此不是 lockfile 或二维码包构建错误，而是服务器安装阶段停滞叠加 SSH 无保活、命令无上限。
- 首轮限时改造后，run `32044483456` 精确捕获到主安装与回滚安装都在下载 `https://registry.npmjs.org/which-module/-/which-module-2.0.1.tgz` 时 `ETIMEDOUT`；这将根因收窄为 staging 服务器到 npm 官方 registry 的当前网络超时，而非代码、lockfile 或 `qrcode`。日志同时暴露回滚在 `set +e` 下丢失 `npm ci` 失败码，误继续执行 `npx prisma` 并尝试临时下载 `prisma@7.9.1`。
- `deploy-backend` 现在保留 45 分钟 job 上限和 30 秒 SSH keepalive；依赖安装先以完整性校验约束的 lockfile 访问官方 registry，45 秒单次网络超时后自动切换 `registry.npmmirror.com`；两次尝试均有独立时间上限与日志。安装失败会原样返回非零状态，Prisma 改用 `npx --no-install` 禁止在部署中隐式联网补包。

### 2026-08-14 到店自提 staging 灰度发布

- **范围**：仅 `staging`，未改 `main` / production。功能提交 `9eb5d174 feat(pickup): add store pickup fulfillment`，覆盖普通商品、团购和 VIP 礼包的配送 / 自提双履约，以及小程序、买家 App、卖家中心、管理后台和共享后端。
- **自动部署**：GitHub Actions `Deploy Sites & Backend` run `31839202973` 成功；`deploy-admin`、`deploy-seller`、`deploy-backend` 和受保护的 staging 微信转账预检均成功。
- **数据库与服务**：服务器代码 HEAD 为 `9eb5d174d74a7003455136d5869299aca7ca49a4`；主库 114 个迁移均为 up to date，`20260814010000_add_pickup_fulfillment` 已应用。`aimaimai-api-test` PM2 online，重载后的启动窗口首次公网探测短暂返回 502，Nest 启动完成后二次探测恢复 200。
- **配置**：staging 写入独立 64 字符 `PICKUP_TOKEN_SECRET` 并设置 `PICKUP_FULFILLMENT_ENABLED=true`；密钥未写入 Git 或日志。变更前活跃 `PREPARING/READY` 自提履约为 0，旧 `.env` 备份为 `.env.bak.pickup-9eb5d174`。
- **验活**：`https://test-api.ai-maimai.com/api/v1/products`、`https://test-admin.ai-maimai.com/`、`https://test-seller.ai-maimai.com/` 均返回 200。微信开发者工具使用 staging 构建重新普通编译后为 0 error；目标路由基础巡检 1 PASS、3 AUTH_GATE、0 FAIL，登录凭证已过期，因此未伪造会员数据，也未执行真实支付/退款。
- **待验收**：由测试人员完成微信重新登录和卖家后台验证码登录，创建 staging 自提点后再跑普通/团购/VIP 预结算、备货、短码/二维码核销、并发取消与真实小额支付/退款。生产发布前还需完成真实 PostgreSQL 并发集成测试。

### 2026-08-14 小程序自提结算首屏 staging 热修

- **范围**：仅 `staging`，未改 `main` / production。代码提交 `f26f8f88 fix(miniapp): restore checkout details and compact note`；恢复普通商品确认订单页的商品、红包、积分与金额展示，修复少量卡片拉伸、禁用自提按钮无反馈和订单备注区域过高，并按履约模式隔离预结算缓存。
- **CI 结果**：GitHub Actions `WeChat Mini Program CI` run `31843242816` 成功；TypeScript、ESLint、51 个测试文件 / 276 个用例、staging/production 双构建和构建产物上传均通过。工作流只构建并保存产物，不代表已上传微信体验版、提交审核或发布线上版本。
- **开发者工具**：最终 staging 产物在已登录测试账号下完成确认订单路由巡检，1 PASS、0 FAIL、0 warning；商品、金额与紧凑卡片恢复显示。滚动复查确认订单备注为 56px 逻辑高度；当前商品所属商家仍无可用自提点，因此本轮只能确认禁用态与提示，未伪造点位或执行支付。
- **审查**：独立复核发现并推动修复配送无地址预览与未完成自提共用 React Query 缓存的问题；修复后二次复核无 Critical / High / Medium。未完成自提只保留商品快照，金额为 `--`，提交仍由有效预览、完整履约信息和用户确认共同守门。

### 2026-08-14 平台自提点管理与 staging 联调

- **范围**：仅 `staging`，未改 `main` / production。功能提交 `ad862059 feat(pickup): add platform point management`，允许平台管理后台按独立 `pickup_points:*` 权限跨企业新增、编辑、停启用、软删除和恢复自提点；企业归属在编辑时不可变，删除原因、操作人和前后差异进入审计。
- **部署结果**：GitHub Actions `Deploy Sites & Backend` run `31846316184` 成功，后端、管理后台和受保护的 staging 微信转账预检均通过；数据库迁移已在 staging 应用。随后发现全局 `enableImplicitConversion` 会把查询串 `isDeleted=false` 预转换成布尔真值，提交 `8d2f7075 fix(pickup): parse admin boolean filters safely` 改为按原始查询值精确解析并补生产配置契约测试；run `31847052058` 成功部署后端，管理后台因无前端变更按预期跳过。
- **真实后台联调**：在 `test-admin.ai-maimai.com` 使用已登录系统管理员，通过页面为 `澄源生态农业`（`c-001`）创建 `澄源生态农业测试自提点`（ID `cmstitlws001ut71cgv9lch8d`），验证创建、正常列表显示和编辑通知文案均成功；点位保持启用，供后续普通商品、团购和 VIP 联调使用。未执行删除/恢复的真实数据操作，这两项由权限、接口和前端契约测试覆盖。
- **微信开发者工具**：在已登录 staging 小程序中打开普通商品 `紫薯`（SKU `sku-p-034`）确认订单页，商品信息正常展示；点击“到店自提”后面板正常展开并自动选中上述测试点，地址、营业时间和测试提示均正确显示。清空旧日志后重新加载，没有新增 401、500、React、WXSS 或脚本异常；自动化路由巡检为 1 PASS、0 FAIL。
- **真实接口复核**：登录会话自动续期后，`GET /orders/pickup-points?companyIds=c-001` 返回 200 且仅返回该启用点；使用虚拟联系人调用 `POST /orders/preview` 返回 201，商品金额 ¥15、运费 ¥0、应付 ¥15，证明自提未伪装成包邮配送。未创建 CheckoutSession、未提交订单、未唤起微信支付，也未产生真实资金或库存变更。
- **验证边界**：本轮完成平台后台、微信开发者工具和 staging API 的普通商品自提预结算；团购/VIP 的代码、契约和单元测试已覆盖，但仍未在 staging 创建可支付活动/礼包完成真实支付、备货、取货码核销及退款。生产发布前还需完成真实 PostgreSQL 并发状态机测试和真机小额资金闭环。

### 2026-07-12 消息详情与互动筛选修复（待发布）

- **App/API**：消息列表点击先进入按买家鉴权的详情页，详情内再执行商品、客服、订单等目标跳转；移除容易与消息删除混淆的筛选重置按钮，筛选仅由分类和“仅未读”标签控制。
- **分类修复**：主动客服邀请改写 `service` 分类，确保“互动”筛选可以查询。
- **数据库迁移**：新增 `20260712050000_fix_cs_outreach_notification_category`，修正历史 `cs_outreach_invite` 的错误分类；部署工作流会执行 `npx prisma migrate deploy`。
- **发布前验证**：App Jest 118/118、源码/法律契约 194/194、后端 2537/2537 通过（5 项既有用例跳过）；App TypeScript、production Android export、后端构建与 Prisma 校验通过。

### 2026-07-11 公告商品跳转与买家消息清理

- **公告跳转**：管理后台公告支持选择具体商品，发布时保存标准 `PRODUCT_DETAIL` 跳转目标，买家点击后进入对应商品详情。
- **消息清理**：买家消息中心支持左滑单条删除、5 秒撤销、清除已读和二次确认清空全部；删除按收件人软删除并保留审计数据。
- **数据库迁移**：新增 `20260711160000_notification_message_soft_delete`，部署工作流会在后端构建前执行 `npx prisma migrate deploy`。
- **发布前验证**：App Jest 113/113、根目录契约测试 191/191、后端 2172/2172 通过（2 项既有用例跳过），三端类型检查/构建与 Prisma 校验通过。

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
