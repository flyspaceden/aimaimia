# L13 — v1.0 部署上线 Checklist

**档位**: C 档（基建迁移模板）
**背景**: 阶梯上线 — 管理后台 → 卖家后台 → 种子商户上货 → App 对外
**目标用户**: 首批 500+
**支付方式**: 支付宝（唯一，v1.0）
**物流**: 顺丰丰桥直连（依赖 L8 完成）
**基础设施**: 阿里云 OSS / SMS（已购）
**域名**: 爱买买.com（app / seller / admin / api / www 子域）

---

## 0. 前置依赖总览

| 项 | 负责 | 预计周期 | 状态 |
|----|------|---------|------|
| 云服务器采购 | 用户 | 1 天 | ☐ |
| 域名购买 | 用户 | 1 天 | ☐ |
| ICP 备案 | 用户 | 20 工作日 | ☐ |
| SSL 证书（certbot 免费） | AI 执行 | 1 小时 | ☐ |
| 阿里云 OSS/SMS AccessKey | 用户 | 已完成，核对 env | ☐ |
| 支付宝商户号 + 证书 | 用户 | 3–5 天 | ☐ |
| 顺丰月结账号（L8 前置） | 用户 | 7–10 天 | ☐ |
| Apple Developer ($99/年) | 用户 | 1–3 天 | ☐ |
| 华为/小米/OPPO/vivo 应用商店 | 用户 | 2–5 天/家 | ☐ |
| L8 顺丰直连联调完成 | AI 执行 | 见 L8 plan | ☐ |
| 所有 L01–L12 + L14–L17 修复合并 | AI 执行 | 见各 plan | ☐ |

---

## 🔧 用户线下完成事项

### U1 云服务器采购
- [ ] 阿里云 ECS 华东 1（杭州）或华东 2（上海），就近备案地
- [ ] 规格建议: **4 核 8G / 100GB SSD / 5Mbps**（初期 500 用户够用）
    - CPU: 4 vCPU（NestJS + Postgres + Redis 同机）
    - 内存: 8G（Postgres shared_buffers 2G + Node heap 2G + Redis 500M + 系统余量）
    - 磁盘: 100GB ESSD PL0
    - 带宽: 5Mbps 峰值（后续按需升级 CDN）
- [ ] 费用估算: **约 350–500 元/月**（包年 8 折）
- [ ] 系统: **Ubuntu 22.04 LTS x64**
- [ ] 开放安全组端口: 22 (限 IP 白名单) / 80 / 443
- [ ] 分配公网 IP 并记录

### U2 域名 + ICP 备案
- [ ] 在阿里云注册 `爱买买.com`（注意中文域名 Punycode 为 `xn--3bs0hcq3d.com`）
    - ⚠️ 同步购买拼音备用域名 `aimaimai.com` 以避免部分客户端不支持中文域名
- [ ] 提交 ICP 备案（阿里云备案系统）
    - 主体: 运营公司营业执照
    - 网站名称、域名、负责人身份证、幕布照片
    - 备案期间约 15–20 工作日，此阶段**不可对外解析**
- [ ] 备案通过后方可进行 DNS 解析

### U3 阿里云 OSS / SMS 核对
- [ ] OSS Bucket 创建（建议地域: oss-cn-hangzhou）
    - Bucket 名: `aimaimai-prod`
    - 读写权限: 私有 + 签名 URL
    - 防盗链白名单: `*.爱买买.com`
- [ ] 短信签名（需工信部审核 1–3 天）
    - 签名: 爱买买
- [ ] 短信模板
    - 注册/登录验证码: `您的验证码为${code}，5分钟内有效`
    - 订单通知、商户审核通知各一条
- [ ] RAM 子账号 + AccessKey（最小权限: OSS 读写 + SMS 发送）

### U4 支付宝配置
- [ ] 登录 open.alipay.com 创建应用
- [ ] 获取 APPID（如 `2021006144601730`）
- [ ] 生成 RSA2 密钥对（证书模式，生产强制）
    - `app-private-key.txt` — 应用私钥
    - `appCertPublicKey.crt` — 应用公钥证书
    - `alipayCertPublicKey.crt` — 支付宝公钥证书
    - `alipayRootCert.crt` — 根证书
