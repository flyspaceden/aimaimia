# tofix7.md — 匿名抽奖奖品落本地购物车与账号维度认领修复计划

> 基于 2026-03-06 当前代码审查结果整理。
> 本文档只记录问题与修复计划，**本轮不改代码**。
> 权威业务口径：未登录可抽奖；未登录中奖后奖品直接进入本地购物车；结算必须登录；登录后服务端检查该账号今日是否已抽奖，若已抽奖则匿名中奖奖品不合并到服务端购物车。

---

## 目标行为

### 1. 已登录抽奖

- 抽奖次数按 `userId + drawDate` 控制
- 中奖后奖品自动加入服务端购物车
- 抽奖状态按账号维度展示

### 2. 未登录抽奖

- 用户可直接抽奖
- 抽奖次数按 `deviceFingerprint + drawDate` 控制
- 中奖后奖品直接加入本地购物车
- 本地奖品项必须携带 `claimToken`
- 本地奖品语义为“待登录确认领取”，不是“已正式到账”

### 3. 退出登录

- 清空 React Query 缓存，避免继续展示已登录数据
- 清空服务端购物车视图，不残留已登录购物车商品
- 抽奖状态切回匿名维度重新查询
- 不能持续触发 401

### 4. 未登录 → 登录

- 本地普通商品合并到服务端购物车
- 本地匿名中奖奖品带 `claimToken` 交给后端验证
- 后端按**登录用户今日抽奖状态**决定是否认领匿名奖品
- 若该用户今日已抽奖，则匿名中奖奖品拒绝合并并从本地购物车移除
- 若该用户今日未抽奖，则允许认领，并同时占用该账号今日抽奖资格

---

## 当前代码与需求的主要差距

## P0 — 阻断问题

### P0-1. 匿名中奖不是“立即入本地购物车”，而是“关闭结果弹窗时才尝试写入”

**现状**

- `app/lottery.tsx` 中匿名中奖写本地购物车逻辑挂在 `handleCloseResult()` 内
- 并且只有 `closingResult.claimToken` 存在时才执行写入

**问题**

- 这不符合“中奖后奖品直接进入本地购物车”的需求
- 如果结果弹窗关闭流程未完整执行，奖品不会落本地购物车
- 如果后端异常返回 `WON` 但未带 `claimToken`，当前逻辑会静默跳过，不报错、不落车

**涉及文件**

- `app/lottery.tsx`

**修复方向**

1. 把匿名中奖落本地购物车的时机前移到 `LotteryRepo.draw()` 成功返回后的主流程
2. `WON && !claimToken` 视为异常状态，必须显示错误并拒绝落车
3. `handleCloseResult()` 只负责关闭 UI、刷新状态，不再承担“真正发奖”的业务责任

---

### P0-2. 后端 merge 校验规则与最新业务口径不一致

**现状**

- `backend/src/modules/cart/cart.service.ts` 在合并匿名奖品时，校验的是 `claimToken` 中的 `payload.drawDate`
- 当前逻辑限制的是“该账号在匿名中奖发生那一天是否已抽奖”

**目标需求**

- 登录认领奖品时，检查的是“**这个登录账号今天是否已经抽奖**”
- 如果该账号**今天**已经抽奖，则匿名奖品不应合并

**问题**

- 现在实现的是“抽奖发生日归属”
- 需求要的是“登录认领时按账号今日状态裁决”
- 两者在跨零点场景下结果不同

**典型风险**

- 用户 `3 月 6 日` 匿名中奖
- 用户 `3 月 7 日` 登录，且 `3 月 7 日` 已通过账号抽奖
- 当前代码可能仍允许领取 `3 月 6 日` 的匿名奖品
- 这与“账号今日已经抽奖则匿名奖品不合并”的新规则不一致

**涉及文件**

- `backend/src/modules/cart/cart.service.ts`

**修复方向**

1. 明确服务端裁决规则以“登录时当前业务日”为准
2. merge 奖品前查询该 `userId` 在“当前业务日”是否已抽奖
3. 若已抽奖：
   - 拒绝认领奖品
   - 返回结构化失败原因，供前端移除匿名奖品并提示用户
4. 若未抽奖：
   - 允许认领奖品
   - 在服务端补建该账号今日抽奖记录，正式占用今日抽奖资格

**备注**

- 此项是本轮修复中最重要的规则改动，必须先锁定业务口径再改代码

---

### P0-3. 退出登录后的 401 风险仍未彻底清除

**现状**

- 显式点击退出登录时，`settings` / `account-security` 页面会调用 `queryClient.clear()`
- 但很多受保护页面的 React Query 查询仍未加 `enabled: isLoggedIn`
- 自动 401 失效登出时，`ApiClient` 会执行 `logout()`，但不会统一清 React Query 缓存

**问题**

