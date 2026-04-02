# 买家 App 前端交互问题清单与修复计划

> **生成日期**: 2026-03-01（v3 修订：2026-03-01，根据代码复核继续排除误判项并补充新问题）
> **审查范围**: 全部 47 个页面 + 23 个 Repo + 3 个 Store
> **状态说明**: ⬜ 待修复 | 🔧 修复中 | ✅ 已修复 | ⏭️ 暂缓 | ❌ 已排除（误判）

---

## 总览

| 严重程度 | 数量 | 说明 |
|---------|------|------|
| **CRITICAL** | 14（排除 C08/C09/C10/C17；C05/C12 降级 MEDIUM） | 影响核心流程、数据正确性、资金安全 |
| **HIGH** | 29（排除 H01/H02/H16；H15 修复方案已修正） | 状态管理缺陷、交互逻辑错误、竞态条件 |
| **MEDIUM** | 42（+M40 从 C05 降级，+M41 新增 401 导航问题，+M42 从 C12 降级） | 性能问题、UX不佳、边界处理不足 |
| **LOW** | 30+ | 代码规范、可访问性、文案细节 |

### 修复优先级排程

| 批次 | 时间 | 内容 |
|------|------|------|
| **P0** | 本周 | 所有 CRITICAL（资金安全 + 核心流程） |
| **P1** | 下周 | HIGH 中的交互保护 + 状态管理 |
| **P2** | 后续 | MEDIUM/LOW + 跨模块共性问题 |

---

## 一、CRITICAL 问题（14项待修复）

### 1.1 结算/支付 — 业务逻辑错误

#### ⬜ C01: 结算页奖品项不应被订单化
- **文件**: `app/checkout.tsx` 行 36-56
- **问题**: `selectedItems` 包含奖品，用户勾选后会被纳入订单。根据业务规则，奖品应自动包含在订单中，不依赖用户勾选。
- **影响**: 违反"奖品不可退"规则；后端 goodsAmount 计算与前端不一致。
- **修复计划**:
  ```
  1. 在 checkout.tsx 中，拆分 selectedItems 为：
     - cartItemsForOrder = selectedItems.filter(item => !item.isPrize && !item.isThresholdGift)
     - autoIncludeItems = allItems.filter(item => item.isPrize || (item.isThresholdGift && !item.isLocked))
     - finalOrderItems = [...cartItemsForOrder, ...autoIncludeItems]
  2. 预结算和下单均使用 finalOrderItems
  3. UI 上明确标注"奖品/赠品将自动包含在订单中"
  ```

#### ⬜ C02: 幂等键每次进入页面重新生成 → 可能重复下单
- **文件**: `app/checkout.tsx` 行 47-48
- **问题**: `idempotencyKeyRef = useRef(...)` 在组件挂载时生成新键。用户前一次支付成功但网络延迟导致前端未收到，重新进入 checkout 会用新幂等键，后端视为新订单。
- **影响**: 重复订单、重复扣款。
- **修复计划**:
  ```
  1. 幂等键基于购物车选中内容的 hash + 用户ID 生成（内容不变则键不变）
  2. 下单成功后清除购物车和幂等键缓存
  3. 进入 checkout 时先查询是否有未完成的 CheckoutSession，有则恢复而非新建
  4. 在 AsyncStorage 中缓存最近一次幂等键，下次进入时尝试恢复
  ```

#### ⬜ C03: skuId 降级为 productId → 多 SKU 场景出错
- **文件**: `app/checkout.tsx` 行 76-88, 135-148
- **问题**: `skuId: item.skuId ?? item.productId`，当 skuId 为空时使用 productId 传给后端，后端无法准确查询 SKU 价格和库存。
- **影响**: 多 SKU 商品价格计算错误、库存判断失败。
- **修复计划**:
  ```
  1. 在 addItem（CartStore）时强制要求 skuId 不为空
  2. checkout 页面构建 orderItems 时校验 skuId，缺失则提示用户"请选择规格"
  3. 后端接口增加 skuId 必填校验，拒绝 productId 作为 skuId
  ```

### 1.2 商品详情 — SKU 与参数问题

#### ⬜ C04: SKU 为空时仍可加入购物车
- **文件**: `app/product/[id].tsx` 行 103-104, 514-586
- **问题**: 当 `skus.length === 0` 时，`activeSkuId` 为 undefined，但"加入购物车"和"立即购买"按钮未禁用，`addItem(product!, 1, activeSkuId, activeSkuPrice)` 传入 undefined。
- **影响**: 购物车中出现无 SKU 商品，结算时后端报错。
- **修复计划**:
  ```
  1. 在 addItem/buyNow 按钮添加前置检查：
     if (!activeSkuId) { show({ message: '请先选择规格', type: 'error' }); return; }
  2. activeSkuPrice 添加降级：activeSkuPrice ?? product.price
  3. SKU 列表为空时（数据异常），按钮显示为禁用状态 + "暂无可选规格"
  ```