- [ ] 开通「手机网站支付」、「当面付」能力
- [ ] 配置授权回调地址: `https://api.爱买买.com/payments/alipay/notify`
- [ ] 商户结算账户绑定（对公银行账户）

### U5 顺丰丰桥（见 L8 前置）
- [ ] 开通顺丰月结账号
- [ ] 申请丰桥开放平台 API（clientCode / checkWord）
- [ ] 完成 L8 所有迁移任务

### U6 App 应用商店账号
- [ ] Apple Developer Program: $99/年
- [ ] Google Play（国际版可选）: $25 一次性
- [ ] 华为开发者联盟: 免费（需企业认证 ~600 元/年）
- [ ] 小米 / OPPO / vivo / 应用宝: 各家免费但需企业资质
- [ ] **App 备案**（2023 新规必备）: 工信部 App 备案系统

---

## 步骤 1 — 购买云服务器

**责任**: 用户 | **工时**: 1 h | **依赖**: 无
**前置检查**: 支付方式就位

- [ ] 1.1 登录阿里云控制台，购买 ECS（规格见 U1）
- [ ] 1.2 选择 Ubuntu 22.04 LTS，设置 root 密码
- [ ] 1.3 配置安全组:
    ```
    入方向: 22(SSH, 限办公 IP), 80(HTTP), 443(HTTPS), 3306/5432/6379(仅内网)
    出方向: 全部放通
    ```
- [ ] 1.4 记录公网 IP 到团队文档
- [ ] 1.5 SSH 登录验证: `ssh root@<IP>`

**验证**: `uname -a` 输出 Ubuntu 22.04
**回滚**: 云平台可整机退款（5 日内）

---

## 步骤 2 — 安装环境

**责任**: AI | **工时**: 2 h | **依赖**: 步骤 1
**前置检查**: 服务器 SSH 可达

- [ ] 2.1 系统基础
    ```bash
    apt update && apt upgrade -y
    apt install -y curl git build-essential ufw fail2ban
    ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
    ```
- [ ] 2.2 创建部署用户
    ```bash
    useradd -m -s /bin/bash deploy
    usermod -aG sudo deploy
    mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
    # 粘贴公钥到 authorized_keys
    ```
- [ ] 2.3 Node.js 20 LTS
    ```bash
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
    npm install -g pm2
    node -v  # v20.x
    ```
- [ ] 2.4 PostgreSQL 15
    ```bash
    apt install -y postgresql-15 postgresql-contrib
    sudo -u postgres psql -c "CREATE USER aimaimai WITH PASSWORD '<强密码>';"
    sudo -u postgres psql -c "CREATE DATABASE aimaimai OWNER aimaimai;"
    sudo -u postgres psql -c "ALTER USER aimaimai CREATEDB;"  # Prisma shadow DB
    ```
    - 调优: `/etc/postgresql/15/main/postgresql.conf` shared_buffers=2GB, work_mem=16MB, max_connections=200
- [ ] 2.5 Redis 7
    ```bash
    apt install -y redis-server
    # /etc/redis/redis.conf: maxmemory 512mb, maxmemory-policy allkeys-lru
    # requirepass <强密码>
    systemctl restart redis-server
    ```
- [ ] 2.6 Nginx 1.24
    ```bash
    apt install -y nginx
    systemctl enable nginx
    ```
- [ ] 2.7 Certbot
    ```bash
    apt install -y certbot python3-certbot-nginx
    ```
- [ ] 2.8 PM2 开机自启: `pm2 startup systemd`（按输出提示执行）

**验证**: `node -v && psql -V && redis-cli ping && nginx -v && pm2 -v`
**回滚**: `apt remove --purge <pkg>`；数据库 `DROP DATABASE aimaimai`

---

## 步骤 3 — 域名 DNS 配置

