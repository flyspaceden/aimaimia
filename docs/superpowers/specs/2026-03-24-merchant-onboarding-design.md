# 商户自助入驻功能设计方案

## 背景

App 正在备案认证阶段，但已有商户希望先入驻平台、在企业系统中上货，等 App 上线后直接展示商品。当前商户入驻流程是纯手动的（管理员在后台创建 Company → 手动绑定 Owner），无法规模化接受商户申请。

## 目标

1. 商户可以在官网（爱买买.com）自助提交入驻申请
2. 管理员在管理后台审核申请（通过/拒绝）
3. 审核通过后商户自动获得企业系统账号，可以登录上货
4. 与现有管理员手动添加企业的流程互不干扰

## 架构选型

**方案：独立 MerchantApplication 模型**

入驻申请数据存储在独立的 `MerchantApplication` 表中，不污染正式的 `Company` 表。审核通过后才从申请数据自动创建 Company + User + CompanyStaff。

两个入驻来源各走各的路：
- 网站自助申请 → MerchantApplication → 审核 → 自动创建 Company
- 管理员手动添加 → 直接创建 Company（现有流程不变）

## 一、数据模型

### 新增枚举

```prisma
enum MerchantApplicationStatus {
  PENDING    // 待审核
  APPROVED   // 已通过
  REJECTED   // 已拒绝
}
```

### 新增模型

```prisma
model MerchantApplication {
  id             String                      @id @default(cuid())

  // 公司信息
  companyName    String                      // 公司名称
  category       String                      // 经营品类（自由填写，后续可改为下拉选择）

  // 联系人信息
  contactName    String                      // 联系人姓名
  phone          String                      // 手机号（必填，用于创建卖家账号）
  email          String?                     // 邮箱（可选，用于通知）

  // 资质文件
  licenseFileUrl String                      // 营业执照文件 URL

  // 审核
  status         MerchantApplicationStatus   @default(PENDING)
  rejectReason   String?                     // 拒绝原因
  reviewedAt     DateTime?                   // 审核时间
  reviewedBy     String?                     // 审核人（AdminUser ID）

  // 审核通过后关联
  companyId      String?                     // 通过后创建的 Company ID

  createdAt      DateTime                    @default(now())
  updatedAt      DateTime                    @updatedAt

  @@index([status])
  @@index([phone])
}
```

**设计说明：**
- `phone` + PENDING 状态的唯一性通过业务逻辑保证（提交前查询是否存在 PENDING 记录），不依赖数据库 partial unique 约束
- `companyId` 只在审核通过后填入，用于追溯"这个申请创建了哪个公司"
- `category` 用 String 而非枚举，农业品类灵活多变，后续可改为关联 Category 表或下拉选择

## 二、后端 API

### 2.1 公开接口（无需登录）

#### `POST /api/v1/merchant-applications` — 提交入驻申请

```
Content-Type: multipart/form-data

字段:
  companyName:   string  (必填，公司名称)
  category:      string  (必填，经营品类)
  contactName:   string  (必填，联系人姓名)
  phone:         string  (必填，手机号格式校验)
  email:         string  (可选，邮箱格式校验)
  licenseFile:   File    (必填，jpg/png/pdf，≤5MB)
  captchaToken:  string  (必填，验证码令牌)

成功返回（统一响应，不暴露手机号状态）:
  { ok: true, data: { message: "申请已提交，请等待审核" } }

错误:
  400 — 参数校验失败
  429 — 频率限制
```

**重要：手机号重复（已有 PENDING 申请）时不返回 409，统一返回成功消息，防止手机号枚举攻击。**

**文件上传策略：** merchant-applications 控制器自行处理 multipart 上传（使用 NestJS `FileInterceptor` + multer 配置），不复用现有的 `/api/v1/upload` 端点（该端点需要登录）。控制器内完成文件校验（MIME + magic bytes + 大小）后，用 cuid 重命名存储到 `uploads/merchant-applications/` 目录。

### 2.2 管理端接口（需管理员登录）

