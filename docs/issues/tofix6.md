# tofix6.md — 移除游客模式，统一认证状态

> 权威来源：游客模式移除 + 购物车本地化 + 抽奖公开化 + 认证二态统一

## 背景

当前系统存在三种用户状态：**未登录**（`isLoggedIn=false`）、**游客**（`isLoggedIn=true, isGuest=true`）、**正式用户**（`isLoggedIn=true, isGuest=false`）。由于 App 启动时 `useGuestInit` 自动创建游客会话，`isLoggedIn` 在运行时几乎永远为 `true`，导致所有用 `!isLoggedIn` 做的登录拦截（购物车结算、抽奖等）**形同虚设**。

### 游客模式存在的问题

| 问题 | 说明 |
|------|------|
| 数据库污染 | 每次 App 安装创建一条 User + AuthIdentity + Session，大量僵尸用户 |
| 合并逻辑脆弱 | `mergeGuestData()` 失败时游客数据留存为孤儿数据 |
| 防刷更弱 | 清除 App 数据即可获得新游客账号+新抽奖次数，比手机号注册更容易绕过 |
| 代码混乱 | `isLoggedIn` / `isGuest` / `isAuthenticated` 三态在前端扩散，已产生多个 bug |
| 复杂度高 | 本可用本地存储解决的问题，引入了服务端游客用户全套生命周期管理 |

### 目标

移除游客模式，简化为**二态系统**：

| 状态 | `isLoggedIn` | 能做什么 |
|------|-------------|----------|
| 未登录 | `false` | 浏览商品、搜索、加购物车（本地）、抽奖、查看溯源 |
| 已登录 | `true` | 所有功能（结算、支付、订单、个人中心、分润、提现等） |

---

## 改动清单

### P0 — 前端：认证状态简化 ✅ 已完成

#### F1. `src/store/useAuthStore.ts` — 移除游客状态 ✅
- 删除 `isGuest` 字段
- 删除 `upgradeFromGuest` 方法
- `setLoggedIn` 不再设置 `isGuest`
- persist `partialize` 移除 `isGuest`
- 只保留 `isLoggedIn: boolean`，语义清晰

#### F2. `src/hooks/useGuestInit.ts` — 删除文件 ✅
- 整个文件删除，不再需要

#### F3. `app/_layout.tsx` — 移除游客初始化 ✅
- 删除 `import { useGuestInit }`
- 删除 `useGuestInit()` 调用
- 删除相关注释

#### F4. `src/repos/AuthRepo.ts` — 移除游客相关接口 ✅
- 删除 `createGuestSession` 方法
- `loginWithPhone` / `loginWithEmail` 移除 `guestUserId` 参数
- `registerWithPhone` / `registerWithEmail` 移除 `guestUserId` 参数

#### F5. `src/components/overlay/AuthModal.tsx` — 移除游客合并逻辑 ✅
- 删除 `const guestUserId = authState.isGuest ? authState.userId : undefined`
- login/register 调用不再传 `guestUserId`
- 移除 `useAuthStore` 导入（不再需要读取游客状态）

#### 附加. `src/types/domain/Auth.ts` — 移除 guest 登录方式 ✅
- `LoginMethod` 从 `'phone' | 'email' | 'wechat' | 'guest'` 改为 `'phone' | 'email' | 'wechat'`

#### 附加. `src/repos/http/ApiClient.ts` — 移除游客 Session 重建 ✅
- 401 处理器中移除游客 Session 自动重建逻辑

### P0 — 前端：购物车本地化 ✅ 已完成

#### F6. `src/store/useCartStore.ts` — 双模式购物车 ✅
- 使用 Zustand persist + AsyncStorage 持久化
- 未登录：所有操作纯本地，不调用 CartRepo API
- 已登录：乐观更新 + 服务端同步（原有逻辑）
- 新增 `syncLocalCartToServer()` 方法，登录后合并本地购物车到服务端

#### F7. `src/repos/CartRepo.ts` — 新增合并接口 ✅
- 新增 `mergeItems()` 方法
- 调用 `POST /api/v1/cart/merge`

### P0 — 前端：页面修复 ✅ 已完成

#### F8. `app/cart.tsx` — 结算登录拦截 ✅
- `syncFromServer()` 仅在 `isLoggedIn` 时调用（加入依赖数组，登录后自动重新同步）
- AuthModal 修复 `visible` → `open` prop
- AuthModal 新增 `onSuccess` 回调：登录后调用 `syncLocalCartToServer()`