**责任**: 用户（AI 指导）| **工时**: 30 min | **依赖**: 步骤 1 + ICP 备案通过
**前置检查**: 备案号已下发

- [ ] 3.1 登录域名服务商 DNS 控制台
- [ ] 3.2 添加 A 记录（指向服务器 IP）
    ```
    @       A  <IP>   TTL 600
    www     A  <IP>   TTL 600
    api     A  <IP>   TTL 600
    admin   A  <IP>   TTL 600
    seller  A  <IP>   TTL 600
    app     A  <IP>   TTL 600   # 预留，用于 Universal Link / 落地页
    ```
- [ ] 3.3 添加 CAA 记录（允许 Let's Encrypt 签发）
    ```
    @  CAA  0 issue "letsencrypt.org"
    ```
- [ ] 3.4 等待 DNS 生效（国内约 10 分钟，海外 1–24 小时）
- [ ] 3.5 验证: `dig api.爱买买.com +short` 返回正确 IP

**验证**: 全 5 个子域 dig 命中
**回滚**: 删除 DNS 记录即可

---

## 步骤 4 — SSL 证书

**责任**: AI | **工时**: 30 min | **依赖**: 步骤 3（DNS 生效）
**前置检查**: Nginx 默认站点监听 80 可响应 HTTP-01

- [ ] 4.1 临时 Nginx 默认 server block（让 certbot 完成 challenge）
- [ ] 4.2 签发证书
    ```bash
    certbot --nginx \
      -d 爱买买.com -d www.爱买买.com \
      -d api.爱买买.com -d admin.爱买买.com \
      -d seller.爱买买.com -d app.爱买买.com \
      --email ops@爱买买.com --agree-tos --no-eff-email
    ```
- [ ] 4.3 自动续期测试: `certbot renew --dry-run`
- [ ] 4.4 确认 systemd 定时器: `systemctl status certbot.timer`
- [ ] 4.5 证书文件位置: `/etc/letsencrypt/live/爱买买.com/fullchain.pem`

**验证**: `curl -I https://api.爱买买.com` 返回 200/404（而非 SSL 错误）
**回滚**: `certbot delete --cert-name 爱买买.com`

---

## 步骤 5 — 部署后端 NestJS

**责任**: AI | **工时**: 3 h | **依赖**: 步骤 2 + 4 + 全部代码修复合并
**前置检查**: main 分支 CI 绿 / `npx prisma validate` 通过 / `npm run build` 本地通过

- [ ] 5.1 代码拉取
    ```bash
    su - deploy
    mkdir -p ~/apps && cd ~/apps
    git clone git@github.com:<org>/aimaimai.git
    cd aimaimai/backend
    ```
- [ ] 5.2 生产 .env（见下方「生产 .env 必配变量清单」）
    - 放置于 `backend/.env`
    - `chmod 600 .env`
- [ ] 5.3 支付宝证书放置
    ```bash
    mkdir -p backend/certs/alipay
    # 上传 4 个 crt/txt 文件
    chmod 600 backend/certs/alipay/*
    ```
- [ ] 5.4 安装 + 构建
    ```bash
    npm ci --production=false
    npx prisma generate
    npx prisma migrate deploy
    npx prisma db seed   # 仅首次，写入 10 个 VIP 根节点 + 平台公司 + 管理员账号 + 配置项
    npm run build
    ```
- [ ] 5.5 PM2 启动
    ```bash
    pm2 start dist/main.js --name aimaimai-api \
      --max-memory-restart 2G \
      --log-date-format "YYYY-MM-DD HH:mm:ss"
    pm2 save
    ```
- [ ] 5.6 日志轮转
    ```bash
    pm2 install pm2-logrotate
    pm2 set pm2-logrotate:max_size 50M
    pm2 set pm2-logrotate:retain 14
    pm2 set pm2-logrotate:compress true
    ```
- [ ] 5.7 Nginx api 反代配置（docs/operations/deployment.md 第 85–107 行）+ 强制 HTTPS 跳转
- [ ] 5.8 `nginx -t && systemctl reload nginx`