**权限标识：** 复用现有企业管理权限，列表/详情使用 `companies:read`，通过/拒绝使用 `companies:audit`。

#### `GET /admin/merchant-applications` — 申请列表

```
Query: page, pageSize, status(可选过滤), keyword(搜索公司名/手机号)
返回: 分页列表 { items: MerchantApplication[], total }
```

#### `GET /admin/merchant-applications/:id` — 申请详情

```
返回: 完整申请信息 + 该手机号历史申请记录
```

#### `POST /admin/merchant-applications/:id/approve` — 审核通过

```
前置校验:
  - 如果 application.status !== PENDING，返回 409 "该申请已被处理"（幂等保护）

自动执行（单个数据库事务内，默认隔离级别，无资金操作无需 Serializable）:
  1. 查找或创建 User(phone) + AuthIdentity(PHONE, appId=null)
  2. 创建 Company(status=ACTIVE, name=companyName, contact={name,phone})
     注意：自助入驻的企业直接为 ACTIVE。管理员手动创建的企业走
     现有 PENDING→ACTIVE 审核流程，两条路径各自独立。
  3. 创建 CompanyStaff(role=OWNER, status=ACTIVE)
  4. 复制营业执照到 CompanyDocument(type=LICENSE, title="营业执照", verifyStatus=VERIFIED)
  5. 更新 MerchantApplication(status=APPROVED, companyId, reviewedAt, reviewedBy)
  --- 事务结束 ---
  6. 发送短信通知："【爱买买】您的入驻申请已通过，请访问 seller.爱买买.com 用手机号登录卖家后台"
  7. 如有邮箱，发送邮件通知（包含登录地址、操作指引）

返回: { ok: true, data: { companyId, staffId } }
```

#### `POST /admin/merchant-applications/:id/reject` — 审核拒绝

```
前置校验:
  - 如果 application.status !== PENDING，返回 409 "该申请已被处理"（幂等保护）

Body: { reason: string (必填) }

自动执行:
  1. 更新 MerchantApplication(status=REJECTED, rejectReason, reviewedAt, reviewedBy)
  2. 发送短信通知："【爱买买】您的入驻申请未通过，原因：{reason}。如有疑问请联系客服"
  3. 如有邮箱，发送邮件通知（包含完整拒绝原因）

返回: { ok: true }
```

### 2.3 边界情况

| 场景 | 处理 |
|------|------|
| 同一手机号已有 PENDING 申请 | 静默成功，不重复创建，不暴露状态 |
| 同一手机号被拒绝后重新申请 | 允许，创建新的申请记录 |
| 手机号对应的 User 已存在 | 复用该 User，不重复创建 |
| 该 User 已是其他公司 Owner | 允许，一个人可拥有多个公司 |
| approve 事务中任一步失败 | 全部回滚，申请状态不变，管理员可重试 |
| approve/reject 重复调用 | 前置检查 status !== PENDING 则返回 409，幂等保护 |
| 商户提交后发现信息有误 | 当前无法自助修改，需联系客服。后续可增加"查询申请状态"端点 |

## 三、安全措施

### 3.1 公开接口防护

| 措施 | 实现 | 说明 |
|------|------|------|
| **验证码** | 图形验证码（前期占位），后续可升级为滑块验证（腾讯天御/阿里云） | 防机器人批量提交，必须在表单提交前通过 |
| **IP 频率限制** | `@Throttle({ default: { ttl: 3600000, limit: 5 } })` 提交接口；验证码接口 `@Throttle({ default: { ttl: 60000, limit: 10 } })` | 防批量提交和验证码刷取 |
| **统一错误响应** | 手机号重复不返回特殊错误码 | 防止手机号枚举探测 |
| **文件类型校验** | MIME 白名单（image/jpeg, image/png, application/pdf）+ magic bytes 校验 | 不仅看扩展名，验证文件头部字节 |
| **文件大小限制** | ≤ 5MB | 后端校验 + Nginx client_max_body_size |
| **文件重命名** | cuid 生成新文件名，不保留原始文件名 | 防路径穿越攻击 |
| **存储目录隔离** | 上传文件存储在专用目录，Nginx 禁止执行权限 | 防恶意脚本执行 |