#### F9. `app/(tabs)/me.tsx` — 简化为二态 ✅
- 删除 `isGuest`、`upgradeFromGuest` 引用
- `isAuthed` 直接等价 `isLoggedIn`
- 三段式渲染合并为二段式（未登录/已登录）
- 游客卡片 UI 和 `guestAvatar` 样式删除
- AuthModal `onSuccess` 简化为只调 `setLoggedIn`

#### F10. `app/settings.tsx` — 退出登录按钮 ✅
- 无需改动，`isLoggedIn` 语义已正确

#### F11. `app/(tabs)/home.tsx` — 抽奖按钮显示 ✅
- 移除未使用的 `isLoggedIn` / `useAuthStore` 导入
- 抽奖状态查询无 auth gate，未登录用户可见抽奖按钮

#### F12. `app/lottery.tsx` — 未登录可抽奖 ✅
- 移除 `!isLoggedIn` 抽奖拦截
- 移除 AuthModal（不再需要登录才能抽奖）
- `syncFromServer` 仅在 `isLoggedIn` 时执行

### P0 — 前端：设备指纹 + LotteryRepo ✅ 已完成

#### F13. `src/utils/deviceFingerprint.ts` — 提取设备指纹工具 ✅
- 从已删除的 `useGuestInit.ts` 中提取指纹生成/读取逻辑
- 导出 `getDeviceFingerprint(): Promise<string>`
- 使用 SecureStore 持久化 UUID

#### F14. `src/repos/LotteryRepo.ts` — 适配公开接口 ✅
- 未登录时调用 `/lottery/public/draw`（传 `deviceFingerprint`）
- 未登录时调用 `/lottery/public/today?fp=`
- 已登录时调用原有需认证端点

---

### P1 — 后端：抽奖公开化 ✅ 已完成

#### B1. `backend/src/modules/lottery/lottery.controller.ts` + `lottery.service.ts` — 公开抽奖端点

**新增端点：** `POST /api/v1/lottery/public/draw`，标记 `@Public()`

**新增 DTO：** `PublicDrawDto`
- `deviceFingerprint: string`（必填，`@IsString()` + `@Length(32, 128)`）

**Service 新增方法：** `publicDraw(fingerprint: string)`

**流程：**
1. **双重限流**（fingerprint + IP）：
   - `RedisCoordinatorService.consumeFixedWindow('lottery:fp:{fingerprint}:{yyyy-MM-dd}', 1, 86400)` — 每设备每日 1 次
   - `RedisCoordinatorService.consumeFixedWindow('lottery:ip:{clientIp}:{yyyy-MM-dd}', 50, 86400)` — 每 IP 每日 50 次
   - `RedisCoordinatorService.consumeFixedWindow('lottery:ip:{clientIp}:min', 5, 60)` — 每 IP 每分钟 5 次
2. **Redis 不可用时直接拒绝**（`throw BadRequestException('抽奖服务暂不可用')`），不做无限流回退
3. 获取活跃奖品列表，校验概率总和
4. 概率加权随机选择
5. 中奖时：
   - CAS 递增 `wonCount`（库存控制，Serializable 事务）
   - **不创建 `LotteryRecord`**（无 userId）
   - **不加入服务端购物车**（无 userId）
   - 生成签名令牌 `claimToken`（HMAC-SHA256），编码 `fingerprint + prizeId + drawDate`
   - 将 `claimToken` 哈希写入 Redis（`lottery:claim:{hash}` TTL=24h）防重放
   - 返回 `{ result, prize, claimToken }`
6. 未中奖时：返回 `{ result: 'NO_PRIZE' }`

**结构化日志：** 每次公开抽奖记录 `Logger.log({ action: 'public_draw', fingerprint: hash(fp), ip, result, prizeId?, rateLimitHit? })`，限流拒绝记录 `Logger.warn({ action: 'public_draw_rejected', reason: 'rate_limit', limitType, fingerprint: hash(fp), ip })`。