**验证**:
- `curl https://api.爱买买.com/api/v1/health` 返回 200
- `pm2 logs aimaimai-api --lines 50` 无 ERROR
- `psql` 连上查 `User` 表有管理员账号

**回滚**:
- `pm2 stop aimaimai-api`
- 回滚 migration: `npx prisma migrate resolve --rolled-back <name>`（或恢复 pg_dump）
- 恢复上一个 git tag: `git checkout <prev-tag> && npm ci && npm run build && pm2 restart`

---

## 步骤 6 — 部署管理后台

**责任**: AI | **工时**: 1 h | **依赖**: 步骤 5
**前置检查**: `admin/` 本地 `npm run build` 通过，admin JWT 登录联调通过

- [ ] 6.1 本地构建
    ```bash
    cd admin
    echo "VITE_API_BASE_URL=https://api.爱买买.com/api/v1" > .env.production
    npm ci && npm run build
    ```
- [ ] 6.2 上传 dist
    ```bash
    rsync -az --delete dist/ deploy@<IP>:/var/www/admin/dist/
    ```
- [ ] 6.3 Nginx 配置（deployment.md 第 130–146 行）+ HTTPS 证书路径
- [ ] 6.4 `nginx -t && systemctl reload nginx`
- [ ] 6.5 浏览器访问 `https://admin.爱买买.com` 用 `admin/admin123456` 登录
- [ ] 6.6 **立即修改超级管理员密码**

**验证**: 管理后台可登录 / 发现页配置页可读写 / 用户列表可查询
**回滚**: `rsync` 恢复上一版 dist 备份

---

## 步骤 7 — 部署卖家后台

**责任**: AI | **工时**: 1 h | **依赖**: 步骤 5 + 6 验证通过
**前置检查**: `seller/` 本地构建通过

- [ ] 7.1 本地构建
    ```bash
    cd seller
    echo "VITE_API_BASE_URL=https://api.爱买买.com/api/v1" > .env.production
    npm ci && npm run build
    ```
- [ ] 7.2 上传: `rsync -az --delete dist/ deploy@<IP>:/var/www/seller/dist/`
- [ ] 7.3 Nginx 配置（deployment.md 第 110–127 行）+ HTTPS
- [ ] 7.4 `nginx -t && systemctl reload nginx`
- [ ] 7.5 **阶梯上线点**: 管理员在管理后台创建 1 个种子商户 Company + CompanyStaff(OWNER)
- [ ] 7.6 用种子商户账号登录 `https://seller.爱买买.com`，完成首次登录流程
- [ ] 7.7 商户上传商品（待审核状态）

**验证**: 种子商户完成「登录 → 上传商品 → 提交审核」全流程
**回滚**: `rsync` 恢复上一版 dist

---

## 步骤 8 — 部署官网 / App 落地页

**责任**: AI | **工时**: 2 h | **依赖**: 步骤 4
**前置检查**: 官网代码仓库存在 / Universal Link 设计完成（见 2026-03-27-deferred-deep-link 计划）

- [ ] 8.1 官网构建（Vite 或纯静态 HTML）
- [ ] 8.2 上传: `/var/www/website/dist/`
- [ ] 8.3 Nginx 配置（deployment.md 第 150–164 行）
- [ ] 8.4 `.well-known` 目录（Universal Link / Android App Link）
    ```
    /var/www/website/dist/.well-known/apple-app-site-association
    /var/www/website/dist/.well-known/assetlinks.json
    ```
    - Nginx 需配置 `location /.well-known/ { default_type application/json; }`
- [ ] 8.5 验证商户入驻表单 POST 到 `/api/v1/merchant-applications`（公开接口）
- [ ] 8.6 推荐码落地页 `/r/:code` 路由（Deferred Deep Link 方案）

**验证**:
- `curl https://爱买买.com/.well-known/apple-app-site-association` 返回 JSON
- 官网表单提交后管理后台可见 MerchantApplication
**回滚**: `rsync` 恢复上一版 dist

---

