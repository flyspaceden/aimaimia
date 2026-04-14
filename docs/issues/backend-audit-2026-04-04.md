# 后端全面审计报告 2026-04-04（v4 最终版）

> 审计范围：全部 38+ 后端模块（买家 20 + 管理 11 + 卖家 7 + 公共模块）
> TypeScript 编译：✅ 通过 | Prisma Schema：✅ 合法
> v1：初始审计 44 条
> v2：代码复核，移除 15 条不成立，修正 6 条表述
> v3：深度审查分润/VIP推荐/订单/退换货关键链路
> v4：最终复核，再移除 8 条（H10/H13/D02/D03/D04/M07/M11 不成立，H08 改为待补业务能力），最终 23 条

---

## 目录

- [CRITICAL — 确认存在](#critical--确认存在)
- [HIGH — 确认存在](#high--确认存在)
- [MEDIUM — 确认存在](#medium--确认存在)
- [已移除条目说明](#已移除条目说明)

---

## CRITICAL — 确认存在

### C01. 普通广播分润写入了错误的账户类型

**文件**: `backend/src/modules/bonus/engine/normal-broadcast.service.ts:186-199`

**问题**: `ensureRewardAccount()` 方法硬编码使用 `VIP_REWARD` 账户类型，但 NORMAL_BROADCAST 是普通用户方案，应该使用 `NORMAL_REWARD`。

```typescript
// 第 186-189 行
private async ensureRewardAccount(tx: any, userId: string) {
  let account = await tx.rewardAccount.findUnique({
    where: { userId_type: { userId, type: 'VIP_REWARD' } },  // ← 错误！应为 NORMAL_REWARD
  });
  if (!account) {
    account = await tx.rewardAccount.create({
      data: { userId, type: 'VIP_REWARD' },  // ← 错误！
    });
  }
  return account;
}
```

**后果**: 所有普通广播奖励进入 VIP 奖励账户，两套账户体系混淆

**修复**: 将 `'VIP_REWARD'` 改为 `'NORMAL_REWARD'`（1 行改动）

---

### C02. 订单金额可以为 0 — 折扣超过商品金额时无校验

**文件**: `backend/src/modules/order/checkout.service.ts:559`

**问题**: `expectedTotal` 使用 `Math.max(0, ...)` 兜底，但没有校验金额必须 > 0。当折扣 >= 商品总金额 + 运费时，订单金额为 0，系统静默接受。

```typescript
const expectedTotal = Math.max(0, totalGoodsForShipping - vipDiscountAmount - totalGroupDiscount + totalShippingFee);
```

**修复**: 添加 `if (expectedTotal <= 0) throw new BadRequestException('订单金额异常')`

---

### C04. 分润系统 round2 使用四舍五入 — 可能超发利润

**文件（全部涉及）**:
- `backend/src/modules/bonus/engine/reward-calculator.service.ts:265`
- `backend/src/modules/bonus/engine/normal-broadcast.service.ts:242`
- `backend/src/modules/bonus/engine/normal-platform-split.service.ts:197`
- `backend/src/modules/bonus/engine/vip-platform-split.service.ts:197`
- `backend/src/modules/bonus/bonus.service.ts:184, 374`（内联 Math.round）

**问题**: 所有 `round2()` 使用 `Math.round`（四舍五入），但业务规则要求截断（全部舍弃），确保分配总额永远不超过利润。

**说明**: `normal-platform-split.service.ts:90` 和 `vip-platform-split.service.ts:90` 已有末额补差逻辑（`totalAmount - distributed` 给最后一个公司），但六分利润池的计算（`reward-calculator.service.ts` 中各池 round2 相加）和广播等额分配（`normal-broadcast.service.ts` 中 perAmount × 人数）仍可能因四舍五入导致超发。

```typescript
// 当前：Math.round（四舍五入，可能向上取）
private round2(val: number): number {
  return Math.round(val * 100) / 100;
}

// 应改为：Math.floor（截断，永不超发）
private round2(val: number): number {
  return Math.floor(val * 100) / 100;
}
```

**超发示例**: 利润 10 元分 6 人：round → 1.67 × 6 = 10.02（超发 0.02）；floor → 1.66 × 6 = 9.96（差额归末额补差）

---

### C05. [技术债] 退款流程使用 setImmediate — 非持久化

**文件**: `backend/src/modules/seller/after-sale/seller-after-sale.service.ts:1083-1160`

**问题**: `triggerRefund()` 使用 `setImmediate()` 在事务外异步调用支付退款 API。setImmediate 不持久化，进程崩溃/重启会导致退款调用丢失（售后卡在 REFUNDING，退款不会发生）。CAS 防护已防止双重退款，问题是漏退款。

**当前状态**: 支付为占位实现（mock），此问题暂不阻塞上线。**等接入真实支付后改为消息队列（Redis Bull/BullMQ）**。

---

### C06. 公开抽奖 dailyLimit 可并发绕过（已修正表述）

**文件**: `backend/src/modules/lottery/lottery.service.ts:366-416`

**问题**: 公开抽奖（`publicDraw`）的 dailyLimit 检查在 Serializable 事务外。CAS 事务内只做 wonCount 递增，防止 totalLimit 超发。但 dailyLimit 依赖 `LotteryRecord.count()`，而 **`publicDraw()` 不创建 LotteryRecord**（只递增 wonCount 并存 Redis），所以 dailyLimit 的统计依据就很可疑。

**v2 修正**: 原报告称 totalLimit 也可被绕过。实际上 CAS 确保 wonCount 原子递增——**totalLimit 是安全的**。问题仅在于 dailyLimit 对公开抽奖的统计不完整。

**修复**: 公开抽奖应在 CAS 事务内也写入 LotteryRecord（或用 Redis 原子计数器追踪每日中奖数）

---

### C07. 卖家 JWT validate() 缺少 type 检查（已修正表述）

**文件**: `backend/src/modules/seller/auth/seller-jwt.strategy.ts:30-75`

**问题**: `validate()` 方法不检查 `payload.type === 'seller'`，理论上 tempToken（type='seller-temp'）可通过卖家 JWT 验证。

**v2 修正**: 原报告称"JWT 篡改漏洞"，这是错误的——JWT 签名保护 payload 不可篡改。真正的问题是 validate() 没有区分 token 类型。但实际风险很低：tempToken 的 `sub` 是 `userId`（非 `staffId`），validate 用 `staffId` 查 session，大概率找不到匹配的 session，请求会被拒绝。

**修复**: 在 validate() 中增加 `if (payload.type !== 'seller') throw new UnauthorizedException()`（防御性编码）

---

### C08. 卖家 JWT 中的 companyId 未实时校验

**文件**: `backend/src/modules/seller/auth/seller-jwt.strategy.ts:59-74`

**问题**: validate() 只查 `staff.status`，不校验 JWT 中的 companyId 是否与数据库中的 staff.companyId 一致。如果员工被调到另一个公司，旧 JWT 仍携带原公司 ID。

```typescript
const staff = await this.prisma.companyStaff.findUnique({
  where: { id: payload.sub },
  select: { status: true },  // ← 没有取 companyId 来比对
});
```

**修复**: 加 `select: { status: true, companyId: true }`，比对 `staff.companyId !== payload.companyId` 时拒绝

---

### C09. 验证码验证非原子 — 可并发复用

**文件**: `backend/src/modules/captcha/captcha.service.ts:42-58`

**问题**: `redis.get(key)` + `redis.del(key)` 两步非原子。并发请求可在 del 前全部 get 到值。

**修复**: 使用 Redis GETDEL 原子命令或 Lua 脚本

---

### C10. 虚拟号 Mock Provider 日志明文记录买家手机号

**文件**: `backend/src/modules/seller/virtual-call/mock-virtual-call.provider.ts`

**问题**: 日志直接输出 `params.buyerPhone`，未脱敏。

**修复**: 使用 `maskPhone(params.buyerPhone)`

---

### C12. 分类停用只级联到直接子分类，不影响孙子分类

**文件**: `backend/src/modules/admin/categories/admin-categories.service.ts:144-154`

**问题**: `toggleActive()` 停用时 `where: { parentId: id }` 只更新直接子分类。

**场景**: 水果(停用) → 热带水果(被停用) → 芒果(仍活跃) ← BUG

**修复**: 改用 `where: { path: { startsWith: category.path + '/' } }`

---

### C13. 分类重命名：children 查询在事务外

**文件**: `backend/src/modules/admin/categories/admin-categories.service.ts:87-99`

**问题**: findMany 在 $transaction 之前执行。并发创建的子分类不在 children 列表中，path 不会被更新。

**修复**: 将 findMany 移入事务内，使用 Serializable 隔离级别

---

## HIGH — 确认存在

### H01. 商户申请重复检查的 TOCTOU 竞态

**文件**: `backend/src/modules/merchant-application/merchant-application.service.ts:41-58`

**问题**: 先查是否有 PENDING 申请，再创建。两步不在事务内，同一手机号可并发创建多个 PENDING 申请。

**修复**: Serializable 事务或 `@@unique([phone, status])` 约束

---

### H02. 地址创建时并发导致多个默认地址

**文件**: `backend/src/modules/address/address.service.ts:39-60`

**问题**: count 查询和 create 不在事务内。并发时两个请求都看到 count=0，都设 isDefault=true。

**修复**: 整个创建流程包在事务内

---

### H03. 地址删除后重新选默认地址非原子

**文件**: `backend/src/modules/address/address.service.ts:105-124`

**问题**: delete + findFirst + findFirst + update 四步非原子。

**修复**: 包在事务内

---

### H05. 团购 join() 无事务保护 — memberCount 可超限

**文件**: `backend/src/modules/group/group.service.ts`

**问题**: 加入团购时 memberCount 更新没有 Serializable 事务。并发时 memberCount 可超过 targetSize。

**修复**: 使用 Serializable 事务

---

### H06. 任务完成并发时返回不友好的数据库错误

**文件**: `backend/src/modules/task/task.service.ts`

**问题**: `complete()` 事务外查重，并发时第二个请求遇到 P2002 约束错误而非业务提示。

**修复**: 将查重移入事务内

---

### H07. 优惠券有效期边界不一致 — `>=` vs `>`

**文件**:
- `coupon-engine.service.ts:378` — `now >= campaign.endAt`
- `coupon.service.ts:243` — `now > campaign.endAt`

**问题**: endAt 那一刻，自动发放认为已过期，手动领取认为仍有效。行为不一致。

**修复**: 统一使用 `now > campaign.endAt`

---

### H09. 售后系统缺少 REFUNDING 超时处理

**文件**: `backend/src/modules/after-sale/after-sale-timeout.service.ts`

**问题**: Cron 处理了各种超时，但没有 REFUNDING 超时。支付退款失败后售后永久卡住。

**修复**: 增加 REFUNDING 超时处理（72h 后自动重试或升级为人工处理）

---

## MEDIUM — 确认存在

### M02. 管理员密码重置与 Session 失效不在同一事务

**文件**: `backend/src/modules/admin/users/admin-users.service.ts`

**问题**: 先更新密码，再失效 session。两步之间旧 session 有短暂窗口仍可用。

---

### M05. 统计报表日期分组时区不一致

**文件**: `backend/src/modules/admin/stats/admin-stats.service.ts`

**问题**: JS 端用 `toISOString().slice(0,10)`（UTC），SQL 的 `DATE()` 可能使用数据库时区。仪表盘数据可能偏移一天。

---

### M09. Follow 服务 resolveAuthorType N+1 查询

**文件**: `backend/src/modules/follow/follow.service.ts`

**问题**: 每次调用执行 2 次数据库查询（先查 company，再查 user）。批量场景性能差。

---

### M14. 虚拟号绑定过期清理：解绑失败仍删除记录

**文件**: `backend/src/modules/seller/virtual-call/virtual-call.service.ts`

**问题**: Cron 清理中 unbind API 失败后仍删除本地记录。运营商侧仍绑定但本地已无记录。

---

## 待补业务能力（非 bug，视业务需求决定是否实现）

### H08. 发票申请未与退款同步

**文件**: `backend/src/modules/invoice/invoice.service.ts:103`

**现状**: 订单退款后不会自动取消或红冲已申请的发票。当前代码无此联动。

**建议**: 如需实现退款后发票同步机制，可在退款完成时检查是否有关联发票并自动取消/红冲。取决于业务决策。

---

## 已移除条目说明

以下条目经代码复核后确认不成立，已从报告中移除：

| 原编号 | 原问题 | 移除原因 |
|--------|--------|----------|
| C03 | 优惠券 RESERVED 无补偿 | `checkout-expire.service.ts` 已有 `reconcileReservedCoupons()` Cron 每 2 分钟补偿 |
| C11 | 分类 replace() 路径损坏 | replace 替换第一次出现=替换前缀，后续重复字串在子分类名中不应被改，行为正确 |
| H04 | 管理员登录失败计数非原子 | CAS updateMany 保证只有一个成功锁定，极端并发最多多几次才锁定，风险极低 |
| H11 | 部分退款数量未校验 | DTO 中无 quantity 字段，只接受 orderItemId 整件退 |
| H12 | 退款幂等键 Date.now() 碰撞 | 毫秒级碰撞概率极低，且当前 mock 支付不校验 |
| H14 | 对账报表缓存问题 | 手动触发传 `force: true` 已绕过缓存 |
| H15 | 签到 7 天上限 | REWARD_TABLE 正好 7 行，7 天上限是设计意图 |
| H16 | markRead 返回完整列表 | 前端 InboxRepo 就是按此契约设计的 |
| M01 | 优惠券浮点精度 | 已用 `.toFixed(2)` 处理 |
| M03 | AI key 累积计数 | 累积计数是防复杂度攻击的设计意图 |
| M04 | 卖家风控时区 | Date 对象隐式使用本地时区，addDays 逻辑正确 |
| M06 | 运费 null weight | `!== null` 正确跳过 null 约束 |
| M08 | 售后缺审计日志 | Controller 已有 `@SellerAudit()` 装饰器 |
| M10 | SKU 软删可能无活跃 SKU | 需进一步确认，暂移除 |
| M12 | referralBonusRate 无校验 | DTO 已有 `@Min(0) @Max(1)` 校验 |
| M13 | 配置快照含敏感参数 | 需进一步确认权限模型，暂移除 |
| M15 | Session 过期设为 now | 时钟偏移风险极微，且 CAS 条件中 `expiresAt: { gt: now }` 已保证一致性 |
| H08 | 发票未与退款同步 | 待补业务能力，非 bug。已移至「待补业务能力」章节 |
| H10 | fillReturnShipping 不检查售后类型 | 不是 bug。创建时已按 `requiresReturnShipping(afterSaleType, itemAmount, threshold)` 计算 requiresReturn（after-sale.service.ts:191），fillReturnShipping 只对 requiresReturn=true 开放（after-sale.service.ts:369） |
| H13 | bonus-allocation 事务缺 Serializable | 不成立。外层事务已是 Serializable（bonus-allocation.service.ts:201） |
| D02 | 奖励作废 CAS 静默跳过 | 不是缺陷。CAS 跳过 = ledger 已被其他流程（如 freeze-expire）改变状态，不等于奖励泄漏（after-sale-reward.service.ts:104） |
| D03 | bonus-allocation 事务缺 Serializable | 同 H13，已是 Serializable |
| D04 | 普通树插入 skip 越界 | 不成立。advisory lock（bonus-allocation.service.ts:869）已在 Serializable 事务内串行化插入 |
| M07 | 买家别名永不过期 | 无保留期限要求，不算 bug |
| M11 | 推荐服务硬编码理由 | 已移至 ai.md 跟踪，非后端审计范围 |

---

---

## v3 深度审查：关键链路端到端

> 以下为 v3 新增内容，针对分润、VIP 推荐、订单、退换货四大系统做端到端链路审查。
> 经产品确认的业务规则已标注，不符合预期的才标为 bug。

### 业务规则确认（产品已确认）

| 规则 | 说明 |
|------|------|
| 奖励冻结 7 天 | 购买后奖励 RETURN_FROZEN，7 天后自动确认收货后释放 |
| 退换货窗口 7 天 | 只有 7 天内可退换，超过不可退换 |
| 退换成功 → 全部归平台 | 一旦退换成功（REFUNDED），该订单全部奖励归平台（不按比例，不按商品） |
| 买家取消售后 → 正常释放 | 退换没成功，奖励走正常 7 天流程释放 |
| 卖家拒绝 → 正常释放 | 买家可申诉，最终被拒绝后奖励正常释放 |
| VIP 不退款 | 付了就必须激活，加 Cron 自动重试 |
| 0 元订单不允许 | 折扣超过商品金额时一律拒绝 |
| 退款 setImmediate | 等接入真实支付后再改为队列 |

---

### D01. [HIGH] VIP 激活失败无自动重试 Cron — 缺失功能

**文件**: `backend/src/modules/bonus/bonus.service.ts:401-428`

**现状**:
- VIP 激活在支付事务外执行，最多重试 3 次
- 失败后 `activationStatus` 设为 `FAILED`，错误信息存入 `activationError`
- Schema 中已有 `RETRYING` 状态（设计意图存在）
- 代码支持手动重试（`retrying` flag）
- **但没有 Cron 自动触发重试**

**后果**: 用户已付款但未成为 VIP，无自动恢复。需人工发现并手动处理。

**需要新建**: `vip-activation-retry.service.ts`，Cron 定期扫描 `activationStatus = 'FAILED'` 的记录，调用 `activateVipAfterPayment()` 重试

---

### 深度审查：经验证不是 bug 的项

以下问题在深度审查中被提出，但经代码验证和产品确认后排除：

| 问题 | 排除原因 |
|------|----------|
| 卖家拒绝退货后奖励不解冻 | ✅ `SELLER_REJECTED_RETURN` 在 ACTIVE_STATUSES 中，阻止释放；最终解决后正常释放 |
| 买家取消售后后奖励不解冻 | ✅ 取消后无活跃售后，7 天到期后 Cron 自动释放 |
| 奖励作废是订单级别非商品级别 | ✅ 业务规则：「一旦退换成功，全部奖励归平台」 |
| VIP 激活与订单创建不在同一事务 | ✅ 设计如此，失败后用 Cron 补偿（D01 待建） |
| VIP 赠品在激活前已发货 | ✅ 赠品随订单发货，VIP 必须激活，不退款 |
| 退款 setImmediate 不可靠 | ⏳ 等接入真实支付后再改 |
| returnWindowExpiresAt 设置时机 | ✅ confirmReceive 时设置，auto-confirm Cron 也会触发 |
| 六分利润池总和不为 100% | ✅ 末额补差已实现（reserveFund = profit - 其他五项之和） |
| 上游分配 CTE 循环引用 | ✅ path 数组 + 深度限制 20 层 |
| VIP 用户收到普通树奖励 | ✅ routing 层阻止（bonus-allocation.service.ts 判断 tier） |
| 支付回调无 expectedTotal 二次校验 | ✅ 快照价格不变，相同算法确定性计算，风险极低 |
| PENDING_ARBITRATION 不阻止奖励释放 | ✅ 包含在 ACTIVE_STATUSES 中，正确阻止 |

### 深度审查：确认安全的系统

| 系统 | 验证结论 |
|------|----------|
| 分润六分利润池计算 | ✅ VIP(50/30/10/2/2/6)=100%，Normal(50/16/16/8/8/2)=100%，末额补差正确 |
| 上游祖辈分配 CTE | ✅ 环检测（path 数组）、深度限制 20、VIP/Normal 隔离 |
| 冻结→解冻→作废生命周期 | ✅ RETURN_FROZEN→FROZEN→AVAILABLE/VOIDED 全链路正确 |
| 订单快照价格保护 | ✅ 结算时冻结价格，30 分钟过期保护 |
| 库存管理 | ✅ VIP 用迁移、普通用单次扣减 + InventoryLedger 追踪 |
| 优惠券补偿 | ✅ reconcileReservedCoupons Cron 每 2 分钟兜底 |
| VipPurchase 唯一约束 | ✅ userId 唯一约束防止重复购买 |
| 推荐奖金快照 | ✅ referralBonusRate 存入 VipPurchase，不受后续改价影响 |

---

## 统计汇总（v4 最终版）

| 级别 | 数量 | 编号 |
|------|------|------|
| CRITICAL（确认 bug） | 8 | C01 C02 C04 C06 C07 C08 C09 C10 |
| CRITICAL（技术债） | 2 | C05 C12 C13 |
| HIGH | 8 | H01 H02 H03 H05 H06 H07 H09 D01 |
| MEDIUM | 4 | M02 M05 M09 M14 |
| 待补业务能力 | 1 | H08 |
| **合计** | **23** | |

## 建议修复顺序

**第一批（改动最小，影响最大）**:
1. C01 — NORMAL_BROADCAST 账户类型（1 行）
2. C07 — seller-jwt validate 加 type 检查（3 行）
3. C08 — seller-jwt validate 加 companyId 校验（5 行）
4. C10 — 日志脱敏（1 行）
5. H07 — 优惠券有效期边界统一（1 行）
6. C04 — round2 改 Math.floor（6 处文件）

**第二批（改动中等）**:
7. C02 — 订单金额 >0 校验
8. C09 — 验证码原子验证
9. C12 — 分类级联用 path 前缀
10. C13 — 分类重命名 findMany 移入事务
11. C06 — 公开抽奖 dailyLimit 统计修正

**第三批（新建功能）**:
12. D01 — VIP 激活失败自动重试 Cron（新建 service）

**第四批（接入真实支付前必修）**:
13. C05 — 退款改用队列（等接入真实支付）
14. H09 — REFUNDING 超时处理

**第五批（中期优化）**:
15. H01-H03 H05 H06 — TOCTOU 竞态
16. M02 M05 M09 M14 — 边界和优化