#### ⬜ C05: 路由参数 id 数组处理不完整（降级为 MEDIUM → 编号 M40）
- **原判断**: 所有动态路由页面未处理数组 id → 页面崩溃。
- **代码验证修正**: `company/[id].tsx:39` 和 `group/[id].tsx:22` 已用 `Array.isArray` 正确处理。**但以下 4 个页面仅用 `String(id)` 处理**，数组会变成 `"id1,id2"` 字符串（不崩溃，但 API 查询结果错误）：
  - `app/product/[id].tsx` — `String(id)`
  - `app/user/[id].tsx` — `String(id ?? '')`
  - `app/orders/[id].tsx` — `String(id ?? '')`
  - `app/orders/after-sale/[id].tsx` — `String(id ?? '')`
- **降级原因**: 不会导致崩溃，且实际触发概率极低（需特殊深链接场景）。
- **修复计划（MEDIUM 优先级）**: 统一添加 `Array.isArray(id) ? id[0] : id` 处理。

### 1.3 订单流程 — 状态不一致

#### ⬜ C06: isOrderStatus() 漏掉 'canceled' 状态
- **文件**: `app/orders/index.tsx` 行 34-40
- **问题**: 类型守卫函数缺少 `'canceled'`，路由参数传入 `canceled` 时无法正确筛选。
- **影响**: 用户无法从深链接/路由筛选已取消订单。
- **修复计划**:
  ```
  在 isOrderStatus() 中补充 'canceled'：
  value === 'canceled'
  同时对照 OrderStatus 类型定义确保完全覆盖。
  ```

#### ⬜ C07: 确认收货状态判断缺陷
- **文件**: `app/orders/[id].tsx` 行 245
- **问题**: UI 允许 `'delivered'` 状态确认收货，但 `OrderRepo.confirmReceive()` 的 Mock 只接受 `'shipping'`。
- **影响**: 点击"确认收货"返回错误"当前无法确认收货"。
- **修复计划**:
  ```
  方案A（推荐）：后端 confirmReceive 同时接受 shipping + delivered
  方案B：前端 UI 只在 shipping 时显示确认按钮
  选择方案A，因为 delivered 表示已签收但未确认，用户手动确认是合理的。
  同步修改 OrderRepo.confirmReceive() 的 Mock 实现。
  ```

#### ❌ C08: ~~售后申请按钮逻辑不完善~~（已排除）
- **排除原因**: 当前条件 `!order.afterSaleStatus || === 'rejected' || === 'failed'` 已正确拦截了 refunding 等有售后状态的场景。当 `afterSaleStatus = 'refunding'` 时，`!order.afterSaleStatus` 为 false 且不满足后两个条件，按钮不会显示。逻辑虽然表达不够清晰，但结果正确。
- **建议（LOW）**: 可将条件抽取为 `canApplyAfterSale()` 函数提升可读性，但不影响正确性。

### 1.4 认证与安全

#### ❌ C09: ~~AI 聊天页 token 过期未触发自动登出~~（已排除）
- **排除原因**: `ApiClient.ts:147-159` 已全局处理 401：先尝试 refreshToken，失败则调用 `useAuthStore.getState().logout()`。所有通过 ApiClient 发起的请求（包括 AI 聊天）均受此保护。

#### ❌ C10: ~~退出登录后导航/状态清理不完整~~（已排除）
- **排除原因**: `AuthRepo.logout()` 通过 `ApiClient.post()` 调用，而 `ApiClient.request()` 的 catch 块（行 163-171）捕获所有异常并返回 `{ ok: false, error: networkError }`，**永远不会 throw**。因此 `await AuthRepo.logout()` 永远不会抛异常，后续的 `logout()` / `show()` / `router.replace()` 一定会执行。无论网络是否正常，本地清理均可保证。

#### ⬜ C11: 通知设置开关未持久化到后端
- **文件**: `app/notification-settings.tsx` 行 20-39
- **问题**: 通知偏好只存内存，页面关闭后丢失，toast 误导用户"设置已保存"。
- **影响**: 用户每次打开页面开关都重置为默认值。
- **修复计划**:
  ```
  1. 加载时从 AsyncStorage（短期）或后端API（长期）读取设置
  2. 每次 toggle 时同步写入 AsyncStorage + 调用后端 API
  3. API 成功后才显示"设置已保存"
  4. API 失败时回滚 UI 状态并显示错误
  ```

### 1.5 首页 — 定时器与反馈

#### ⏭️ C12: 零点跨越定时器并非内存泄漏（降级为 MEDIUM → 编号 M42）
- **代码复核结论**: `useEffect` 已返回 cleanup（`clearTimeout(timer)`），依赖变化时旧定时器会先清理，不构成“多个定时器并存”的内存泄漏。
- **真实问题**: `lotteryStatus` 变化会导致定时器重复重建，属于可优化项而非 CRITICAL 故障。
- **降级去向**: 见 M42（定时器重建频次优化）。

#### ⬜ C13: feedbackTimer 快速切换 Tab 时未清理
- **文件**: `app/(tabs)/home.tsx` 行 88-89, 132-158
- **问题**: `navigateByIntent` 中创建的 timeout 可能在组件卸载后执行。
- **影响**: 潜在的内存泄漏和 setState on unmounted component 警告。
- **修复计划**:
  ```
  1. 在 navigateByIntent 开头清理旧 timer：
     if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
  2. 在 useEffect cleanup 中也清理
  3. 使用 isMounted ref 防止卸载后 setState
  ```