## 步骤 9 — App 客户端发布

**责任**: AI 构建 + 用户上架 | **工时**: 8 h（不含审核等待）| **依赖**: 步骤 5–8 全部通过 + 生产 smoke test 通过
**前置检查**: 后端 L01–L17 全部上线稳定 48 h 无 P0

- [ ] 9.1 App 代码准备
    - `app.config.ts` 设置 `extra.apiBaseUrl = "https://api.爱买买.com/api/v1"`
    - 版本号: `version: "1.0.0"`, `ios.buildNumber: "1"`, `android.versionCode: 1`
    - Universal Link: `applinks:爱买买.com`
- [ ] 9.2 Expo EAS 配置
    ```bash
    npm install -g eas-cli
    eas login
    eas build:configure
    ```
- [ ] 9.3 iOS 构建
    ```bash
    eas build --platform ios --profile production
    ```
    - 需要 Apple 开发者证书 + provisioning profile
- [ ] 9.4 Android 构建
    ```bash
    eas build --platform android --profile production
    ```
    - 生成 .aab（Google Play）+ .apk（国内商店）
- [ ] 9.5 TestFlight 内测
    - 上传到 App Store Connect
    - 邀请 5 名内测用户验证核心流程
- [ ] 9.6 提交 App Store 审核（预计 1–3 天）
- [ ] 9.7 国内 Android 商店上架
    - 华为 / 小米 / OPPO / vivo / 应用宝
    - 每家填写同一套信息（截图、描述、隐私政策链接）
    - **App 备案号**必须在应用介绍中展示
- [ ] 9.8 发布后监控首批用户登录成功率

**验证**: TestFlight 5/5 内测通过 + App Store 审核通过 + 国内任一商店上架成功
**回滚**:
- 紧急版本: `eas build --profile production --auto-submit` 快速补丁
- TestFlight 可直接撤回测试版本

---

## 步骤 10 — 基础监控

**责任**: AI | **工时**: 2 h | **依赖**: 步骤 5
**前置检查**: PM2 进程运行中

- [ ] 10.1 PM2 monit 面板: `pm2 monit`
- [ ] 10.2 健康检查 cron（每分钟）
    ```bash
    # /etc/cron.d/aimaimai-health
    * * * * * deploy curl -fs https://api.爱买买.com/api/v1/health > /dev/null || echo "API DOWN $(date)" >> /var/log/aimaimai-health.log
    ```
- [ ] 10.3 PM2 异常自动拉起（已默认）+ 邮件告警
    ```bash
    pm2 install pm2-slack   # 或 pm2-health-check
    # 或用自建脚本监控 pm2 jlist 解析 status
    ```
- [ ] 10.4 磁盘空间告警（>80% 告警）
    ```bash
    # /etc/cron.daily/disk-alert
    df -h / | awk 'NR==2 {if($5+0 > 80) print "DISK WARN: " $5}'
    ```
- [ ] 10.5 Postgres 慢查询日志开启: `log_min_duration_statement = 1000`
- [ ] 10.6 Nginx access.log 保留 30 天 + error.log 实时监控
- [ ] 10.7 阿里云云监控站点监控（可选免费）
    - 监控 `https://api.爱买买.com/api/v1/health` 每 5 分钟
    - 告警通知短信 + 邮件

**验证**: 故意 `pm2 stop` 后 2 分钟内收到告警；重启后告警恢复
**回滚**: 禁用 cron 即可

---

## 步骤 11 — 数据备份

**责任**: AI | **工时**: 2 h | **依赖**: 步骤 2
**前置检查**: OSS Bucket 可写 / ossutil 已安装

- [ ] 11.1 安装 ossutil
    ```bash
    curl -o /usr/local/bin/ossutil https://gosspublic.alicdn.com/ossutil/1.7.18/ossutil64
    chmod +x /usr/local/bin/ossutil
    ossutil config -e <endpoint> -i <AK> -k <SK>
    ```