**claimToken 生成逻辑：**
```
payload = JSON.stringify({ fp: fingerprint, prizeId, drawDate, ts: Date.now() })
signature = HMAC-SHA256(payload, LOTTERY_CLAIM_SECRET)
claimToken = base64url(payload) + '.' + base64url(signature)
```
- `LOTTERY_CLAIM_SECRET` 从环境变量读取，**生产环境必填，缺失则启动报错退出，不回退到 `JWT_SECRET`**
- claimToken 在前端随奖品数据存入本地购物车
- **Redis 中与 claimToken 关联存储奖品元数据**：`lottery:claim:{hash}` 的 value 为 `JSON.stringify({ prizeId, prizeType, originalPrice })`，合并时从 Redis 反查，不信任前端传入的 prizeInfo

#### B2. `backend/src/modules/lottery/lottery.controller.ts` + `lottery.service.ts` — 公开状态查询

**新增端点：** `GET /api/v1/lottery/public/today`，标记 `@Public()`

**Query 参数：** `fp: string`（设备指纹）

**Service 新增方法：** `getPublicTodayStatus(fingerprint: string)`

**流程：**
1. 查 Redis key `lottery:fp:{fingerprint}:{yyyy-MM-dd}` 的计数（**时区统一使用 `Asia/Shanghai` UTC+8**）
2. Redis 不可用时返回默认值 `{ hasDrawn: false, remainingDraws: 1 }`（允许显示按钮，实际抽奖时再拒绝）
3. 返回 `{ hasDrawn, remainingDraws }`

**注意：** 现有 `GET /lottery/today`（已登录端点）不改动，继续为登录用户提供完整记录。

---

### P1 — 后端：购物车合并接口 ✅ 已完成

#### B3. `backend/src/modules/cart/cart.controller.ts` + `cart.service.ts` + `cart.dto.ts` — 新增合并端点

**新增端点：** `POST /api/v1/cart/merge`（需登录，`@CurrentUser`）

**幂等性：** 请求头 `Idempotency-Key: string`（客户端生成 UUID），服务端 Redis 缓存 `cart:merge:idempotency:{key}` TTL=60s，重复请求直接返回首次结果，防止网络重试导致重复消耗 claimToken。

**新增 DTO：** `MergeCartDto`
```typescript
class MergeCartItemDto {
  @IsString()
  skuId: string;

  @IsInt() @Min(1)
  quantity: number;

  @IsOptional() @IsBoolean()
  isPrize?: boolean;

  @IsOptional() @IsString()
  claimToken?: string;          // B1 签发的签名令牌（奖品项必填）
}

class MergeCartDto {
  @ValidateNested({ each: true })
  @Type(() => MergeCartItemDto)
  items: MergeCartItemDto[];
}
```

> **注意：** 相比原计划，`MergeCartPrizeInfoDto` 已删除。奖品元数据（`prizeType`、`originalPrice`、`prizeRecordId`）**不从前端传入**，而是通过 claimToken 验证后从 Redis 存储的奖品元数据 + 数据库 `LotteryPrize` 表反查获取。前端传入的 prizeInfo 字段将被完全忽略。

**Service 新增方法：** `mergeItems(userId: string, items: MergeCartItemDto[], idempotencyKey?: string)`

**合并规则：**
1. **普通商品**（`isPrize` 为 false 或未设置）：
   - 同 SKU 数量相加（复用现有 `addItem` 逻辑的事务保护）
   - 新 SKU 直接添加
   - 验证 SKU 存在且有货

2. **奖品商品**（`isPrize: true`）：
   - 验证 `claimToken` 签名合法（HMAC 校验）
   - 验证 claimToken 中的 `drawDate` 为今日或昨日（**时区统一 UTC+8 `Asia/Shanghai`**，允许跨零点合并）
   - **claimToken 两阶段消费**（防止"Redis 已删 token 但 DB 事务失败"导致奖品丢失）：
     1. **Phase A — 锁定**：Lua 脚本原子 CAS `lottery:claim:{hash}` 状态从 `valid` → `pending`（SETNX 失败则拒绝）
     2. **Phase B — DB 事务**（Serializable）：
        - 从 Redis `lottery:claim:{hash}` value 中读取 `{ prizeId, prizeType, originalPrice }`（**不信任前端**）
        - 验证 `prizeId` 对应有效的 `LotteryPrize` 记录
        - 补建 `LotteryRecord`（`userId`, `prizeId`, `drawDate`, `result: 'WON'`, `status: 'IN_CART'`）
        - 创建 `CartItem`（`isPrize: true`, `prizeRecordId`, 设置过期时间等）
     3. **Phase C — 确认/回滚**：
        - DB 成功 → Redis 删除 `lottery:claim:{hash}`（或标记 `consumed`）
        - DB 失败 → Redis CAS `pending` → `valid`（回滚，用户可重试）
   - **补偿机制**：定时任务（或启动时）扫描 `pending` 超过 5 分钟的 token，回滚为 `valid`