### 1.6 钱包/提现 — 金额处理

#### ⬜ C14: 提现金额验证不完整
- **文件**: `app/me/withdraw.tsx` 行 34-49
- **问题**:
  - 未验证最低提现限额（UI 说"最低1元"但代码无检查）
  - `parseFloat(NaN)` 和 `parseFloat(0)` 的判断逻辑有误
  - 无浮点精度保护
- **影响**: 用户可能提交非法金额。
- **修复计划**:
  ```
  const num = parseFloat(amount);
  if (isNaN(num) || num < 1) {
    show({ message: '最低提现金额为 1 元', type: 'error' }); return;
  }
  if (num > balance) {
    show({ message: '余额不足', type: 'error' }); return;
  }
  // 精度检查：只允许两位小数
  const rounded = Math.round(num * 100) / 100;
  if (rounded !== num) {
    show({ message: '金额最多两位小数', type: 'error' }); return;
  }
  ```

#### ⬜ C15: 任务完成 + 奖励发放非原子操作
- **文件**: `app/me/tasks.tsx` 行 39-63
- **问题**: `TaskRepo.complete()` 和 `UserRepo.applyRewards()` 是两个独立 API。前者成功后者失败时，任务已标记完成但奖励未发放。
- **影响**: 数据不一致，用户丢失奖励。
- **修复计划**:
  ```
  方案A（推荐）：后端合并为单一接口 TaskRepo.completeAndReward(taskId)
  方案B（前端）：
  1. 两个调用包在一起，第二个失败时尝试回滚第一个
  2. 添加重试机制（最多3次）
  3. 最终失败时记录到本地，下次打开页面时重试
  ```

### 1.7 消息中心

#### ⬜ C16: 已读状态更新可能不同步
- **文件**: `app/inbox/index.tsx` 行 54-63
- **问题**: `markRead()` 失败时 UI 已更新为已读，`unreadCount` 计算基于已刷新数据。
- **影响**: 消息实际未读但显示已读。
- **修复计划**:
  ```
  1. 改用 useMutation 管理 markRead
  2. 乐观更新 + 失败回滚
  3. unreadCount 从服务端获取而非本地计算
  ```

### 1.8 钱包页面

#### ❌ C17: ~~Skeleton 与 FlatList 加载状态冲突~~（已排除）
- **排除原因**: `walletLoading` 为 true 时组件直接 return 主体 Skeleton，不会渲染 FlatList；因此不会与 `ListEmptyComponent` 的 Skeleton 同时出现。

### 1.9 账户安全

#### ⬜ C18: 修改密码成功后未刷新 token
- **文件**: `app/account-security.tsx` 行 49-74
- **问题**: 密码修改成功后只清除本地 state，未重新登录或刷新 token。
- **影响**: 旧 token 继续使用，存在安全隐患。
- **修复计划**:
  ```
  密码修改成功后：
  1. 显示成功提示
  2. 延迟 1.5 秒后调用 logout()
  3. 导航到登录页，提示用户用新密码登录
  ```

### 1.10 Museum 页面

#### ⬜ C19: 无限查询与视图切换导致数据不一致
- **文件**: `app/(tabs)/museum.tsx` 行 52-92, 214-254
- **问题**: 地图视图切回列表时保留旧分页数据；refetch 无限查询不清除已加载页数，可能重复数据。
- **影响**: 商品列表显示旧数据或重复项。
- **修复计划**:
  ```
  切换视图模式时重置查询：
  const handleViewModeChange = (mode: 'list' | 'map') => {
    setViewMode(mode);
    if (mode === 'list') {
      queryClient.resetQueries({ queryKey: ['museum-products'] });
    }
  };
  ```

### 1.11 Profile 加载

#### ⬜ C20: Me 页 Profile 加载失败时关联数据继续加载
- **文件**: `app/(tabs)/me.tsx` 行 63-66, 196-254
- **问题**: profile 加载失败时显示 ErrorState，但下方订单/任务/签到区域继续加载，造成 UI 割裂。重试只刷新 profile 不刷新关联数据。
- **影响**: 用户看到不一致的状态。
- **修复计划**:
  ```
  1. profile 加载失败时，整个页面显示 ErrorState
  2. 重试时刷新所有关键查询：
     await Promise.all([
       refetchProfile(),
       queryClient.invalidateQueries({ queryKey: ['me-tasks'] }),
       queryClient.invalidateQueries({ queryKey: ['me-checkin'] }),
       queryClient.invalidateQueries({ queryKey: ['me-order-counts'] }),
     ]);
  ```

---

## 二、HIGH 问题（29项）

### 2.1 搜索与列表

#### ❌ H01: ~~搜索 queryKey 不含关键词 → 缓存命中错误~~（已排除）
- **排除原因**: 当前实现不是“按关键词请求搜索接口”，而是先拉取基础数据（`ProductRepo.list` / `CompanyRepo.list`），再在前端 `useMemo` 过滤。`queryKey` 固定是有意设计，不会造成关键词级缓存错配。

#### ❌ H02: ~~搜索输入无防抖 → 频繁 API 请求~~（已排除）
- **排除原因**: 输入变化仅触发本地过滤，不会每个字符都请求后端。当前架构下防抖不是必要项（可作为性能优化备选）。