- [ ] 11.2 备份脚本 `/home/deploy/scripts/backup.sh`
    ```bash
    #!/bin/bash
    DATE=$(date +%Y%m%d-%H%M)
    DUMP=/tmp/aimaimai-$DATE.sql.gz
    pg_dump -U aimaimai aimaimai | gzip > $DUMP
    ossutil cp $DUMP oss://aimaimai-prod/backup/db/$DATE.sql.gz
    rm $DUMP
    # Redis 也备份 RDB
    cp /var/lib/redis/dump.rdb /tmp/redis-$DATE.rdb
    ossutil cp /tmp/redis-$DATE.rdb oss://aimaimai-prod/backup/redis/$DATE.rdb
    rm /tmp/redis-$DATE.rdb
    ```
- [ ] 11.3 crontab
    ```
    0 3 * * * /home/deploy/scripts/backup.sh >> /var/log/backup.log 2>&1
    ```
- [ ] 11.4 OSS 生命周期规则: 保留 30 天，之后转归档存储，90 天后删除
- [ ] 11.5 备份恢复演练（上线前必做一次）
    ```bash
    ossutil cp oss://aimaimai-prod/backup/db/<latest>.sql.gz /tmp/
    gunzip -c /tmp/<latest>.sql.gz | psql -U aimaimai -d aimaimai_restore_test
    ```

**验证**: 演练恢复的数据库中查询 User/Order 行数与生产一致
**回滚**: 备份失败不影响业务，修脚本重跑即可

---

## ⚠️ 生产 .env 必配变量清单（核对 backend/.env.example）

### 基础
```
NODE_ENV=production
PORT=3000
TRUST_PROXY=1
CORS_ORIGINS=https://爱买买.com,https://www.爱买买.com,https://seller.爱买买.com,https://admin.爱买买.com,https://app.爱买买.com
```

### 数据库 / Redis
```
DATABASE_URL=postgresql://aimaimai:<strong-pwd>@localhost:5432/aimaimai?schema=public
REDIS_URL=redis://:<redis-pwd>@localhost:6379
```

### JWT（三套独立，生产必须全新随机生成，禁止复用 dev）
```
JWT_SECRET=<openssl rand -base64 48>         # 买家端
JWT_EXPIRES_IN=15m
ADMIN_JWT_SECRET=<openssl rand -base64 48>   # 管理端
SELLER_JWT_SECRET=<openssl rand -base64 48>  # 卖家端
```

### Webhook 签名密钥
```
PAYMENT_WEBHOOK_SECRET=<openssl rand -base64 32>
LOGISTICS_WEBHOOK_SECRET=<openssl rand -base64 32>
```

### 支付宝（生产证书模式，取消注释 backend/.env.example 46–52 行）
```
ALIPAY_APP_ID=<生产 APPID>
ALIPAY_PRIVATE_KEY_PATH=certs/alipay/app-private-key.txt
ALIPAY_APP_CERT_PATH=certs/alipay/appCertPublicKey.crt
ALIPAY_PUBLIC_CERT_PATH=certs/alipay/alipayCertPublicKey.crt
ALIPAY_ROOT_CERT_PATH=certs/alipay/alipayRootCert.crt
ALIPAY_NOTIFY_URL=https://api.爱买买.com/payments/alipay/notify
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
```

### 顺丰丰桥（L8 完成后填入；**替换掉原 KUAIDI100_*** 变量）
```
SF_CLIENT_CODE=<丰桥 clientCode>
SF_CHECK_WORD=<丰桥 checkWord>
SF_MONTH_CARD=<月结账号>
SF_API_URL=https://bsp-oisp.sf-express.com
SF_CALLBACK_URL=https://api.爱买买.com/api/v1/shipments/sf/callback
SF_CALLBACK_SECRET=<openssl rand -base64 32>
```

### 阿里云 OSS
```
UPLOAD_LOCAL=false            # 必须切换！
UPLOAD_LOCAL_PRIVATE=false
OSS_REGION=oss-cn-hangzhou
OSS_ACCESS_KEY_ID=<RAM AK>
OSS_ACCESS_KEY_SECRET=<RAM SK>
OSS_BUCKET=aimaimai-prod
OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
```

