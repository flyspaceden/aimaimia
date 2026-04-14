# 爱买买 — 部署架构与运维手册

## 一、系统架构总览

```
                    爱买买.com (一个域名，4条子域名)
                              │
        ┌─────────┬───────────┼───────────┬──────────┐
        ▼         ▼           ▼           ▼          │
     爱买买.com  seller.    admin.      api.         │
     官网       爱买买.com  爱买买.com   爱买买.com     │
     (静态)     (静态)     (静态)      (反向代理)     │
        │         │           │           │          │
        │         └───────────┼───────────┘          │
        │              全部调用 api.爱买买.com          │
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
    GitHub Pages)                              也调用 api.爱买买.com
```

### 核心原则
- **4 个前端（官网、买家App、企业系统、管理后台）全部调用同一个 NestJS 后端**
- **后端已有三套隔离认证**：买家 JWT / 卖家 SELLER_JWT_SECRET / 管理员 ADMIN_JWT_SECRET
- **子域名天然隔离**：各前端的 localStorage/Cookie 互不影响，XSS 攻击面隔离

## 二、域名与子域名规划

| 子域名 | 用途 | 部署方式 |
|--------|------|---------|
| `爱买买.com` | 官网（营销页面 + 商户入驻申请） | GitHub Pages 或 Nginx 静态托管 |
| `seller.爱买买.com` | 企业（卖家）系统 | Nginx 静态托管 |
| `admin.爱买买.com` | 管理后台 | Nginx 静态托管 |
| `api.爱买买.com` | 后端 API | Nginx 反向代理 → localhost:3000 |

### 为什么用子域名而非路径

| 方案 | 安全性 | 问题 |
|------|--------|------|
| 路径 `爱买买.com/admin` | 差 | Cookie/localStorage 共享，XSS 一端沦陷全部暴露 |
| 子域名 `admin.爱买买.com` | 好 | 浏览器天然隔离，三套 JWT 各存各的 |
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
A          api        <服务器IP>        后端 API
```

## 五、Nginx 配置

### api.爱买买.com（后端 API 反向代理）
```nginx
server {
    listen 80;
    server_name api.爱买买.com;

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

### seller.爱买买.com（企业系统）
```nginx
server {
    listen 80;
    server_name seller.爱买买.com;
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

### admin.爱买买.com（管理后台）
```nginx
server {
    listen 80;
    server_name admin.爱买买.com;
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

### 爱买买.com（官网，如果不用 GitHub Pages）
```nginx
server {
    listen 80;
    server_name 爱买买.com www.爱买买.com;
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
certbot --nginx -d 爱买买.com -d www.爱买买.com -d seller.爱买买.com -d admin.爱买买.com -d api.爱买买.com
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

# Redis
REDIS_URL=redis://localhost:6379

# JWT（三套独立密钥，务必用强随机值）
JWT_SECRET=<买家端随机密钥>
ADMIN_JWT_SECRET=<管理端随机密钥>
SELLER_JWT_SECRET=<卖家端随机密钥>

# CORS（允许的前端域名）
CORS_ORIGINS=https://爱买买.com,https://seller.爱买买.com,https://admin.爱买买.com

# 文件上传
UPLOAD_LOCAL_PRIVATE=false
```

### 2. 初始化数据库
```bash
cd backend
npx prisma migrate deploy    # 执行所有迁移
npx prisma db seed           # 写入种子数据（管理员账号等）
```

### 3. 构建并启动
```bash
npm run build
pm2 start dist/main.js --name aimaimai-api
pm2 save
pm2 startup    # 开机自启
```

### 4. 验证
```bash
curl https://api.爱买买.com/api/v1/health    # 健康检查（如有）
pm2 logs aimaimai-api                         # 查看日志
```

## 七、前端部署步骤

### 企业系统（seller/）
```bash
cd seller
# 修改 API 地址（src/api/client.ts 或 .env）
# VITE_API_BASE_URL=https://api.爱买买.com/api/v1
npm run build
# 上传 dist/ 到服务器 /var/www/seller/dist/
```

### 管理后台（admin/）
```bash
cd admin
# 修改 API 地址
# VITE_API_BASE_URL=https://api.爱买买.com/api/v1
npm run build
# 上传 dist/ 到服务器 /var/www/admin/dist/
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
        │              → 商户用手机号登录 seller.爱买买.com
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