#### ⬜ H03: 订单列表未实现分页
- **文件**: `app/orders/index.tsx` 行 58-66
- **问题**: 大量订单一次性加载，性能差。
- **修复计划**: 改用 `useInfiniteQuery`，实现滚动加载更多。

### 2.2 购物车交互

#### ⬜ H04: 奖品勾选框 UI 误导用户
- **文件**: `app/cart.tsx` 行 251-262
- **问题**: 奖品显示已勾选但无法取消，缺少说明，用户困惑。
- **修复计划**: 奖品使用星星图标（非 checkbox），并显示"奖品·自动包含"标签。

#### ⬜ H05: 批量删除无确认对话框
- **文件**: `app/cart.tsx` 行 106-113
- **问题**: 误触直接删除，不可恢复。
- **修复计划**: 添加 `Alert.alert('确认删除', '确定要删除${count}件商品吗？', [{text:'取消'}, {text:'删除', style:'destructive', onPress:...}])`。

#### ⬜ H06: 清空购物车保留赠品但无提示
- **文件**: `src/store/useCartStore.ts` 行 275-285
- **问题**: 用户点"清空"后仍看到商品（锁定赠品），困惑。
- **修复计划**: 清空后显示 toast "已清空购物车，锁定赠品已保留"。

#### ⬜ H07: syncFromServer 多次并发调用竞态
- **文件**: `src/store/useCartStore.ts` 行 99-126
- **问题**: 快速操作触发多个 syncFromServer，后发先至覆盖状态。
- **修复计划**: 添加版本号（syncVersion++），只应用最新版本的结果。

### 2.3 结算支付

#### ⬜ H08: 奖励门槛用总金额（含奖品）判断
- **文件**: `app/checkout-redpack.tsx` 行 115, 130
- **问题**: `total` 包含奖品金额，与后端 goodsAmount（非奖品金额）不一致。
- **修复计划**: checkout 传递 `nonPrizeTotal` 作为 `orderTotal` 参数。

#### ⬜ H09: 支付超时后未自动跳转订单列表
- **文件**: `app/checkout.tsx` 行 197-220
- **问题**: 超时后用户停在结算页，不知道去哪查看。
- **修复计划**: 超时后 2 秒自动跳转 `router.replace('/orders')`。

#### ⬜ H10: 预结算失败永久禁用提交按钮
- **文件**: `app/checkout.tsx` 行 93-94, 537
- **问题**: 网络暂时故障也永久禁用，无重试入口。
- **修复计划**: 添加"重新校验价格"按钮；提交时若 previewFailed 则自动重新预结算。

### 2.4 订单操作

#### ⬜ H11: 订单详情无轮询/实时更新
- **文件**: `app/orders/[id].tsx` 行 61-73
- **问题**: 订单状态变化需要手动刷新。
- **修复计划**: 添加 `refetchInterval: 10000`（10秒轮询），根据订单状态动态调整（已完成时停止）。

#### ⬜ H12: 取消订单无二次确认
- **文件**: `app/orders/[id].tsx` 行 237-242
- **问题**: 误触直接取消，不可撤销。
- **修复计划**: 添加 Alert 确认对话框。

#### ⬜ H13: 确认收货无防重复点击
- **文件**: `app/orders/[id].tsx` 行 122-132
- **问题**: 快速点击可发送多个请求。
- **修复计划**: 添加 `isConfirming` state + `disabled={isConfirming}`。

#### ⬜ H14: 售后照片上传失败无进度/详细反馈
- **文件**: `app/orders/after-sale/[id].tsx` 行 66-93
- **问题**: 批量上传部分失败时只提示"部分失败"，不知道哪张失败。
- **修复计划**: 添加上传进度条 + 失败图片标记 + 重试按钮。

### 2.5 Tab 导航 / 首页

#### ⬜ H15: AiOrb state 始终为 'idle'（修复方案需重写）
- **文件**: `app/(tabs)/_layout.tsx` 行 40-46
- **问题**: `state={focused ? 'idle' : 'idle'}` 无论焦点状态都是 idle，视觉反馈缺失。
- **注意**: `AiOrbState` 类型为 `'idle' | 'listening' | 'thinking' | 'responding' | 'error'`，没有 `'active'`。
- **修复计划**: 改为 `state={focused ? 'listening' : 'idle'}` 或 `state={focused ? 'responding' : 'idle'}`（需确认哪个状态的动画效果适合作为 Tab 焦点反馈）。也可以在 AiOrb 组件中新增 `'focused'` 状态。

#### ❌ H16: ~~签到后未刷新 profile~~（已排除）
- **排除原因**: `handleCheckIn` 在发放奖励后已执行 `invalidateQueries({ queryKey: ['me-profile'] })`，并调用 `refetchCheckIn()`，核心数据链路已覆盖。

#### ⬜ H17: 下拉刷新与 AI 引导语竞态
- **文件**: `app/(tabs)/home.tsx` 行 120-124
- **问题**: 快速多次下拉触发多个刷新，无防抖。
- **修复计划**: 添加 `isRefreshing` 守卫。

### 2.6 我的模块