### 阿里云短信
```
SMS_MOCK=false                # 必须切换！
SMS_ACCESS_KEY_ID=<RAM AK>
SMS_ACCESS_KEY_SECRET=<RAM SK>
SMS_SIGN_NAME=爱买买
SMS_TEMPLATE_CODE=SMS_<生产模板>
SMS_TEMPLATE_ORDER=SMS_<订单通知模板>
SMS_TEMPLATE_MERCHANT=SMS_<商户审核模板>
```

### 阿里云邮件推送（可选，若启用发票邮件）
```
EMAIL_SMTP_HOST=smtpdm.aliyun.com
EMAIL_SMTP_PORT=465
EMAIL_SMTP_USER=noreply@mail.aimaimai.com
EMAIL_SMTP_PASS=<SMTP 密码>
```

### AI（阿里云百炼）
```
DASHSCOPE_API_KEY=<生产 Key>
QWEN_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_CS_INTENT_MODEL=qwen-plus
```

### 微信（v1.0 暂不启用，保留 mock）
```
WECHAT_MOCK=true
WECHAT_APP_ID=placeholder
WECHAT_APP_SECRET=placeholder
```

### 🔁 Mock 开关切换清单（上线前逐项确认）
| 变量 | Dev 值 | Prod 值 | 状态 |
|------|--------|---------|------|
| `SMS_MOCK` | true | **false** | ☐ |
| `UPLOAD_LOCAL` | true | **false** | ☐ |
| `UPLOAD_LOCAL_PRIVATE` | true | **false** | ☐ |
| `WECHAT_MOCK` | true | **true**（v1.0 保留） | ☐ |
| `AI_SEMANTIC_SLOTS_ENABLED` | false | **true** | ☐ |
| `AI_PRODUCT_SEMANTIC_FIELDS_ENABLED` | false | **true** | ☐ |
| `AI_SEMANTIC_SCORING_ENABLED` | false | **true** | ☐ |

---

## 🎯 完成判定（生产 Smoke Test）

全部步骤勾选 + 下列端到端验证全部通过:

### 后端基础
- [ ] `GET https://api.爱买买.com/api/v1/health` → 200
- [ ] PM2 `aimaimai-api` 状态 online，restart 次数 0
- [ ] `pm2 logs` 最近 100 行无 ERROR

### 管理端
- [ ] `admin.爱买买.com` 登录成功（已改密）
- [ ] 创建 1 个 Company + 1 个 CompanyStaff(OWNER)
- [ ] 发现页筛选配置可读写
- [ ] 查看 RewardLedger 列表正常

### 卖家端
- [ ] `seller.爱买买.com` 种子商户登录成功
- [ ] 发布 1 个商品（auditStatus=PENDING）
- [ ] 管理员审核通过后商品 ACTIVE

### 官网
- [ ] `爱买买.com` 首页加载
- [ ] 商户入驻表单提交成功
- [ ] `/r/:code` 推荐码落地页工作

### App（TestFlight 阶段即可）
- [ ] App 冷启动 < 5 s
- [ ] 短信验证码登录成功
- [ ] 浏览商品 → 加购 → 支付宝支付 → 订单生成
- [ ] 抽奖功能可用
- [ ] VIP 购买流程走通
- [ ] 客服消息收发正常
- [ ] 申请退款流程走通

### 监控 / 备份
- [ ] 故意停 PM2 触发一次告警
- [ ] 手动运行 `backup.sh` 一次，OSS 看到文件
- [ ] 备份恢复演练成功

### 安全
- [ ] 三套 JWT Secret 均为生产新密钥
- [ ] `.env` 权限 600
- [ ] SSH 禁用 root 密码登录（PubkeyAuthentication only）
- [ ] `ufw status` 仅 22/80/443
- [ ] Certbot 自动续期 cron 已配

---

**Done criteria**: 以上全部勾选 + 首批 500 用户接入后 48 小时无 P0 事件。

L13 deployment checklist written