3. 返回合并后的完整 `ServerCart`（调用 `getCart(userId)`）

**结构化日志：** 合并操作记录 `Logger.log({ action: 'cart_merge', userId, itemCount, prizeCount, claimTokenStatus, idempotencyKey })`，拒绝操作记录 `Logger.warn({ action: 'cart_merge_rejected', reason, claimTokenHash, userId })`。

**LotteryModule 依赖：** `CartModule` 无需导入 `LotteryModule`，claimToken 验证逻辑放在 `CartService` 内部（直接读 `LotteryPrize` 表 + Redis）。需要注入 `RedisCoordinatorService`（已全局可用）。

---

### P2 — 后端：删除游客相关代码 ✅ 已完成

#### B4. `backend/src/modules/auth/auth.service.ts` — 删除游客功能
- 删除 `createGuestSession()` 方法
- 删除 `mergeGuestData()` 方法
- `login()` 方法移除 `if (dto.guestUserId)` 块
- `register()` 方法移除 `if (dto.guestUserId)` 块

#### B5. `backend/src/modules/auth/auth.controller.ts` + DTO — 删除游客端点
- 删除 `POST /auth/guest` 端点
- 删除 `CreateGuestDto` 导入和文件
- `login.dto.ts` 删除 `guestUserId` 字段
- `register.dto.ts` 删除 `guestUserId` 字段
- **上线后兼容说明**：当前处于开发阶段，无已发布客户端版本，直接删除即可。若已上线，需保留 `POST /auth/guest` 端点返回 `410 Gone + { code: 'GUEST_DEPRECATED', message: '请升级到最新版本' }` 作为过渡期兼容（至少保留一个发版周期）。

#### B6. 数据清理（可选，上线后执行） ✅
- `GuestCleanupService` 实现 dry-run + execute 双模式
- 管理后台 API：`GET /admin/app-users/guest-cleanup/preview` + `POST /admin/app-users/guest-cleanup/execute`
- HC-8 全部满足：
  1. **dry-run 预览**：返回可清理数量、跳过数量（有订单/企业关联的不删）
  2. **分批删除**：100 条/批，间隔 1 秒
  3. **可回滚日志**：execute 模式返回 `exportedUsers` JSON（调用方保存）
  4. **关联数据处理**：先清理无 Cascade 的关联表（LoginEvent/MemberProfile/RewardAccount 等），再删 User 触发 Cascade
- `AuthProvider.GUEST` 枚举标记 @deprecated，清理完毕后移除

---

### P2 — 前端：适配 claimToken ✅ 已完成

#### F15. `src/repos/LotteryRepo.ts` — 返回 claimToken ✅
- `draw` 方法的返回类型 `DrawResult` 新增 `claimToken?: string` 字段
- 未登录时 `publicDraw` 响应中提取 `claimToken` 并透传

#### F16. `src/store/useCartStore.ts` — 本地购物车存储 claimToken ✅
- `CartItem` 类型新增 `claimToken?: string` 字段
- 未登录中奖时，奖品加入本地购物车时带上 `claimToken`
- `syncLocalCartToServer()` 合并时将 `claimToken` 传给 `POST /cart/merge`

#### F17. `src/repos/CartRepo.ts` — mergeItems 传 claimToken + 幂等键 ✅
- `mergeItems` 方法的参数类型简化：奖品项只传 `claimToken`，移除 `prizeType`/`originalPrice`/`prizeRecordId`（HC-1）
- 请求头添加 `Idempotency-Key: uuid()`（HC-3），防止网络重试重复消耗 token
- `ApiClient.post` 扩展支持 `options.headers` 参数传递额外请求头

#### F18. `app/lottery.tsx` — 中奖存 claimToken ✅
- `handleCloseResult` 中，未登录中奖时通过 `useCartStore.setState` 将奖品+claimToken 存入本地购物车
- 已登录时仍走 `syncFromServer()` 同步服务端数据

---

## Phase 3-5 硬约束

> 以下 8 条为后端实现的强制要求，违反任一条即为阻塞性问题。