#### ⬜ H18: 奖金排队进度条计算反向
- **文件**: `app/me/bonus-queue.tsx` 行 110-123
- **问题**: `(1/position)*100` → position 越大进度越小，但应该表示排队进度。
- **修复计划**: 改为相对值 `Math.max(10, 100 - Math.min(90, position * 2))`，或使用"前方 N 人"文字代替进度条。

#### ⬜ H19: 地址表单验证不足
- **文件**: `app/me/addresses.tsx` 行 69-77
- **问题**: 手机号只检查长度 < 11，无格式正则；无最大长度限制。
- **修复计划**:
  ```
  - 手机号正则：/^1[3-9]\d{9}$/
  - 收货人：2-20 字
  - 详细地址：5-200 字
  - 省市区：非空 + 非特殊字符
  ```

#### ⬜ H20: VIP 升级后树数据不刷新
- **文件**: `app/me/bonus-tree.tsx` 行 97-108
- **问题**: VIP 页面升级后返回树页面，memberData 不自动刷新。
- **修复计划**: 在 vip.tsx 购买完成后 `queryClient.invalidateQueries({ queryKey: ['bonus-member'] })`。

#### ⬜ H21: 相机权限拒绝后无引导跳转系统设置
- **文件**: `app/me/scanner.tsx` 行 31, 110-133
- **问题**: requestPermission 返回 false 时只显示按钮，无引导。
- **修复计划**: 检测到永久拒绝时显示"请在系统设置中授权" + `Linking.openSettings()` 按钮。

#### ⬜ H22: 关注/取关无防重复点击
- **文件**: `app/me/following.tsx` 行 65-73
- **问题**: Pressable 无 disabled 状态，快速点击多次调用 toggleFollow。
- **修复计划**: 添加 `pendingId` state 禁用当前操作中的按钮。

#### ⬜ H23: 提现后 router.back() 先于 invalidateQueries 完成
- **文件**: `app/me/withdraw.tsx` 行 48
- **问题**: 返回钱包页时数据可能还没刷新。
- **修复计划**: `await` invalidateQueries 后再 `router.back()`。

### 2.7 AI 功能

#### ⬜ H24: AI 聊天消息滚动与 state 更新竞态
- **文件**: `app/ai/chat.tsx` 行 115-120
- **问题**: `requestAnimationFrame` + `scrollToEnd` 可能在 state 更新前执行。
- **修复计划**: 在 `useEffect(() => { scrollRef.current?.scrollToEnd({animated:true}) }, [messages.length])` 中处理。

#### ⬜ H25: AI 推荐权重可能超过 100%
- **文件**: `app/ai/recommend.tsx` 行 127-137
- **问题**: `Math.round(weight * 100)%` 若 weight > 1 则进度条溢出。
- **修复计划**: `Math.min(100, Math.round(weight * 100))`，进度条添加 `maxWidth: '100%'`。

#### ⬜ H26: AI 助手快捷问题编辑未持久化
- **文件**: `app/ai/assistant.tsx` 行 76-98
- **问题**: 编辑后关闭，刷新页面重置为默认值。
- **修复计划**: 保存到 AsyncStorage，加载时读取。

### 2.8 奖励 / 商品

#### ⬜ H27: 奖励页初始 Tab 类型转换问题
- **文件**: `app/me/rewards.tsx` 行 209-213
- **问题**: params.tab 为非法值时 state 被污染。
- **修复计划**: 显式类型断言 `as TabKey`。

#### ⬜ H28: 商品图片列表空字符串处理
- **文件**: `app/product/[id].tsx` 行 153
- **问题**: `product.image` 为空字符串时条件判断失效。
- **修复计划**: `.filter(Boolean)` 过滤空值。

#### ⬜ H29: 分类过滤关键词匹配不精确
- **文件**: `app/category/[id].tsx` 行 66-77
- **问题**: 简单 `includes` 匹配，"茶" 同时返回 "奶茶"、"茶叶"。
- **修复计划**: 优化匹配权重排序，标题完全匹配 > tag 匹配 > 描述匹配。

#### ⬜ H30: 团购参团缺少幂等性保护
- **文件**: `app/group/[id].tsx` 行 65-90
- **问题**: BookingRepo 成功但 GroupRepo 失败时重试会重复参团。
- **修复计划**: 前端添加 loading lock + 后端幂等键。

#### ⬜ H31: 物流追踪页 orderId 为空时显示硬编码占位数据
- **文件**: `app/orders/track.tsx` 行 52-59, 78
- **问题**: 无 orderId 时显示假物流数据，误导用户。
- **修复计划**: 无 orderId 时显示 EmptyState "请从订单列表打开物流追踪"。

#### ⬜ H32: 售后状态在订单列表显示不完整
- **文件**: `app/orders/index.tsx` 行 175-179
- **问题**: 所有售后状态统一显示为"处理中"，无法区分。
- **修复计划**: 显示具体状态标签（申请中/审核中/已通过/已发货/已完成）。

---

## 三、MEDIUM 问题（42项）

### 3.1 购物车与结算