### 3.2 服务器层面

| 措施 | 实现 |
|------|------|
| **防火墙** | 只开放 80（HTTP）和 443（HTTPS）端口，PostgreSQL(5432) 和 Redis(6379) 仅监听 127.0.0.1 |
| **管理后台 IP 白名单** | Nginx 层对 admin.爱买买.com 配置 `allow/deny`，只允许办公网络 IP 访问 |
| **隐藏文件保护** | Nginx 配置 `location ~ /\. { deny all; }` 禁止访问 .env 等隐藏文件 |
| **HTTPS 强制** | 所有子域名强制 HTTPS，HTTP 301 跳转 |
| **安全响应头** | Helmet 已启用；上传目录额外增加 `X-Content-Type-Options: nosniff` |

### 3.3 验证码实现方案

前期采用简单的服务端图形验证码：

```
1. 前端请求 GET /api/v1/captcha → 返回 { captchaId, imageBase64 }
2. 后端生成随机字符串，存入 Redis（key=captchaId，TTL=5分钟）
3. 用户填写验证码，连同 captchaId 一起提交
4. 后端校验后立即删除 Redis key（一次性使用）
```

后续可升级为第三方滑块验证服务，只需替换前端组件 + 后端校验逻辑。

### 3.4 验证码模块结构

新建 `backend/src/modules/captcha/` 独立模块：
- `CaptchaController` — `GET /api/v1/captcha`（公开接口，`@Throttle({ default: { ttl: 60000, limit: 10 } })`）
- `CaptchaService` — 生成图形验证码 + Redis 存储/校验/删除
- 可被任何需要验证码保护的公开接口复用（如未来的"查询申请状态"端点）

## 四、管理后台前端改动

### 4.1 企业管理页面新增"入驻申请"Tab

在现有企业管理页面（admin/src/pages/companies/index.tsx）的 Tab 栏新增第三个 Tab：

```
全部企业  |  待审核  |  入驻申请(3)
                              ↑ 括号内显示 PENDING 数量
```

- **全部企业** — 现有逻辑不变（Company 表）
- **待审核** — 现有逻辑不变（Company status=PENDING，管理员手动创建的）
- **入驻申请** — 新增，数据来自 MerchantApplication 表

### 4.2 入驻申请列表

| 列 | 说明 |
|----|------|
| 公司名称 | companyName |
| 联系人 | contactName |
| 手机号 | phone（脱敏显示 138****5005） |
| 经营品类 | category |
| 申请时间 | createdAt |
| 状态 | PENDING/APPROVED/REJECTED 标签 |
| 操作 | 详情 / 通过 / 拒绝 |

支持按状态筛选（全部/待审核/已通过/已拒绝）和关键词搜索（公司名/手机号）。

### 4.3 申请详情

点击"详情"弹出抽屉（Drawer），展示：
- 全部申请字段
- 营业执照预览（图片直接展示，PDF 显示链接）
- 该手机号的历史申请记录（如有被拒绝的记录）

### 4.4 审核操作

- **通过**：二次确认弹窗（Modal）→ 调用 approve → 成功提示 → 列表刷新
- **拒绝**：弹窗要求填写拒绝原因（必填 textarea）→ 调用 reject → 成功提示 → 列表刷新

### 4.5 新增 API 调用文件

```typescript
// admin/src/api/merchant-applications.ts
GET  /admin/merchant-applications              // 列表
GET  /admin/merchant-applications/:id          // 详情
POST /admin/merchant-applications/:id/approve  // 通过
POST /admin/merchant-applications/:id/reject   // 拒绝
```

## 五、网站前端改动

### 5.1 API 配置

网站目前是纯静态站，零 API 调用。需要新增：
- `website/.env` 增加 `VITE_API_BASE_URL=https://api.爱买买.com/api/v1`
- 新建轻量 API 工具（基于 fetch 封装，不需要引入 axios）