| # | 约束 | 说明 | 关联 |
|---|------|------|------|
| HC-1 | **不信任前端 prizeInfo** | B3 合并奖品时，`prizeType`/`originalPrice`/`prizeRecordId` 只从 claimToken + Redis 存储 + DB 反查获取，前端传入的字段全部忽略 | B1, B3 |
| HC-2 | **claimToken 两阶段消费** | `valid → pending → consumed/valid`，避免"Redis 已删 token 但 DB 事务失败"导致用户奖品不可恢复丢失。stuck pending 超 5 分钟自动回滚 | B3 |
| HC-3 | **cart/merge 幂等** | `Idempotency-Key` 请求头 + Redis 缓存（TTL=60s），网络重试不重复消耗 token | B3, F17 |
| HC-4 | **时区统一 UTC+8** | `drawDate` 生成、today 查询、claimToken 校验全部使用 `Asia/Shanghai` 时区，禁止混用 UTC | B1, B2, B3 |
| HC-5 | **fingerprint + IP 双限流** | 公开抽奖同时检查 fingerprint（每日 1 次）和 IP（每分钟 5 次 + 每日 50 次），单维度不足以防刷 | B1 |
| HC-6 | **LOTTERY_CLAIM_SECRET 必填** | 生产环境缺失此环境变量时启动直接报错退出（`throw Error`），**不回退到 `JWT_SECRET`** | B1, B3 |
| HC-7 | **结构化日志** | 公开抽奖和 merge 操作打结构化日志（拒绝原因、token 状态、限流命中），方便上线后排查 | B1, B3 |
| HC-8 | **B6 数据清理安全执行** | dry-run 确认 → 分批删除（100 条/批） → 可回滚日志（JSON 导出保留 30 天） → 级联处理关联表 | B6 |

---

## 执行顺序

```
Phase 1（前端认证状态 + 购物车本地化）✅ 已完成
  F1 → F2 → F3 → F4 → F5  （认证状态简化）
  F6 → F7                   （购物车双模式）
  F13                       （设备指纹工具）

Phase 2（前端页面修复）✅ 已完成
  F8 → F9 → F10 → F11 → F12  （各页面适配）
  F14                          （LotteryRepo 适配）

Phase 3（后端）✅ 已完成
  B1 → B2                   （抽奖公开化 + claimToken 签发）
  B3                         （购物车合并接口 + claimToken 验证）
  B4 → B5                   （游客代码删除）

Phase 4（前端适配 claimToken）✅ 已完成
  F15 → F16 → F17 → F18     （claimToken 存储与传递）

Phase 5（清理）✅ 已完成
  B6                         （GuestCleanupService + 管理后台 API）
```

---

## 风险点

| 风险 | 应对 |
|------|------|
| 本地购物车数据丢失（用户卸载 App） | 预期行为，未登录的数据不保证持久性 |
| 登录合并冲突（本地和服务端有同 SKU） | 数量相加，服务端为准 |
| 抽奖防刷（设备指纹可伪造） | fingerprint + IP 双重限流（HC-5），比游客模式更安全（无法获得真实 JWT） |
| 奖品过期（本地无服务端定时清理） | 前端在购物车页面检查 `expiresAt`，过期项标灰不可结算 |
| Redis 不可用时公开抽奖不可用 | 直接拒绝，返回明确错误信息。已登录抽奖不受影响（走数据库） |
| 公开抽奖中奖伪造 | claimToken HMAC 签名 + Redis 一次性消费 + 奖品数据服务端反查（HC-1），前端无法伪造 |
| claimToken 过期（用户中奖后隔天才登录） | 允许 drawDate 为今日或昨日（UTC+8，HC-4）；Redis TTL=24h 后 claim 失效，奖品作废 |
| claimToken 消费后 DB 失败（奖品丢失） | 两阶段消费（HC-2）：`valid→pending→consumed`，DB 失败回滚为 `valid`，用户可重试 |
| merge 网络重试重复消耗 token | Idempotency-Key 幂等保护（HC-3），60s 内相同 key 返回首次结果 |
| 跨零点时区不一致 | 所有日期比较统一 `Asia/Shanghai` UTC+8（HC-4） |

## 建议补充（上线前完成）

- **e2e 测试**：未登录抽奖、token 篡改拒绝、token 重放拒绝、跨零点 claim、登录后 merge 幂等重试
- **监控告警**：claimToken 验证失败率 > 5% 时告警（可能遭受攻击）、merge 幂等命中率监控