- 用户退出登录后，若仍有页面继续请求 `/me`、`/orders`、`/inbox`、`/wallet` 等受保护接口，会继续打出 401
- `logout()` 当前还会清空购物车，可能把匿名抽中的本地奖品也一起清掉

**高风险页面**

- `app/(tabs)/me.tsx`
- `app/me/profile.tsx`
- `app/me/appearance.tsx`
- `app/me/vip.tsx`
- `app/me/wallet.tsx`
- `app/inbox/index.tsx`
- `app/orders/index.tsx`

**涉及文件**

- `src/repos/http/ApiClient.ts`
- `src/store/useAuthStore.ts`
- 上述相关页面

**修复方向**

1. 所有受保护 query 统一加 `enabled: isLoggedIn`
2. 抽离统一的 `logoutAndClearClientState()` 入口
3. 显式退出登录与 401 自动失效登出都走同一套清理逻辑：
   - auth store
   - React Query cache
   - 服务端购物车本地视图
   - 必要的状态回刷
4. `logout()` 不能再无差别清掉匿名奖品本地购物车，需要区分“服务端购物车残留”和“匿名本地奖品”

---

## P1 — 重要问题

### P1-1. 登录成功与购物车合并不是一个原子流程

**现状**

- `AuthModal` 在 `onSuccess` 调用后立即关闭弹窗并展示“登录成功”
- 调用方才异步执行 `syncLocalCartToServer()`

**问题**

- “登录成功”与“奖品合并成功”被拆开了
- 若 merge 失败，用户先看到登录成功，再看到后续警告，时序混乱

**涉及文件**

- `src/components/overlay/AuthModal.tsx`
- `app/cart.tsx`
- `app/(tabs)/me.tsx`

**修复方向**

1. 登录成功后由外层串行执行：
   - `setLoggedIn`
   - `syncLocalCartToServer`
   - 刷新账号维度抽奖状态 / 购物车
   - 最后再关闭弹窗或给成功提示
2. merge 返回奖品失败原因时，前端应做针对性处理，而不是只给通用 warning

---

### P1-2. 匿名奖品的 UI 语义仍然写成“已发放到账户”

**现状**

- 抽奖结果页文案仍是“奖品已自动发放到您的账户”

**问题**

- 这只适用于已登录中奖
- 对未登录中奖来说，真实语义应是“已加入本地购物车，登录后确认领取”
- 否则后续因账号今日已抽奖而认领失败时，用户会认为系统吞奖

**涉及文件**

- `app/lottery.tsx`

**修复方向**

1. 已登录中奖与未登录中奖使用不同文案
2. 本地购物车中的匿名奖品增加状态标签，例如：
   - `待登录确认`
   - `登录后领取`
3. merge 失败时给出明确原因提示，而不是笼统“请重新抽奖领取”

---

### P1-3. 匿名奖品 merge 失败后的前端收尾逻辑不完整

**现状**

- `syncLocalCartToServer()` 返回 `mergeErrors`
- 页面只做了 warning 提示
- 没有建立“哪些匿名奖品应从本地移除、哪些普通商品已合并成功”的精细化处理

**问题**

- 若匿名奖品因“账号今日已抽奖”被拒绝，前端本地购物车可能继续保留无效奖品
- 用户会反复看到一个永远无法结算的本地奖品项

**涉及文件**

- `src/store/useCartStore.ts`
- `app/cart.tsx`
- `app/(tabs)/me.tsx`

**修复方向**

1. 让 merge 接口返回结构化的每项结果，而不只是字符串数组
2. 前端按结果分类处理：
   - 普通商品成功合并
   - 匿名奖品成功认领
   - 匿名奖品因账号今日已抽奖而拒绝
   - 匿名奖品因 token 失效而拒绝
3. 对被拒绝的匿名奖品执行本地移除

---

## P2 — 一致性与边界问题

### P2-1. 前端跨零点刷新使用设备本地时区，后端按 UTC+8 计算抽奖日

**现状**

- 首页零点定时器按设备本地时间计算“明天 0 点”
- 后端 `lottery` / `cart merge` 按 UTC+8 业务日切桶

**问题**

- 非中国时区设备会出现“按钮已刷新 / 服务端未刷新”或“服务端已刷新 / 前端未刷新”的不一致

**涉及文件**

- `app/(tabs)/home.tsx`
- `backend/src/modules/lottery/lottery.service.ts`
- `backend/src/modules/cart/cart.service.ts`

**修复方向**

1. 前端不再自行假设本地午夜就是业务日切点
2. 以服务端查询结果为准
3. 定时刷新若保留，也要按 UTC+8 业务时区计算

---

### P2-2. “设备指纹”当前只是本地持久化 UUID，不是真正设备指纹

**现状**

- 当前实现是 SecureStore / localStorage 中持久化一个 UUID