### 5.2 页面流程

```
Merchants.tsx（现有页面）
  两处"立即入驻"按钮 → 改为跳转到 /merchants/apply

MerchantApply.tsx（新页面）
  表单字段：
    - 公司名称（必填，text）
    - 经营品类（必填，text）
    - 联系人姓名（必填，text）
    - 手机号（必填，tel，格式校验）
    - 邮箱（可选，email）
    - 营业执照上传（必填，file，图片/PDF，≤5MB）
    - 图形验证码（必填，image + input）

  提交成功 → 显示成功页面："申请已提交，我们将在 1-3 个工作日内完成审核"
  提交失败 → 显示错误提示，可重试
```

### 5.3 新增路由

注意：网站使用 HashRouter（GitHub Pages 不支持 SPA 服务端路由），实际 URL 为 `/#/merchants/apply`。

```
/#/merchants         → Merchants.tsx（现有，营销页面）
/#/merchants/apply   → MerchantApply.tsx（新增，入驻申请表单）
```

## 六、审核通过自动化流程

管理员点击"通过"后，后端在一个数据库事务内完成以下步骤：

```
步骤 0：前置校验
  └── 如果 application.status !== PENDING → 返回 409 "该申请已被处理"

步骤 1：查找或创建 User
  ├── 查找 AuthIdentity(provider=PHONE, identifier=phone)（与卖家登录一致，不过滤 appId）
  ├── 存在 → 复用该 User
  └── 不存在 → 创建 User + UserProfile(nickname=contactName) + AuthIdentity(PHONE, appId=null)

步骤 2：创建 Company
  ├── name = companyName
  ├── contact = { name: contactName, phone: phone }
  ├── status = ACTIVE
  └── 同时创建 CompanyProfile

步骤 3：创建 CompanyStaff
  ├── userId = 步骤 1 的 User
  ├── companyId = 步骤 2 的 Company
  ├── role = OWNER
  └── status = ACTIVE

步骤 4：复制营业执照
  ├── 创建 CompanyDocument
  ├── type = LICENSE
  ├── title = "营业执照"
  ├── fileUrl = 申请中的 licenseFileUrl
  └── verifyStatus = VERIFIED

步骤 5：更新申请记录
  ├── status = APPROVED
  ├── companyId = 步骤 2 的 Company ID
  ├── reviewedAt = now()
  └── reviewedBy = 当前管理员 ID

--- 事务结束 ---

步骤 6（事务外）：发送通知
  ├── 短信："您的入驻申请已通过，请访问 seller.爱买买.com 用手机号登录"
  └── 邮件（如有）：包含更详细的操作指引
```

## 七、后续迭代（Phase 4）

以下功能不在本次实施范围内，记入后续计划：

1. **管理后台"添加企业"按钮** — 在"全部企业"Tab 右上角增加手动创建企业的入口和表单
2. **登录通知** — 首次登录时发短信告知"您的企业系统账号已在 xxx 登录"
3. **设备指纹 + 异地登录二次验证** — 记录常用设备，新设备登录要求额外验证
4. **经营品类下拉选择** — category 从自由文本改为关联 Category 表或预设选项
5. **申请状态查询** — 商户用手机号 + 验证码查询自己的申请状态（解决提交后无法自助查询/修改的问题）
6. **管理员新申请通知** — 新申请提交时通知管理员（邮件或实时推送），目前仅靠管理员主动刷新页面查看

## 八、不涉及改动的现有模块

以下模块无需修改，审核通过后自然衔接：

- **卖家认证系统** — 商户用手机号 + 短信验证码登录，现有流程完全匹配
- **员工管理** — Owner 登录后可在企业系统中添加 MANAGER/OPERATOR
- **商品管理** — 商户上货走现有 seller/products 流程，与 App 是否上线无关
- **管理后台企业详情** — 通过 approve 创建的 Company 自动出现在"全部企业"中，详情页可查看员工、资质等信息