| # | 文件 | 问题 | 修复方向 |
|---|------|------|---------|
| ⬜ M01 | `cart.tsx:97-99` | 全选包含奖品/赠品，用户无法区分 | selectAll 只选可勾选项 |
| ⬜ M02 | `cart.tsx:236-237` | 赠品解锁金额在每个 renderItem 重复计算 | 在 renderItem 外 useMemo 预计算 |
| ⬜ M03 | `checkout-address.tsx:24-27` | 地址选择后返回 checkout 路由参数不更新 | 使用 useFocusEffect refetch |
| ⬜ M04 | `checkout.tsx:74-90` | 快速切换地址触发多次预结算无防抖 | 500ms debounce |
| ⬜ M05 | `checkout.tsx:110-124` | 服务端价格比对缺少 defensive check | 添加数组格式校验 |
| ⬜ M06 | `cart.tsx:345-399` | 推荐列表可能包含奖励商品 | 过滤 isPlatform 商品 |
| ⬜ M07 | `cart.tsx:51-60` | 奖品过期检查依赖本地时间 | 定期 syncFromServer 让后端清理 |
| ⬜ M08 | `checkout.tsx` | 奖励选择后修改购物车，奖励可能不再适用 | 购物车变化时自动清除奖励 |
| ⬜ M09 | `lottery.tsx:292-301` | 抽奖后加入购物车无 toast 提示 | 添加"奖品已加入购物车"提示 |
| ⬜ M10 | `lottery.tsx:27-36` | 转盘角度累积计算可能偏差 | 规范化当前旋转角度 |

### 3.2 订单与售后

| # | 文件 | 问题 | 修复方向 |
|---|------|------|---------|
| ⬜ M11 | `orders/[id].tsx:373-382` | 缺少运费和商品金额明细 | 添加完整价格分解 |
| ⬜ M12 | `orders/[id].tsx:315-323` | 售后时间线 note 字段无 Mock 测试数据 | 补充 Mock |
| ⬜ M13 | `orders/track.tsx:118-121` | 地图占位区无"开发中"标记 | 添加半透明遮罩 + 标签 |
| ⬜ M14 | `orders/after-sale/[id].tsx:57-62` | 照片上传无最小尺寸验证 | 添加 1280x720 最小检查 |
| ⬜ M15 | `orders/after-sale/[id].tsx:174-207` | 选中商品行无高亮视觉反馈 | 添加选中背景色 |

### 3.3 首页与发现

| # | 文件 | 问题 | 修复方向 |
|---|------|------|---------|
| ⬜ M16 | `home.tsx:166-210` | 抽奖 FAB 动画依赖过多致频繁重启 | 分离动画启动与状态依赖 |
| ⬜ M17 | `home.tsx:277` | FloatingParticles 持续高 render | 提供关闭选项或低端机降频 |
| ⬜ M18 | `museum.tsx:116-346` | ListHeader memoization 依赖不完整 | 提取回调为 useCallback |
| ⬜ M19 | `museum.tsx:214-254` | 地图切回列表后视图模式状态丢失 | 缓存到 navigation state |

### 3.4 我的模块

| # | 文件 | 问题 | 修复方向 |
|---|------|------|---------|
| ⬜ M20 | `me/wallet.tsx:200-201` | 流水分类标签对未知 refType 显示英文 | 补全所有枚举或用后端 displayName |
| ⬜ M21 | `me/wallet.tsx:31-42` | 支出金额显示负号不直观 | 统一为正数 + 符号前缀 |
| ⬜ M22 | `me/profile.tsx:208-240` | 兴趣标签截断无实时计数反馈 | 显示 `{count}/6` |
| ⬜ M23 | `me/scanner.tsx:98-107` | 手动输入码长度硬编码 8 位 | 改用正则 `/^[A-Z0-9]{6,12}$/` |
| ⬜ M24 | `me/appearance.tsx:199-226` | 保存按钮标注"占位"且无 loading | 添加 loading + 移除"占位"文字 |
| ⬜ M25 | `me/vip.tsx:32-48` | VIP 等级权益硬编码 | 改为常量文件或后端返回 |

### 3.5 AI 功能与设置

| # | 文件 | 问题 | 修复方向 |
|---|------|------|---------|
| ⬜ M26 | `ai/finance.tsx:50-206` | renderServiceCard 三种状态未组件化 | 拆分为独立组件 |
| ⬜ M27 | `ai/trace.tsx:60-70` | 节点颜色无图例说明 | 添加图例 |
| ⬜ M28 | `ai/chat.tsx:123-152` | 快捷指令空状态无提示 | 添加 EmptyState |
| ⬜ M29 | `settings.tsx:76-113` | AI 偏好设置全部为占位 | 标记为禁用或隐藏 |
| ⬜ M30 | `notification-settings.tsx:65-103` | 主开关与子项层级关系不清晰 | 添加缩进 + tooltip |
| ⬜ M31 | `about.tsx`, `privacy.tsx` | 占位文案无标记 | 添加"内容待更新"横幅 |
| ⬜ M32 | `account-security.tsx:130-172` | 三个绑定账号行样式不统一 | 提取为可复用组件 |
| ⬜ M33 | `inbox/index.tsx:31-37` | Tab 切换时列表跳回顶部 | 缓存各 tab 滚动位置 |

### 3.6 搜索/商品/店铺