**问题**

- 功能上可以支撑匿名维度状态
- 但安全强度有限，清缓存、重装、换浏览器即可获得新身份

**涉及文件**

- `src/utils/deviceFingerprint.ts`

**修复方向**

1. 接受其作为“安装实例 ID”的真实语义，不再误称为强设备指纹
2. 继续依赖 IP 分钟级 / 天级限流做补强
3. 低价值奖池允许匿名；高价值奖品建议仅对登录用户开放

---

### P2-3. Mock 抽奖链路与真实链路不一致，容易误判问题是否已修复

**现状**

- Mock 模式下抽奖中奖会模拟“服务端自动加车”
- 但匿名奖品链路依赖 `claimToken`
- Mock 结果未返回 `claimToken`

**问题**

- 匿名抽奖测试在 Mock 模式下与真实业务模型不一致
- 容易出现“本地测试看到的问题”与“真实 API 下的问题”不一致

**涉及文件**

- `src/repos/http/config.ts`
- `src/repos/LotteryRepo.ts`
- `src/repos/CartRepo.ts`

**修复方向**

1. Mock 模式下也按真实匿名链路返回 `claimToken`
2. 匿名中奖不再模拟“服务端自动加入购物车”
3. Mock 与真实接口契约保持一致

---

## 推荐修复顺序

### Phase A — 先修主链路闭环

1. 匿名中奖立即落本地购物车
2. 服务端 merge 按“登录账号今日是否已抽奖”裁决
3. 匿名奖品成功认领时正式占用账号今日抽奖资格
4. merge 失败返回结构化结果，前端移除无效匿名奖品

### Phase B — 再修认证切换稳定性

1. 所有受保护 query 加 `enabled: isLoggedIn`
2. 统一退出登录 / 401 自动登出清理逻辑
3. 退出后重新按匿名维度拉抽奖状态
4. 避免 401 触发二次清空匿名奖品

### Phase C — 最后修一致性与体验

1. 调整匿名奖品文案和状态标签
2. 登录成功与 merge 完成串成一个完整流程
3. 修正 UTC+8 业务日一致性
4. 对齐 Mock 链路

---

## 建议新增或调整的接口/返回结构

### 1. `POST /cart/merge` 返回结构增强

当前只返回 `mergeErrors?: string[]` 不够用，建议改成结构化结果：

```ts
type MergeResultItem = {
  localKey: string;
  skuId: string;
  isPrize: boolean;
  status: 'MERGED' | 'REJECTED_ALREADY_DRAWN_TODAY' | 'REJECTED_TOKEN_INVALID' | 'REJECTED_TOKEN_EXPIRED';
  message?: string;
};
```

这样前端才能精确清理匿名奖品项。

### 2. `LotteryRepo.draw()` 前端结果需要保证匿名中奖必带 `claimToken`

- `WON && !claimToken` 视为协议错误
- 前端不应再把 `claimToken` 当作可选成功字段

### 3. 匿名奖品本地项建议增加显式标记

例如：

```ts
pendingClaim?: boolean;
claimRejectReason?: string;
```

便于 UI 区分：

- 普通本地商品
- 匿名中奖待认领奖品
- 已失效待清理奖品

---

## 本轮建议直接落地的文件清单（后续改代码时）

### 前端

- `app/lottery.tsx`
- `src/store/useCartStore.ts`
- `src/components/overlay/AuthModal.tsx`
- `app/cart.tsx`
- `app/(tabs)/me.tsx`
- `app/(tabs)/home.tsx`
- `app/me/profile.tsx`
- `app/me/appearance.tsx`
- `app/me/vip.tsx`
- `app/me/wallet.tsx`
- `app/inbox/index.tsx`
- `app/orders/index.tsx`
- `src/repos/LotteryRepo.ts`
- `src/repos/http/ApiClient.ts`
- `src/store/useAuthStore.ts`
- `src/utils/deviceFingerprint.ts`

### 后端

- `backend/src/modules/cart/cart.service.ts`
- `backend/src/modules/cart/cart.controller.ts`
- `backend/src/modules/cart/dto/cart.dto.ts`
- `backend/src/modules/lottery/lottery.service.ts`

---

## 结论

当前代码已经具备以下基础能力：

- 公开抽奖接口
- 设备维度抽奖状态查询
- `claimToken` 签发与验证
- 登录后 `cart/merge` 合并入口

但距离最新业务需求还有三条关键差距：

1. 匿名中奖没有做到“立即入本地购物车”
2. merge 裁决规则仍按 `claimToken.drawDate`，未切换到“登录账号今日抽奖状态”
3. 退出登录和 401 自动失效场景还没有完全做到“无旧数据、无 401、匿名态平滑恢复”

后续改代码时，必须优先修这三条，其他体验和一致性问题再跟进。
