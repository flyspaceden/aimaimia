# 团长申请设计方案

## 1. 目标

在不修改 VIP 树、普通树、Reward 消费积分、Coupon 平台红包和现有团长收益结算逻辑的前提下，新增一条 App 侧“申请成为团长”入口和管理后台审核链路。

第一版采用“轻申请 + 后台审核 + 审核通过自动开通团长”的模式。普通用户提交申请后不会自动成为团长；管理员审核通过后，系统复用现有 `CaptainRelationService.createCaptainProfile()` 创建 `CaptainProfile` 和 `CaptainAccount`。

## 2. 非目标

1. 不做达标自动升级团长。
2. 不要求购买 399 或成为 VIP 才能申请。
3. 不收取入门费、保证金、培训费或任何升级费用。
4. 不采集身份证、银行卡、营业执照等强敏感信息。
5. 不把申请记录写入 VIP 树、普通分润树、Reward 或 Coupon。

## 3. 用户流程

### 3.1 买家 App

普通用户在“我的”页看到“申请团长”入口。进入后根据状态展示：

| 状态 | 展示 | 可操作 |
|------|------|--------|
| 未申请 | 团长申请表单 | 提交申请 |
| 审核中 | 提交时间、申请摘要、审核中提示 | 不可重复提交 |
| 已驳回 | 驳回原因、重新申请入口 | 修改后重新提交 |
| 已通过 | 已开通提示 | 跳转团长经营中心 |
| 已是团长 | 团长经营入口 | 跳转团长经营中心 |

申请表单字段：

- 真实姓名
- 联系微信或手机号
- 所在城市 / 经营区域
- 社群规模：`NONE` / `UNDER_50` / `50_200` / `200_500` / `OVER_500`
- 预计月销售能力：`UNDER_3000` / `3000_10000` / `10000_30000` / `OVER_30000`
- 资源类型：朋友圈、微信群、视频号、线下社区、餐饮店、企业团购、亲友圈等多选
- 推广计划说明
- 预包装海鲜经验：无 / 买过 / 卖过 / 有供应链或团购经验
- 合规承诺勾选：不收入门费、不要求囤货、不承诺固定收益、收益来自真实商品成交、接受月度考核和售后冲回

系统自动带出但不让用户填写：

- `buyerNo`
- 昵称、手机号
- 是否 VIP
- 是否已绑定团长
- 历史订单数
- 历史消费金额
- 退款率

### 3.2 管理后台

在“团长经营”下新增“团长申请”菜单。

列表字段：

- 申请人
- 用户编号
- 手机号
- 所在城市
- 社群规模
- 预计月 GMV
- 当前绑定团长
- 历史订单数
- 历史消费金额
- 退款率
- 状态：待审核 / 已通过 / 已驳回 / 已撤回
- 申请时间

审核动作：

- 通过：可设置团长码和展示名称；通过后自动创建团长资料和账户。
- 驳回：必须填写驳回原因。
- 查看详情：展示用户填写内容和系统自动指标。

## 4. 后端模型

新增枚举：

```prisma
enum CaptainApplicationStatus {
  PENDING
  APPROVED
  REJECTED
  WITHDRAWN
}
```

新增模型：

```prisma
model CaptainApplication {
  id                    String                   @id @default(cuid())
  userId                String
  user                  User                     @relation("CaptainApplicationUser", fields: [userId], references: [id], onDelete: Restrict)
  programCode           String                   @default("SEAFOOD_PREPACKAGED")
  status                CaptainApplicationStatus @default(PENDING)
  realName              String
  contact               String
  city                  String
  communityScale        String
  expectedMonthlyGmv    String
  resourceTypes         Json
  promotionPlan         String
  seafoodExperience     String
  complianceAccepted    Boolean                  @default(false)
  systemSnapshot        Json
  reviewedByAdminId     String?
  reviewedAt            DateTime?
  rejectReason          String?
  captainProfileUserId  String?
  meta                  Json?
  createdAt             DateTime                 @default(now())
  updatedAt             DateTime                 @updatedAt

  @@index([status, createdAt])
  @@index([userId, status, createdAt])
  @@index([programCode, status, createdAt])
}
```

不使用 `@@unique([userId, status])`，因为 PostgreSQL 不能用普通 Prisma unique 表达“每个用户只能有一个 PENDING”。第一版在 Serializable 事务内检查未完成申请；如果后续要强约束，可追加 partial unique index。

## 5. API

买家端：

- `GET /captain/applications/me`
- `POST /captain/applications`

管理端：

- `GET /admin/captain/applications`
- `GET /admin/captain/applications/:id`
- `POST /admin/captain/applications/:id/approve`
- `POST /admin/captain/applications/:id/reject`

## 6. 安全与合规

1. 提交申请不产生任何收益、佣金、积分或红包。
2. 审核通过才开通团长；开通仍复用现有团长独立账户。
3. 审核通过、驳回必须在 `Serializable` 事务内完成，避免重复审核。
4. 通过时若用户已是团长，返回已有团长状态，不重复创建。
5. 驳回后允许重新提交；审核中不允许重复提交。
6. 申请信息只用于人工审核，不作为逐单分润依据。

## 7. 验收标准

1. 普通用户可从 App 我的页进入申请页面并提交申请。
2. 审核中用户不能重复提交。
3. 驳回用户可看到原因并重新提交。
4. 管理后台可查看申请列表和详情。
5. 管理员审核通过后，该用户成为 ACTIVE 团长，App 我的页显示“团长经营”入口。
6. 管理员驳回必须填写原因。
7. 申请链路不修改 VIP 树、普通树、Reward、Coupon。