| # | 文件 | 问题 | 修复方向 |
|---|------|------|---------|
| ⬜ M34 | `search.tsx:202-204` | 热门搜索词硬编码 | 后端配置或常量文件 |
| ⬜ M35 | `search.tsx:156-176` | Tab 切换不保存滚动位置 | 添加 scrollY 缓存 |
| ⬜ M36 | `product/[id].tsx:512-594` | iOS/Android CTA 栏代码重复 | 提取为 ProductCTABar 组件 |
| ⬜ M37 | `product/[id].tsx:512` | CTA 栏可能被 ScrollView 内容覆盖 | 添加 zIndex: 100 |
| ⬜ M38 | `company/[id].tsx:85-98` | 事件日历状态管理竞态 | 添加加载状态指示 |
| ⬜ M39 | `company/[id].tsx:429-434` | 不可预约时只有文字无视觉区分 | 添加禁用按钮样式 |

### 3.7 认证与导航（从 CRITICAL 降级 / 新增）

| # | 文件 | 问题 | 修复方向 |
|---|------|------|---------|
| ⬜ M40 | `product/[id].tsx`, `user/[id].tsx`, `orders/[id].tsx`, `orders/after-sale/[id].tsx` | 路由参数 id 用 `String()` 转换，数组会变成 `"id1,id2"`（从 C05 降级） | 统一添加 `Array.isArray(id) ? id[0] : id` |
| ⬜ M41 | `src/repos/http/ApiClient.ts:155-159` | 401 自动登出后无导航到登录页、无 toast 提示，用户停留在当前页面后续操作静默失败 | logout 后触发全局事件/Zustand subscribe → 导航到登录页 + toast "登录已过期" |
| ⬜ M42 | `app/(tabs)/home.tsx:99-107` | 零点定时器依赖 `lotteryStatus` 导致频繁重建（非内存泄漏，从 C12 降级） | 仅依赖 `queryClient`，或抽离 `calcMsUntilMidnight()` 并在状态变化时避免重复建 timer |

---

## 四、LOW 问题（30+项）

### 4.1 样式与设计令牌

| # | 文件 | 问题 |
|---|------|------|
| ⬜ L01 | `home.tsx:551,560,574,688,692` | 硬编码颜色值应使用设计令牌 |
| ⬜ L02 | `me.tsx:501,506,521,571` | 同上 |
| ⬜ L03 | `cart.tsx`, `checkout.tsx` | 多处 `.toFixed(2)` 应统一为 `formatCurrency()` |
| ⬜ L04 | `category/[id].tsx:174-189` | 商品卡片动画延迟过长（30ms×index） |

### 4.2 交互细节

| # | 文件 | 问题 |
|---|------|------|
| ⬜ L05 | `home.tsx:267-272` | 快捷指令点击无视觉反馈 |
| ⬜ L06 | `home.tsx:473-479` | 最近对话点击无加载状态 |
| ⬜ L07 | `index.tsx:129-131` | 跳过按钮在深色模式下可读性不足 |
| ⬜ L08 | `me.tsx:396-436` | 任务数≤2时"查看全部"按钮多余 |
| ⬜ L09 | `me.tsx:538-544` | QRCode 组件每次 render 重新生成 |
| ⬜ L10 | `orders/index.tsx:167` | 订单号无快速复制功能 |
| ⬜ L11 | `orders/track.tsx` | 无分享物流链接功能 |
| ⬜ L12 | `orders/after-sale/[id].tsx:45-48` | 选中商品无自动滚动 |
| ⬜ L13 | `orders/[id].tsx:274-285` | 补发后无预计送达时间显示 |
| ⬜ L14 | `me/profile.tsx:263-268` | 重置按钮无二次确认 |
| ⬜ L15 | `ai/chat.tsx:221-231` | 输入框获焦无视觉变化 |
| ⬜ L16 | `ai/chat.tsx:29-70` | 无加载历史对话功能 |

### 4.3 类型安全

| # | 文件 | 问题 |
|---|------|------|
| ⬜ L17 | `user/[id].tsx:53` | `isSelf` 依赖 Mock 数据而非真实用户 |
| ⬜ L18 | `user/[id].tsx:54-55` | `intimacyLevel` 无 NaN 检查 |
| ⬜ L19 | `product/[id].tsx:36-51` | AI 评分为硬编码伪随机 |
| ⬜ L20 | `repos/ProductRepo.ts:106-109` | SKU 价格缺失无降级处理 |

### 4.4 可访问性与平台兼容

| # | 文件 | 问题 |
|---|------|------|
| ⬜ L21 | `(tabs)/_layout.tsx` | 深链接无自动 Tab 焦点切换 |
| ⬜ L22 | `category/[id].tsx:79-82` | 列数计算不考虑平板横屏 |
| ⬜ L23 | `search.tsx:213-232` | `numColumns={2}` 硬编码不响应旋转 |
| ⬜ L24 | `notification-settings.tsx` | 未声明 iOS/Android 通知权限 |
| ⬜ L25 | `museum.tsx:256-287` | AI 推荐与热门商品无清晰分隔 |

### 4.5 文案与占位

| # | 文件 | 问题 |
|---|------|------|
| ⬜ L26 | `me/wallet.tsx:80-83` | 冻结余额无解释说明 |
| ⬜ L27 | `me/rewards.tsx:72-76` | "满50可用" 应为 "满¥50可用" |
| ⬜ L28 | `me/tasks.tsx:55-62` | invalidateQueries 多个 key 无注释说明原因 |
| ⬜ L29 | `group/[id].tsx:48` | 公司名称加载失败时显示"企业"无提示 |
| ⬜ L30 | `settings.tsx:27-42` | 登出后无"重新登录"快捷入口 |

---

## 五、跨模块共性问题

### 5.1 ⬜ G01: 防重复提交缺失（12+ 页面）
**涉及**: 确认收货、取消订单、提现、关注/取关、签到、任务完成、保存资料、团购参团等
**统一方案**: 创建 `useAsyncAction(fn)` hook，返回 `[execute, isPending]`，自动处理 loading + disabled。

### 5.2 ⬜ G02: 路由参数处理不一致（部分页面未处理）
**现状**: `company/[id].tsx`、`group/[id].tsx` 已处理数组参数；但 `product/[id].tsx`、`user/[id].tsx`、`orders/[id].tsx`、`orders/after-sale/[id].tsx` 仍使用 `String(id)`（见 M40）。
**统一方案**: 抽取 `normalizeRouteId(id)` 工具函数并统一替换，避免同类问题反复出现。

### 5.3 ⬜ G03: 操作后关联数据刷新不完整（8+ 页面）
**涉及**: 签到→profile、VIP升级→tree、提现→wallet、任务完成→profile、修改资料→me 等
**统一方案**: 定义 `invalidateRelated(action)` 映射表，每种操作对应需要刷新的 queryKey 列表。

### 5.4 ⬜ G04: Mock 全局状态污染（3+ Repo）
**涉及**: InboxRepo.messageCache, TaskRepo.taskCache, LotteryRepo
**统一方案**: Mock 数据改为 AsyncStorage 存储，模拟真实持久化行为。

### 5.5 ⬜ G05: 价格格式化不统一（6+ 页面）
**涉及**: cart, checkout, checkout-redpack, wallet, orders, redpacks
**统一方案**: 创建 `formatCurrency(value: number): string` 统一函数，替代所有 `.toFixed(2)`。

### 5.6 ❌ G06: ~~401 认证过期全局处理缺失~~（已排除）
**排除原因**: `ApiClient.ts:147-159` 已全局处理 401（刷新 token → 失败则 logout）。无需额外工作。

---

## 六、修复实施顺序

### 批次一（P0 — 本周）
> 优先修复资金安全、核心流程、数据正确性
> 已排除/降级: ~~C05~~(降级M40) ~~C08~~(逻辑正确) ~~C09~~(ApiClient已处理) ~~C10~~(ApiClient不throw) ~~C12~~(降级M42) ~~C17~~(误判) ~~H01~~(误判) ~~H02~~(误判) ~~H16~~(误判) ~~G06~~(已处理)

1. **G01**: useAsyncAction hook（一次性解决 H13, H22, H30 等 12+ 防重复提交）
2. **C01-C03**: 结算流程三个核心 bug（奖品订单化 / 幂等键 / skuId 降级）
3. **C04**: SKU 空值保护
4. **C06-C07**: 订单状态处理（canceled 漏判 + delivered 确认收货）
5. **C14-C15**: 提现验证 + 任务原子性
6. **C11**: 通知设置持久化
7. **C13**: 首页反馈定时器清理
8. **C18-C20**: 剩余 CRITICAL（密码改后刷新 token / Museum 数据 / Me 页 profile 联动）
9. **M41**: 401 自动登出后的导航与提示补齐

### 批次二（P1 — 下周）
> 修复交互体验 + 状态管理

1. **G03**: invalidateRelated 映射（解决 H20, H23 等）
2. **G05**: formatCurrency 统一函数
3. **H04-H07**: 购物车交互优化
4. **H08-H10**: 结算支付体验
5. **H11-H14**: 订单操作保护
6. **H15 + H17**: Tab 页状态管理（H15 用 `'listening'` 状态：快速脉动 + 深绿色背景）
7. **H18-H21**: 我的模块 HIGH 问题
8. **H24-H26**: AI 功能 HIGH 问题
9. **M40-M42**: 路由参数统一 + 401 自动登出导航 + 零点定时器重建优化

### 批次三（P2 — 后续）
> 性能优化 + 细节打磨

1. **G04**: Mock 全局状态迁移
2. **M01-M39**: 剩余 MEDIUM 问题（M40-M42 已在 P1 处理）
3. **L01-L30**: 所有 LOW 问题

---

## 七、验证清单

每次修复完成后，需验证以下项目：

- [ ] TypeScript 编译通过
- [ ] 涉及页面在 iOS/Android/Web 上正常渲染
- [ ] 三态完整（Skeleton/Empty/Error）
- [ ] 网络异常场景测试（断网、慢网、超时）
- [ ] 快速重复操作测试（防重复提交）
- [ ] 边界数据测试（空数据、超长文本、特殊字符）
- [ ] 导航流程测试（前进/后退/深链接）
- [ ] 跨页面状态一致性测试
