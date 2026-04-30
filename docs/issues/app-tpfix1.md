# 买家 App 真机测试问题修复清单（2026-04-29 build-4-29.apk）

> **生成日期**: 2026-04-29
> **测试包**: `build-4-29.apk`（version 0.2.0，commit 2263d18，2026-04-29 12:38 打包）
> **测试设备**: 用户真机（Android）
> **调查方式**: 真实代码读取 + file:line 引用；P1-P4 已按本文执行并进入待部署/真机验证阶段
> **状态说明**: ⬜ 待修 | 🔧 修复中 | ✅ 代码已修 | ⏭️ 待部署/迁移 | ❓ 需真机验证

---

## 总览

| Bug | 严重 | 类别 | 部署方式 | 状态 |
|-----|------|------|----------|------|
| 1 | HIGH | 后端字段缺失 + 前端冗余 UI | 后端重启 + OTA | ✅ 代码已修，待部署验证 |
| 2 | CRITICAL | OSS 返回 http URL，Android APK 默认禁 cleartext | 后端配置 + SQL 迁移 + PM2 重启 | ⏭️ 代码/脚本已修，待 P5 SQL + 部署 |
| 3 | HIGH | SafeArea 未适配 | OTA（基本）+ 下次 build（兜底） | ✅ 代码已修，待真机验证 |
| 4 | HIGH | 键盘适配缺失 | OTA（基本）+ 下次 build（兜底） | ✅ 部分表单已修，4 个输入页进 backlog |
| 5 | MEDIUM | 路由绕弯 + 键盘遮挡 | OTA | ✅ 代码已修，待真机验证 |
| 6 | HIGH | 闭包陷阱导致弹窗死循环 | OTA | ✅ 代码已修，待真机验证 |
| 7 | CRITICAL | 支付宝 JS 错配 + sandbox flag 在 release 被关 | **OTA** + 后端配置 | ⏭️ 前端代码已修，待 P5 服务器支付配置 |
| 8 | HIGH | 13+ 处后端 deeplink 路径错配 | 后端重启 + SQL 迁移 + OTA | ⏭️ 代码/脚本已修，待 P5 SQL + 部署 |
| 9 | HIGH | Android 录音格式与上传声明不一致 | OTA + 加日志真机验证 | ✅ 代码已修，待真机验证 |

---

## 执行计划（按风险递增 + 一任务一 commit）

### 执行原则
1. **简单 → 复杂**：先做单文件零风险改动，便于精准 revert
2. **一任务一 commit**：commit message 用 `type(scope): 描述` 风格，配 Co-Authored-By
3. **本地 commit 不自动推 GitHub**：每阶段做完跟用户复述 + 拿到许可后再 push
4. **涉及钱链路（Bug 7、Bug 8）**：改完按 `docs/issues/tofix-safe.md` 末尾的安全清单过一遍
5. **同一 bug 改 2 次没好就停手**：转分析根因（CLAUDE.md 铁律）
6. **每完成一项**：回来更新本文档"进度跟踪表"对应行的状态 + 完成日期

### 进度跟踪表

| # | 阶段 | 任务 | 文件 | 部署 | 状态 | 完成日期 |
|---|------|------|------|------|------|----------|
| **P1** | **零逻辑风险，单文件改动** | | | | | |
| 1 | P1 | Bug 1 前端删邮箱 UI | `app/account-security.tsx` + `src/types/domain/UserProfile.ts` + `src/mocks/userProfile.ts` | OTA | ✅ | 2026-04-29 (commit c95d3d9) |
| 2 | P1 | Bug 3 Tab safe insets | `app/(tabs)/_layout.tsx` | OTA | ✅ | 2026-04-29 (commit 3ecab89) |
| 3 | P1 | Bug 6 弹窗 agreedRef | `app/checkout.tsx` | OTA | ✅ | 2026-04-29 (commit 86229cf) |
| 4 | P1 | Bug 1 后端 getProfile | `backend/src/modules/user/user.service.ts` | 后端部署 + PM2 重启 | ✅ | 2026-04-29 (commit 11ed366) |
| 5 | P1 | Bug 7 后端默认 NOTIFY_URL 加 /api/v1 | `backend/src/modules/payment/alipay.service.ts:107` | 后端部署 + PM2 重启 | ✅ | 2026-04-29 (commit 5644fa3) |
| 6 | P1 | Bug 2 后端 OSS secure:true | `backend/src/modules/upload/upload.service.ts:56` | 后端部署 + PM2 重启 | ✅ | 2026-04-29 (commit 7630142) |
| **P2** | **后端路径批量修正（多文件，同一逻辑，按业务域分 commit）** | | | | | |
| 7 | P2 | Bug 8 红包路径 `/coupons` → `/me/coupons` | `coupon-engine.service.ts:291,484` | 后端部署 + PM2 重启 | ✅ | 2026-04-29 (commit f413e9a) |
| 8 | P2 | Bug 8 钱包路径 `/wallet` → `/me/wallet` | `bonus.service.ts` + `bonus/engine/normal-upstream.service.ts` + `bonus/engine/vip-upstream.service.ts` + `bonus/engine/freeze-expire.service.ts` + `admin/bonus/admin-bonus.service.ts` 共 5 文件 8 处 | 后端部署 + PM2 重启 | ✅ | 2026-04-29 (commit b459d39) |
| 9 | P2 | Bug 8 卖家路径处理（删除 target 让消息变 info-only） | `checkout.service.ts:1296` + `payment.service.ts:701` | 后端部署 + PM2 重启 | ✅ | 2026-04-29 (commit 41d91c2) |
| **P3** | **跨文件重构（中风险）** | | | | | |
| 10 | P3 | Bug 4 Screen 加 keyboardAvoiding prop | `src/components/layout/Screen.tsx` | OTA | ✅ | 2026-04-29 (commit 293b174) |
| 11 | P3 | Bug 4 部分表单页面接入 keyboardAvoiding | account-security / checkout / invoices/profiles/edit / me/profile / orders/after-sale + after-sale-detail 共 6 页面（其余 4 个含 TextInput 页面待后续覆盖，见下方 backlog） | OTA | ✅ | 2026-04-29 (commit cbba6e4) |
| 12 | P3 | Bug 5 地址流程 + KAV 修复 | `app/checkout-address.tsx` + `app/me/addresses.tsx` | OTA | ✅ | 2026-04-29 (commit a4050e7) |
| 13 | P3 | Bug 8 前端路由白名单防御 + chevron 条件渲染 (含 P2 审查 M1) | `app/inbox/index.tsx` | OTA | ✅ | 2026-04-29 (commit 6673f8b) |
| **P4** | **涉及原生层调用的改动（需要真机验证）** | | | | | |
| 14 | P4 | Bug 7 alipay JS 修复（default import + sandbox env） | `src/utils/alipay.ts` + `app/_layout.tsx:148` | OTA（必须带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true`） | ✅ | 2026-04-29 (commit b6358cc) |
| 15 | P4 | Bug 9 前端录音格式 + 上传日志 | `src/hooks/useVoiceRecording.ts:307` + `src/repos/AiAssistantRepo.ts:193` | OTA | ✅ | 2026-04-29 (commit 8ee3fbe) |
| 16 | P4 | Bug 9 后端按 mimetype/文件头识别 + 接收日志 | `backend/src/modules/ai/ai.controller.ts:94` | 后端部署 + PM2 重启 | ✅ | 2026-04-29 (commit 1995901) |
| **P5** | **数据/服务器侧操作（用户执行 / 协同）** | | | | | |
| 17 | P5 | 写 SQL 迁移脚本 + dry-run COUNT | `backend/scripts/2026-04-29-migrate-oss-https.sql` + `backend/scripts/2026-04-29-migrate-inbox-routes.sql` | 仅生成脚本 | ✅ | OSS 脚本 2026-04-29 (384bce7)，inbox 脚本 2026-04-29 (a8fc7d5) |
| 18 | P5 | 执行 SQL 迁移（Bug 2 OSS http→https + Bug 8 路由批量改）| 服务器 PostgreSQL | 用户执行 | ⬜ | — |
| 19 | P5 | 改服务器 `.env` 的 `ALIPAY_NOTIFY_URL` | `backend/.env`（服务器上） | 用户执行 | ⬜ | — |
| 20 | P5 | 后端代码部署 + PM2 重启 | 推 staging → 自动部署 | 用户/我（待协商） | ⬜ | — |
| 21 | P5 | OTA 发布（含 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` env） | `EXPO_PUBLIC_ALIPAY_SANDBOX=true eas update --branch preview --message "..."` | 用户/我（待协商） | ⬜ | — |
| 22 | P5 | 真机冷启动两次验证全部 9 个 bug | 用户真机 | 用户 | ⬜ | — |

### 阶段说明

- **P1（任务 1-6）**：6 个零风险单文件改动，每个 commit 都很小，出问题直接 revert 单 commit 即可
- **P2（任务 7-9）**：8 处后端路径修正按业务域分 3 个 commit（红包 / 钱包 / 卖家），不混在一起便于精准 revert
- **P3（任务 10-13）**：跨多文件的逻辑改动，task 11 涉及 6+ 页面会是稍大的 commit
- **P4（任务 14-16）**：原生模块相关改动，必须真机验证。Bug 7 的 OTA 命令要带 env var，否则白推
- **P5（任务 17-22）**：数据迁移 + 服务器配置 + 部署，由用户主导执行（涉及生产凭据和回滚成本最高的动作）

### 阶段关卡（每完成一阶段必做）
- ✅ TypeScript 编译验证：`npx tsc -b --noEmit`（前端） / `cd backend && npx tsc --noEmit`（后端）
- ✅ 跟用户复述本阶段所有 commit + 等回复
- ✅ P4 完成后必须按 `docs/issues/tofix-safe.md` 安全清单过一遍（涉及钱）
- ✅ 完成后派 `superpowers:code-reviewer` agent 审查所有 commit，按等级处理 High/Medium/Low

> **历史"修复批次"表已被本"执行计划"取代**，原表的"第 0 步用户验证 Bug 2"已完成（候选 A 确诊，详见 Bug 2 章节）。

### P1 阶段审查后置补丁（2026-04-29）
P1 6 commit 完成后派 code-reviewer agent 审查，发现 3 个 Medium 问题，已用 3 个补丁 commit 修复：

| # | Medium | 修复方式 | commit |
|---|--------|----------|--------|
| M1 | 部署文档 NOTIFY_URL 未同步代码默认值 | 改 `docs/features/支付宝支付.md` 公开部分；`docs/operations/阿里云部署.md`（gitignored）本地同步 | d175998 |
| M2 | 7630142 注释引用的 SQL 脚本不存在 | 提前完成 P5 Task 17，写 `backend/scripts/2026-04-29-migrate-oss-https.sql`（4 阶段 + 审计） | 384bce7 |
| M3 | `handleAgreePolicy` 失败分支不清 ref（防御性） | catch/return 前加 `pendingCheckoutRef.current = null` | 6c54448 |

P1 审查 Low 项暂缓（详见 review 报告）：
- L1：Android edge-to-edge 启用后再复测 tab bar 高度（下次 build 才启用）
- L2：commit msg 描述措辞瑕疵
- L3：发票域 email 字段独立功能，正确未误伤

P1 阶段总计 9 commit（6 主修 + 3 审查后置）：c95d3d9 / 3ecab89 / 86229cf / 11ed366 / 5644fa3 / 7630142 / d175998 / 384bce7 / 6c54448

### P2 阶段审查后置补丁（2026-04-29）
P2 3 commit 完成后派 code-reviewer agent 审查（全后端 20 个 inboxService.send 调用全部 grep 验证），全部 PASS。发现 2 个 Medium：

| # | Medium | 处理方式 | commit |
|---|--------|----------|--------|
| M1 | inbox UI 在 info-only 消息上仍显示 chevron 箭头，UX 不一致 | **延后到 P3 Task 13 一并处理**（chevron 条件渲染 + toast 文案改进，与"路由白名单防御"逻辑相邻） | (P3 待做) |
| M2 | InboxMessage 历史数据仍存 /coupons /wallet /seller/* 旧路径 | 写 `backend/scripts/2026-04-29-migrate-inbox-routes.sql`（3 阶段 + 审计），同步把 P5 Task 17 inbox 部分一并完成 | a8fc7d5 |

P2 业务 backlog 项（不在本次范围）：
- 卖家通知应该走独立 SellerInboxMessage 表 / Socket / 短信，不应蹭买家 inbox
- 当前 41d91c2 的 "info-only 卖家消息" 是临时止血方案

P2 阶段总计 4 commit（3 主修 + 1 审查后置）：f413e9a / b459d39 / 41d91c2 / a8fc7d5

### P3 阶段审查后置补丁（2026-04-29）
P3 5 commit（含 1 个设计修正 b9ca8df）完成后派 code-reviewer agent 审查，发现 2 个 High + 1 个 Medium：

| # | 等级 | 问题 | 处理方式 | commit |
|---|------|------|----------|--------|
| H1 | High | `me/withdraw.tsx` Android KAV behavior=undefined 实际禁用，且无 ScrollView | 改用 Screen.keyboardAvoiding + ScrollView | e5bd247 |
| H2 | High | 用户从 `/checkout-address?openNew=1` 跳来保存地址后退到列表态而非回 checkout | 加 cameFromCheckoutRef 标记，保存后判断 router.back() vs setEditing(null) | 35c4659 |
| M3 | Medium | `AuthModal.tsx` Android KAV 同样 behavior=undefined | 改 'height'，单独保留 KAV（Modal 无法用 Screen prop） | 727d960 |
| M4 | Medium | 表单 paddingBottom: 200 是魔数 | 改 insets.bottom + 200 动态值 | 35c4659（与 H2 合并） |

P3 阶段审查未修的 Medium / Low（暂缓）：
- M1：`keyboardVerticalOffset` 默认 0 在 iOS 可能 header 遮输入框 → **必须真机 iOS 验证**
- M5：`app.json` 没显式 `softwareKeyboardLayoutMode: "resize"` → 当前 default 是 resize，下次 build 加
- L5：`VALID_ROUTE_PREFIXES` hardcode 列表手工维护痛点 → backlog 项可写 `scripts/gen-routes.ts` 自动生成

P3 阶段总计 8 commit（4 主修 + 1 设计修正 + 3 审查后置）：293b174 / b9ca8df / cbba6e4 / a4050e7 / 6673f8b / e5bd247 / 727d960 / 35c4659

### P4 阶段审查后置补丁（2026-04-29）
P4 3 commit 完成后派 code-reviewer agent 审查（钱链路 + AI 语音重点检查），发现 1 个 High + 2 个 Medium，全部合并为 1 个补丁 commit 020baa0：

| # | 等级 | 问题 | 处理 |
|---|------|------|------|
| H1 | High | `expo-file-system@19` 的 `getInfoAsync` 已 deprecated 且**运行时会抛**，导致 Bug 9 诊断 size 字段拿不到，定位失效 | import 改为 `'expo-file-system/legacy'` |
| M1 | Medium | `eas.json` 没声明 `EXPO_PUBLIC_ALIPAY_SANDBOX`，未来 build 忘了带 env 沙箱被默关 | preview/production env 块加 `EXPO_PUBLIC_ALIPAY_SANDBOX` (true/false) |
| M2 | Medium | 后端 3gp brand 强映射 'amr' 不准（容器内可能是 AAC/AMR） | 3gp 分支返回 null 让 fallback 到 mimetype |

P4 阶段审查未修的 Low：
- L1：`AlipayClass` 类型未列 `setAlipayScheme/authInfo/getVersion` → 当前未用，按需补
- L2：后端 header 检测不覆盖 FLAC/Speex → 用户场景不会用
- L3：release APK 的 console.log 用户机上看不到，需 adb logcat → 已在文档说明

⚠️ **eas.json env 仅在 eas build 时被 Metro 内联，不影响 eas update**。OTA 仍必须显式带 env 或用 `--environment preview` 触发 EAS 后台 environment 注入。本次 020baa0 仅为下次 eas build 做准备。

P4 阶段总计 4 commit（3 主修 + 1 审查后置）：b6358cc / 8ee3fbe / 1995901 / 020baa0

### P4 后用户审查（2026-04-29）+ 补丁
用户基于代码再次审查 P4 完成状态，发现 4 个 finding，按等级处理：

| # | 等级 | 问题 | commit |
|---|------|------|--------|
| F1 | High | 本地 .env localhost + WebhookIpGuard 在生产无白名单时拒绝所有支付回调 | cc778cc（文档警告，代码无需改；用户 P5 在服务器配 .env） |
| F2 | Medium | 从 checkout 跳来新增地址，保存成功后未把新地址写入 checkout store | e89e979（cameFromCheckout 时调 setSelectedAddress） |
| F3 | Medium | Bug 4 文档"各 input 页面"表述偏满，4 页面 (ai/chat / cs / search / company/search) 未覆盖 | 本 commit（文档表述修正 + backlog 项） |
| F4 | Low | 微信绑定状态依赖 nickname，nickname 空时误判"未绑定" | 3913fbf（后端加 wechatBound 字段，前端用绑定布尔判定） |

**Bug 4 未覆盖的 4 个 input 页面（backlog 项，下批处理）**：
- `app/ai/chat.tsx:451` AI 聊天页（FlatList + 底部固定输入框，KAV 应包输入框单独处理）
- `app/cs/index.tsx:314` 在线客服聊天页（同上结构，FlatList + 底部输入）
- `app/search.tsx:632` 搜索结果页（header 搜索框，理论上不会被键盘覆盖但应验证）
- `app/company/search.tsx:419` 商家搜索页（同 search.tsx）

**P5 必做事项 finding 1 补充**：
- 服务器 `backend/.env` 改 `ALIPAY_NOTIFY_URL` ⭐
- 服务器 `backend/.env` 配 `WEBHOOK_IP_WHITELIST="<支付宝/微信回调 IP 段>"` ⭐
- 否则即使 NOTIFY_URL 改对，回调仍被 WebhookIpGuard 403

P4 后审查总计 4 commit：3913fbf / e89e979 / cc778cc / （Finding 3 文档与本段一并 commit）

### P4 后二次补丁（2026-04-29）
继续审查后补齐 3 个收尾问题：

| # | 等级 | 问题 | 处理 |
|---|------|------|------|
| F5 | Medium | 从 checkout 新增地址保存后只回到选择地址页，不是确认订单页 | 保存成功后 `setSelectedAddress(newId)` + `router.dismiss(2)`，直接回 `/checkout` |
| F6 | Medium | 从 checkout 新增地址页点顶部返回会落到地址管理列表态 | 表单返回改为 `router.back()` 回选择地址页，不再 `setEditing(null)` |
| F7 | Medium | `app.json` 引用了未跟踪的 logo 文件，后续 EAS build 可能找不到资源 | 已把 `logo/ios.png`、`logo/android-adaptive.png` 纳入 Git 索引，需随本批改动一起提交 |

---

## Bug 1：账号与安全页绑定状态全显"未绑定" + 移除邮箱

### 用户报告
1. 用手机号注册并登录后，账号与安全页"手机号"那一行显示"未绑定"
2. 用微信登录后，"微信"那一行显示"未绑定"
3. 用户希望删除"邮箱"那一行 —— 不需要邮箱绑定

### 真根因
`backend/src/modules/user/user.service.ts:26-47` 的 `getProfile()` 返回字段中**完全没有** `phone` / `wechatNickname` / `email`，前端 `app/account-security.tsx:102-104` 读到的全部是 `undefined` → 三行都走"未绑定"分支。

数据存储是对的：
- 手机号 → `AuthIdentity{provider:'PHONE', identifier:phone}`（`auth.service.ts:131`）
- 微信昵称 → `UserProfile.nickname`（`auth.service.ts:460-462`，与"普通昵称"共用同一字段）
- 邮箱 → 后端**根本没实现过**，`AuthProvider` enum 只有 PHONE/WECHAT/GUEST（`schema.prisma:30-34`），全 backend grep 不到 email
- 管理后台 `admin-app-users.service.ts:137` 也是从 `user.profile.nickname` 读微信昵称，App 直接对齐即可

### 修复方案
1. **后端**：`backend/src/modules/user/user.service.ts:10-48` `getProfile()` 改 `include: { profile:true, authIdentities:true }`，return 对象追加：
   - `phone: authIdentities.find(i => i.provider === 'PHONE')?.identifier`
   - `wechatNickname: authIdentities.some(i => i.provider === 'WECHAT') ? profile?.nickname : null`
2. **前端**：删除以下邮箱相关 UI/逻辑：
   - `app/account-security.tsx:21-26`（`maskEmail` 函数）
   - `app/account-security.tsx:103`（`emailMasked` 计算）
   - `app/account-security.tsx:134-149`（整段邮箱 `<Pressable>` 行）
   - `src/types/domain/UserProfile.ts:16`（可选删除 `email?` 字段）

### 部署方式
后端 PM2 重启 + 一次 OTA 推前端

---

## Bug 2：买家 App 看不到真实上传的商品图片

### 用户报告
- 发现页 / 商品列表 / 商品详情等所有展示商品的页面
- 真实从卖家后台上传的商品图**显示不出来**（白图/失败）
- **种子数据的商品图可以正常显示**
- 用户在 App 内**无法把图片 URL 复制出来**到浏览器测试（修正了上一轮"浏览器也打不开"的错误描述）

### 已掌握的事实
- 数据库存的就是 OSS 直连 URL：`http://huahai-aimaimai.oss-cn-hangzhou.aliyuncs.com/products/<uuid>.webp`（`backend/src/modules/upload/upload.service.ts:158` 直接 `return result.url`，无任何包裹/改写）
- 种子数据用的是 `https://images.pexels.com/...`（HTTPS，第三方公共图床，必然能加载）
- ali-oss 客户端 `upload.service.ts:56` `new OSS({...})` **未传 `secure: true`** → 默认 `secure=false` → 返回 `http://` 明文 URL

### 真根因（按概率排序）

#### 候选 A（最可能）：Android RN/Expo 默认禁止 cleartext HTTP
- React Native 0.71+ Android 默认 `usesCleartextTraffic=false`
- Expo SDK 54 默认 ATS 行为同样限制 http
- `app.json` 既未配 Android `usesCleartextTraffic` 也未配 iOS `NSAllowsArbitraryLoads`
- App 加载 `http://...aliyuncs.com/...` 直接被运行时拦截 → 静默失败白图
- **种子的 `https://images.pexels.com` 不受影响** → 完美解释"种子能显示，上传不行"

#### 候选 B（叠加可能）：OSS 桶为私有读
- 需要看阿里云 OSS 控制台桶权限配置
- 若是私有读，即便改成 https 直连也会 403

#### 候选 C（叠加可能）：OSS 桶设了 Referer 防盗链白名单
- 需要看 OSS 控制台数据安全配置

### 用户验证结果（2026-04-29）
> 卖家后台 + 管理后台（均为 HTTPS 页面）**都能正常显示**这些图片。仅 App 显示不出。
>
> → **候选 A 确诊**：OSS 桶可访问，浏览器对 http 图片要么自动 upgrade、要么放行；Android APK 默认 `usesCleartextTraffic=false` 直接拦截 → 静默失败。

### 修复方案
1. **后端**：`backend/src/modules/upload/upload.service.ts:56` `new OSS({...})` 加 `secure: true`，让 `oss.put()` 返回 `https://...` URL
2. **数据迁移 SQL**（已 awk 实测每行所属 model，表名/字段名 100% 准确）：
   ```sql
   -- ProductMedia.url —— 商品图主表
   UPDATE "ProductMedia"      SET url               = REPLACE(url, 'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE url               LIKE 'http://huahai-aimaimai%';

   -- UserProfile.avatarUrl —— 用户头像（注意是 UserProfile，不是 User）
   UPDATE "UserProfile"       SET "avatarUrl"       = REPLACE("avatarUrl", 'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "avatarUrl"       LIKE 'http://huahai-aimaimai%';

   -- CompanyDocument.fileUrl —— 企业资质文件
   UPDATE "CompanyDocument"   SET "fileUrl"         = REPLACE("fileUrl", 'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "fileUrl"         LIKE 'http://huahai-aimaimai%';

   -- MerchantApplication.licenseFileUrl —— 入驻申请营业执照（注意是 MerchantApplication，不是 Company）
   UPDATE "MerchantApplication" SET "licenseFileUrl" = REPLACE("licenseFileUrl", 'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "licenseFileUrl" LIKE 'http://huahai-aimaimai%';

   -- Shipment.waybillUrl —— 顺丰电子面单 PDF
   UPDATE "Shipment"          SET "waybillUrl"      = REPLACE("waybillUrl", 'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "waybillUrl"      LIKE 'http://huahai-aimaimai%';

   -- Invoice.pdfUrl —— 电子发票 PDF
   UPDATE "Invoice"           SET "pdfUrl"          = REPLACE("pdfUrl", 'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "pdfUrl"          LIKE 'http://huahai-aimaimai%';

   -- AiUtterance.audioUrl —— AI 对话音频
   UPDATE "AiUtterance"       SET "audioUrl"        = REPLACE("audioUrl", 'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "audioUrl"        LIKE 'http://huahai-aimaimai%';

   -- AfterSaleRequest.replacementWaybillUrl —— 换货面单（注意是 AfterSaleRequest，不是 Replacement）
   UPDATE "AfterSaleRequest"  SET "replacementWaybillUrl" = REPLACE("replacementWaybillUrl", 'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "replacementWaybillUrl" LIKE 'http://huahai-aimaimai%';

   -- VipGiftOption.coverUrl —— VIP 赠品封面（CUSTOM 模式）
   UPDATE "VipGiftOption"     SET "coverUrl"        = REPLACE("coverUrl", 'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "coverUrl"        LIKE 'http://huahai-aimaimai%';

   -- ⚠️ Order.giftSnapshot 是 JSON 字段（schema.prisma:1738），里面嵌套有 coverUrl / productImage —— 需用 jsonb 操作单独迁移，建议另列脚本：
   -- UPDATE "Order" SET "giftSnapshot" = jsonb_set(...) WHERE "giftSnapshot"::text LIKE '%http://huahai-aimaimai%';
   -- 对客服 ChatMessage 等其他可能挂载 URL 的字段，执行前再 grep 一遍 schema.prisma 防漏：
   --   grep -nE "Url\s+String|url\s+String" backend/prisma/schema.prisma
   ```
   涉及的 schema 字段（已 awk 验证 model 归属）：
   - `UserProfile.avatarUrl` (629)
   - `CompanyDocument.fileUrl` (954)
   - `MerchantApplication.licenseFileUrl` (978)
   - `ProductMedia.url` (1181)
   - `Shipment.waybillUrl` (1570) [model = Shipment]
   - `Invoice.pdfUrl` (1640)
   - `AiUtterance.audioUrl` (1668)
   - `AfterSaleRequest.replacementWaybillUrl` (2180)
   - `VipGiftOption.coverUrl` (2341)
   - `Order.giftSnapshot` (1738，**JSON 字段**，需 jsonb 单独操作)
3. PM2 重启后端

### 部署方式
后端代码改 + PM2 重启 + SQL；**App 不需要重打 / OTA**（App 下次拉到的就是 https URL，自然能加载）

### 风险点
- SQL 迁移前必须 grep 后端所有 schema 字段，确认覆盖所有存 OSS URL 的位置（不止 ProductMedia）
- 迁移前建议先 `SELECT` 一遍看有多少行受影响，再 UPDATE
- 如果有定时任务/异步流程仍在写新数据，最好在低峰期执行，或加事务保证原子性

---

## Bug 3：底部 Tab 导航被系统手势条/虚拟键遮挡

### 用户报告
不同手机底部按钮（虚拟键 / 手势小白条 / 三大金刚键）会遮挡 App 的 tab bar，没适配所有机型。

### 真根因
1. `app/(tabs)/_layout.tsx:20-25` `tabBarStyle` 写死 `height:56, paddingBottom:4`，**完全没用 `useSafeAreaInsets()`** —— 自定义 height 会**覆盖** expo-router Tabs 的默认 inset 自动追加
2. `app.json` Android 块**未声明** `edgeToEdgeEnabled`，Expo SDK 54 默认开启 edge-to-edge，但显式不声明在某些机型上 `insets.bottom` 仍可能返回 0

根布局 OK：`app/_layout.tsx:161` 已包 `<SafeAreaProvider>`；`react-native-safe-area-context: ~5.6.0` 已安装。

### 修复方案
1. **OTA 主修**：`(tabs)/_layout.tsx` 顶层 `const insets = useSafeAreaInsets()`，`tabBarStyle: { height: 56 + insets.bottom, paddingBottom: insets.bottom + 4 }`
2. **下次 build 兜底**：`app.json` android 块加 `"edgeToEdgeEnabled": true`

### 部署方式
OTA 解决主流机型；app.json 改动顺手在 Bug 7 重打 APK 时一起加

---

## Bug 4：键盘遮挡输入框，页面无法滚动

### 用户报告
打字时输入框被键盘挡住，页面没办法滚到键盘上方。多机型都有。

### 真根因
> **用户实测 APK Manifest（2026-04-29 修正）**：MainActivity `windowSoftInputMode=0x10`（adjustResize）**已正确配置**。所以"缺 resize 行为"不是根因，纯粹是 JS 层页面容器不可滚动 + 未避让键盘。

1. `src/components/layout/Screen.tsx` 公共容器**完全无键盘适配**（无 KAV、无 ScrollView）
2. 11+ 个含 TextInput 的页面零 KAV：
   - `app/checkout.tsx:741`
   - `app/account-security.tsx:196,214,232`
   - `app/me/profile.tsx`
   - `app/invoices/profiles/edit.tsx`
   - `app/orders/after-sale/[id].tsx`
   - `app/orders/after-sale-detail/[id].tsx`
   - `app/cs/index.tsx:469`
   - `app/ai/chat.tsx:593`
   - 等等
3. 仅有的 3 个用了 KAV 的页面，Android `behavior={undefined}` 等于没用（`me/addresses.tsx`、`me/withdraw.tsx`、`overlay/AuthModal.tsx`）

### 修复方案（纯 OTA 可解决）
`src/components/layout/Screen.tsx` 加 prop `keyboardAvoiding?: boolean`，启用时：
```tsx
<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex:1}}>
  <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{flexGrow:1}}>
    {children}
  </ScrollView>
</KeyboardAvoidingView>
```
所有有 input 的页面 `<Screen>` 改成 `<Screen keyboardAvoiding>`，删除自己写的 KAV。

### 部署方式
OTA（APK Manifest 已 adjustResize，不需要任何 build 端动作）

---

## Bug 5：地址选择跳转绕弯 + 新增地址页键盘遮挡

### 用户报告
1. 结算页（无地址时）点「请选择收获地址」→ 跳到选择收货地址页 ✅
2. 在选择页点「添加地址」→ 又进了一个**相似的收货地址列表页**（不是新增表单！）❌
3. 在那个相似页再点「添加地址」→ 才终于进新增地址表单
4. 在新增表单页输入时，键盘遮挡"区县"和"详细地址"，页面无法拖动

### 真根因
**绕弯**：`app/checkout-address.tsx:58 + :68` 两个"添加地址"按钮都 `router.push('/me/addresses')`（个人中心地址管理页），那个页面默认渲染**列表**（`me/addresses.tsx:186-211`），只有 `editing` state 不为 null 才渲染表单 → 用户必须再点右上角 `+`（L192 `openNew`）才进表单。多了一跳。

**键盘遮挡**：`me/addresses.tsx:130-134`：
- KAV `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` —— Android 显式设 `undefined` 等于没启用
- 表单外层 `<View style={{padding: spacing.xl, flex:1}}>` —— **不是 ScrollView**，即使 KAV 工作内容也没法滚动
- 字段顺序：收货人 / 手机号 / 省份 / 城市 / **区县** / **详细地址** —— 后两个在底部必然被压

### 修复方案（OTA 可发）
1. `checkout-address.tsx:58, :68` 两个按钮目标改为 `/me/addresses?openNew=1`
2. `me/addresses.tsx` 用 `useLocalSearchParams` 读到 `openNew=1` 后 `useEffect` 自动 `setEditing('new')` 进表单
3. `me/addresses.tsx:130` KAV `behavior` Android 改成 `'height'`
4. `me/addresses.tsx:134` `<View>` 改成 `<ScrollView contentContainerStyle={{padding:spacing.xl, paddingBottom:200}} keyboardShouldPersistTaps="handled">`

### 部署方式
OTA

---

## Bug 6：首次下单"购买须知/退换货须知"弹窗死循环

### 用户报告
1. 首次进结算页 → 弹"购买商品须知 + 退换货须知"弹窗
2. 点「确定」→ 弹窗自动**重新弹出** → 再点确定 → 又弹出 → 无限循环
3. 必须点「取消」才能停止

### 真根因（闭包 ref 陷阱）
`app/checkout.tsx`：
- L65 `const [localAgreed, setLocalAgreed] = useState(false)`
- L118 `const hasAgreedReturnPolicy = localAgreed || profileData?.data?.hasAgreedReturnPolicy` —— **渲染时计算的局部常量**，初始 false
- L259-264 `ensurePolicyAgreed`：
  ```ts
  if (hasAgreedReturnPolicy) return true;     // 这里读的是闭包内的局部常量
  pendingCheckoutRef.current = onProceed;     // 把 handleCheckout 函数引用存进 ref
  setPolicyModalVisible(true);
  ```
- L235-256 `handleAgreePolicy` 成功后：
  ```ts
  setLocalAgreed(true);
  setPolicyModalVisible(false);
  ...
  fn();  // ← fn 就是 ref 里那个 handleCheckout 闭包
  ```
- `fn()` 调用的是**渲染时的 `handleCheckout` 闭包**，那个闭包内部的 `hasAgreedReturnPolicy` 是 L118 的局部常量值 **false**（不是从 state/ref 重新读的）→ 再进 `ensurePolicyAgreed` 仍判 false → `setPolicyModalVisible(true)` → 弹窗重新弹 → **死循环**

`setLocalAgreed` 是不是异步**与本 bug 无关**——重点是 ref 缓存的函数引用永远捕获着调用瞬间的常量值。

### 为什么"取消"能停
`L1018-1027` 取消按钮显式 `pendingCheckoutRef.current = null`，没人再调 `fn()`，循环断掉。`handleAgreePolicy` 的成功路径里**主动**调用 `fn()`，所以触发下一轮。

### 修复方案（OTA 可发）
**方案 A（推荐，最稳）**：用 ref 镜像 agreed 状态
```ts
const agreedRef = useRef(false);
// handleAgreePolicy 成功后：agreedRef.current = true;
// ensurePolicyAgreed 改判：if (hasAgreedReturnPolicy || agreedRef.current) return true;
```
这样旧闭包再次进入 ensurePolicyAgreed 时能读到最新值，跳过弹窗。

**方案 B**：把 `handleCheckout` 的下单部分（L278 `setSubmitting` 之后）抽成 `doCheckout()`，`handleAgreePolicy` 成功后**直接调 `doCheckout()`** 绕过 `ensurePolicyAgreed`。`agreePolicy` 接口失败时因为已经 `return`（L240），不会调 doCheckout，用户看到 toast 提示后可重试，不会卡死。

### 部署方式
OTA

---

## Bug 7：支付宝沙箱"支付触发失败"

### 用户报告
- App 结算页选支付宝渠道 → 点提交订单 → 弹"支付宝触发失败，请稍后重试"
- 用户已在支付宝沙箱后台填了公网回调地址：`https://test-api.ai-maimai.com/api/v1/payments/alipay/notify`

### 用户实测 APK 内含信息（2026-04-29 修正，推翻上一轮"缺 native module"结论）
检查 build-4-29.apk 实际包含：
- ✅ `RNAlipay` 原生类已打包
- ✅ 支付宝 SDK Activity 已注册
- ✅ AndroidManifest 已声明支付宝 package queries

→ **"缺 plugin / 必须重打 APK"上一轮结论错误**。原生层已就绪，问题在 JS 层。

### 真根因（按确诊度排序）

#### 根因 1（致命，已确诊）：JS 把 default export 当具名 export 解构
- `node_modules/@uiw/react-native-alipay/index.js:22` 是 `export default class Alipay { static alipay(...), static setAlipaySandbox(...) }`
- `src/utils/alipay.ts:10` `const { setAlipaySandbox } = require('@uiw/react-native-alipay')`
- `src/utils/alipay.ts:34` `const { alipay } = require('@uiw/react-native-alipay')`
- CommonJS interop 下 `require(...)` 拿到的是 `{ default: Alipay, __esModule: true }` —— **顶层没有 `alipay` / `setAlipaySandbox` 字段，解构永远 undefined**
- `payWithAlipay:35` `if (!alipay)` 立即返回 `NATIVE_UNAVAILABLE`
- `checkout.tsx:303` 命中 NATIVE_UNAVAILABLE 分支 → 调 `OrderRepo.simulatePayment()` → 后端拒绝 → 弹"支付触发失败"

#### 根因 2（致命，已确诊）：`__DEV__` 控制 sandbox flag，release APK 必关
- `app/_layout.tsx:148` 用 `__DEV__` 决定是否启用沙箱模式
- preview / production profile 的 APK 是 **release build**，`__DEV__ === false`
- → 沙箱 flag 被关闭 → SDK 用沙箱 appId 去走线上网关 → 凭据/签名校验失败
- 即使根因 1 修了，沙箱 flag 不开仍然付不了款

#### 根因 3：后端 `.env` 的 NOTIFY_URL 还是 localhost
- `backend/.env`: `ALIPAY_NOTIFY_URL="http://localhost:3000/payments/alipay/notify"`
- **支付宝按后端下单请求里的 `notify_url` 参数回调，不是按沙箱后台填的那个值**
- 即使付款成功，回调打到 localhost，订单状态不会变 PAID

#### 根因 4：后端默认 URL 漏了 `/api/v1` 前缀
- `backend/src/modules/payment/alipay.service.ts:107` 默认值 `https://api.ai-maimai.com/payments/alipay/notify`
- NestJS 全局前缀是 `setGlobalPrefix('api/v1')`，正确路径必须带 `/api/v1`
- 正确值：`https://test-api.ai-maimai.com/api/v1/payments/alipay/notify`

### 修复方案（**纯 OTA 可解决**，加上后端配置改动）

#### 前端（OTA）
1. `src/utils/alipay.ts:10/34` 改用 default export：
   ```ts
   const Alipay = require('@uiw/react-native-alipay').default;
   // 后续：Alipay.setAlipaySandbox(true);  Alipay.alipay(orderStr);
   ```
2. `app/_layout.tsx:148` 把 `__DEV__` 替换成显式环境变量控制：
   ```ts
   const ALIPAY_SANDBOX = process.env.EXPO_PUBLIC_ALIPAY_SANDBOX === 'true';
   ```
3. **环境变量必须在 `eas update` 命令上显式带入**（关键：`eas.json` 的 `build.<profile>.env` 块**不会**被 `eas update` 自动读取），有两种正确做法：
   - 命令行临时注入（最直接）：
     ```bash
     EXPO_PUBLIC_ALIPAY_SANDBOX=true eas update --branch preview --message "fix: alipay default import + 显式 sandbox flag"
     ```
   - 或者在 EAS 后台为 `preview` environment 配置该变量后，加 `--environment preview`：
     ```bash
     eas update --branch preview --environment preview --message "..."
     ```
   ⚠️ **如果忘了带 env 直接 `eas update --branch preview`**，本次 OTA 仍会把 sandbox 编成 false，等于白推。推送前必须确认命令行里有这个变量，或在 EAS 后台已配置好

#### 后端
1. `backend/.env` 改 `ALIPAY_NOTIFY_URL="https://test-api.ai-maimai.com/api/v1/payments/alipay/notify"`
2. `alipay.service.ts:107` 默认值同步加 `/api/v1`
3. **`backend/.env` 必须配置 `WEBHOOK_IP_WHITELIST`**（P4 后审查 finding 1 新发现）
   - `payment.controller.ts:53` 用 `@UseGuards(WebhookIpGuard)` 拦截所有非白名单 IP
   - `webhook-ip.guard.ts:39-44` 在 NODE_ENV=production 且未配此变量时**直接 throw ForbiddenException**
   - 支付宝异步通知会全部 403 → 订单永远不会变 PAID
   - 详见 `docs/operations/阿里云部署.md` Step 10
4. PM2 重启

### 部署方式
**OTA**（前端 JS 全部改动）+ 后端配置改 + PM2 重启。
未来为保证可复现构建，可以补一份 `plugins/withAlipay.js` 显式 link，但这不是当前失败的根因，可作为后续技术债。

---

## Bug 8：消息中心点"红包到账" → expo unmatched route（影响所有同类消息）

### 用户报告
- 进消息中心 → 点"红包到账"消息 → 跳到 expo-router 的 unmatched route 错误页 → 必须点"Go Back"才能回 App

### 真根因
后端发件代码大量写了 App 路由表里**不存在的路径**，前端 `app/inbox/index.tsx:77` 无脑 `router.push({ pathname: message.target.route, ... })` —— 路径不存在直接 unmatched。

#### 完整破窗清单（grep 全后端确认）

| 文件:行 | 错路径 | 应改为 |
|---------|--------|--------|
| `backend/src/modules/coupon/coupon-engine.service.ts:291,484` | `/coupons` | `/me/coupons` |
| `backend/src/modules/bonus/bonus.service.ts:1032` | `/wallet` | `/me/wallet` |
| `backend/src/modules/bonus/normal-upstream.service.ts:171,294` | `/wallet` | `/me/wallet` |
| `backend/src/modules/bonus/vip-upstream.service.ts:170,298` | `/wallet` | `/me/wallet` |
| `backend/src/modules/bonus/freeze-expire.service.ts:318` | `/wallet` | `/me/wallet` |
| `backend/src/modules/admin/admin-bonus.service.ts:136,1491` | `/wallet` | `/me/wallet` |
| `backend/src/modules/order/checkout.service.ts:1296` | `/seller/products` | 卖家路由不该出现在买家 App，删除消息或换为 web deeplink |
| `backend/src/modules/payment/payment.service.ts:701` | `/seller/orders` | 同上 |

> **`/orders/[id]` 不算错路径**（已修正）：项目里前端已有合法用法 `router.push({ pathname: '/orders/[id]', params: { id } })`，后端消息 target 写成 `{ route: '/orders/[id]', params: { id } }` 能被 expo-router 正确匹配。所以 `checkout.service.ts:1558`、`seller-orders:377`、`shipment.service:277/314` 这几处保留原写法即可。

App 实际路由（已验证）：根目录无 `/coupons` / `/wallet`，只有 `/coupon-center`（领券中心）、`/me/coupons`、`/me/wallet`。

### 修复方案

#### 后端代码修改
按上表逐项修正路径写入。

#### 数据迁移 SQL
```sql
UPDATE "InboxMessage" SET target = jsonb_set(target, '{route}', '"/me/coupons"')
  WHERE target->>'route' = '/coupons';
UPDATE "InboxMessage" SET target = jsonb_set(target, '{route}', '"/me/wallet"')
  WHERE target->>'route' = '/wallet';
-- /seller/* 历史消息建议保留原值不改路径，由前端防御层兜底
-- /orders/[id] 历史消息建议同上由前端兜底
```

#### 前端防御
`app/inbox/index.tsx:77` 加路由白名单 + 兜底：
```ts
const VALID_ROUTES = [
  '/me/coupons', '/me/wallet', '/orders',
  '/orders/[id]',          // 动态路由：必须与 params.id 一起使用
  '/product/[id]',
  // ...其他有效路由
];
if (message.target?.route) {
  // 路由合法（含动态路由模板匹配）→ router.push；否则 toast 提示且不跳转
}
```
顺手在 `inbox.service.ts:55-73` 的 `send()` 加路由格式校验，避免再生新破窗消息。

### 部署方式
后端 PM2 重启 + SQL + OTA（前端防御）

---

## Bug 9：AI 买买按钮在 APK 报错（expo-go 正常）

### 用户报告
- 在首页点「AI 买买」按钮触发对话
- APK 里报错二选一：
  - "未能识别到语言功能，请重试"
  - "网络异常，稍后重试"
- 同样代码在 expo-go 里**用真实后端 + 阿里云 DashScope 语音识别**正常工作

### 用户实测 APK 内含信息（2026-04-29 修正，推翻"缺权限"结论）
检查 build-4-29.apk 实际声明的 Android 权限：
- ✅ `android.permission.RECORD_AUDIO` 已声明
- ✅ `android.permission.MODIFY_AUDIO_SETTINGS` 已声明

→ **"缺 RECORD_AUDIO 权限"上一轮结论错误**。权限层已就绪。

### 真根因候选（按确诊度排序）

#### 候选 A（高度可疑）：Android 录音格式与上传声明不一致
- `src/hooks/useVoiceRecording.ts:307` Android 录音参数写成：
  - 文件后缀：`.wav`
  - `outputFormat: DEFAULT`
  - `audioEncoder: DEFAULT`
- **Android MediaRecorder 默认 outputFormat/audioEncoder 不保证产出真正 WAV**（多数设备产出 3GPP/AMR 或 MPEG-4/AAC）
- `src/repos/AiAssistantRepo.ts:193` 上传时**固定**声明 `mimetype: audio/wav`
- `backend/src/modules/ai/ai.controller.ts:94` 后端**固定**按 wav 格式交给阿里云 DashScope ASR
- → 后端"收到了音频但识别为空" → 触发 `ai.service.ts:489` 的"未能识别到语音内容，请重试"
- 这条与"expo-go 正常"也吻合：expo-go 内部使用的录音模块版本/默认编码可能与裸 RN 不同（待真机日志验证）

#### 候选 B（"网络异常"路径）：multipart 上传层失败或后端接口超时
- `useVoiceRecording.ts:497/505` 抛出"识别失败 / 识别异常: ${error.message}"
- error 来自 `src/repos/http/ApiClient.ts:240` 的"网络请求失败"
- 可能是 `fetch + FormData(file://)` 在 Android Hermes 静默上传失败 / abort / timeout（30s）
- 必须 `adb logcat` 或后端 PM2 日志才能确诊

### 错误文案精确归属
- "**未能识别到语音内容**" → 后端 `ai.service.ts:489`（用户口述的"未能识别到语**言**功能"是同字符近似）
- "**网络异常**" → 实际是前端 `useVoiceRecording.ts:497/505` 抛出的"识别失败/识别异常: 网络请求失败"

### 修复方案（OTA 可解决 + 必须加日志真机验证）

#### 第 1 步：修录音格式（OTA）
`src/hooks/useVoiceRecording.ts:307` Android 端改为明确支持的 m4a/aac。

⚠️ **import 注意**：当前文件只 `import { Audio } from 'expo-av'`，`AndroidOutputFormat` / `AndroidAudioEncoder` 不能直接裸写（会 TS/运行时报错）。已通过 `node_modules/expo-av/build/Audio/RecordingConstants.d.ts` 验证，正确写法两种任选：

**写法 A（推荐，通过 Audio namespace 访问）**：
```ts
android: {
  extension: '.m4a',
  outputFormat: Audio.AndroidOutputFormat.MPEG_4,    // = 2
  audioEncoder: Audio.AndroidAudioEncoder.AAC,        // = 3
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
}
```

**写法 B（更稳，原样保留 raw int 风格，与现有代码一致）**：
```ts
android: {
  extension: '.m4a',
  outputFormat: 2,  // MediaRecorder.OutputFormat.MPEG_4
  audioEncoder: 3,  // MediaRecorder.AudioEncoder.AAC
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
}
```

**写法 C（最省事，但失去 16kHz 单声道控制）**：直接 `await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)` —— 这个 preset 的 Android 块就是 `MPEG_4 + AAC`，但 sampleRate 默认 44.1kHz，需后端按 m4a 处理时确认 ASR 接受。

同时 `src/repos/AiAssistantRepo.ts:193` 把上传 mimetype 改成 `audio/m4a` 或 `audio/aac`。

#### 第 2 步：后端按文件头识别真实格式（后端代码部署 + PM2 重启）
`backend/src/modules/ai/ai.controller.ts:94` 不再无脑按 wav 处理，根据上传 multipart 的 mimetype 或文件头自动选择阿里云 DashScope 的 format 参数（DashScope 支持 wav / mp3 / aac 等）。

#### 第 3 步：加诊断日志（前端 OTA + 后端部署重启 + 真机验证）
- 前端 `AiAssistantRepo.ts` 上传前打印：URI、文件大小（`FileSystem.getInfoAsync`）、声明的 mimetype
- 后端 `ai.controller.ts` 收到时打印：multipart header、bytes 长度、文件前 16 字节十六进制（用于识别格式）
- 真机点一次 AI 按钮 → 看前后端日志能定锤是候选 A 还是候选 B

### 部署方式
**前端 OTA**（录音格式 + 上传日志） + **后端代码部署 + PM2 重启**（按文件头识别 + 接收日志）。不需要重打 APK（权限和 expo-av 模块都已经在 build-4-29.apk 里）。

### 状态
⬜ 待修。建议在第 2 批 OTA 时一并修。如果改完格式仍报错，再用真机日志看候选 B（网络/上传层）。

---

## 后端必改清单（汇总）

| 文件 | 改动 |
|------|------|
| `backend/.env` | `ALIPAY_NOTIFY_URL` 改成 `https://test-api.ai-maimai.com/api/v1/payments/alipay/notify` |
| `backend/src/modules/user/user.service.ts:10-48` | `getProfile` 加 `authIdentities` include + 返回 phone/wechatNickname |
| `backend/src/modules/upload/upload.service.ts:56` | OSS 客户端加 `secure: true`（待 Bug 2 验证后决定） |
| `backend/src/modules/coupon/coupon-engine.service.ts:291,484` | `/coupons` → `/me/coupons` |
| `backend/src/modules/bonus/bonus.service.ts:1032` | `/wallet` → `/me/wallet` |
| `backend/src/modules/bonus/normal-upstream.service.ts:171,294` | 同上 |
| `backend/src/modules/bonus/vip-upstream.service.ts:170,298` | 同上 |
| `backend/src/modules/bonus/freeze-expire.service.ts:318` | 同上 |
| `backend/src/modules/admin/admin-bonus.service.ts:136,1491` | 同上 |
| `backend/src/modules/order/checkout.service.ts:1296` | `/seller/products` 卖家路径不该出现在买家 App，删除消息或换 web deeplink |
| `backend/src/modules/payment/payment.service.ts:701` | `/seller/orders` 同上 |
| `backend/src/modules/payment/alipay.service.ts:107` | 默认 URL 加 `/api/v1` 前缀 |
| ~~`checkout.service.ts:1558` / `seller-orders:377` / `shipment.service:277,314`~~ | ~~`/orders/[id]` 字面量~~ → **已确认是合法 expo-router 动态路由写法（配合 params.id 使用），不需要改** |
| `backend/src/modules/ai/ai.controller.ts:94` | ASR 不再固定 wav，按 multipart mimetype 或文件头识别真实格式 + 加 bytes/header 诊断日志 |

## 数据迁移 SQL（汇总，已 awk 验证 model 归属）
```sql
-- Bug 8: 路由批量修正（仅这两条；/orders/[id] 是合法动态路由不需要迁移）
UPDATE "InboxMessage" SET target = jsonb_set(target, '{route}', '"/me/coupons"')
  WHERE target->>'route' = '/coupons';
UPDATE "InboxMessage" SET target = jsonb_set(target, '{route}', '"/me/wallet"')
  WHERE target->>'route' = '/wallet';

-- Bug 2: OSS http → https 完整迁移（model 名 100% 实测）
UPDATE "ProductMedia"        SET url                       = REPLACE(url,                       'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE url                       LIKE 'http://huahai-aimaimai%';
UPDATE "UserProfile"         SET "avatarUrl"               = REPLACE("avatarUrl",               'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "avatarUrl"               LIKE 'http://huahai-aimaimai%';
UPDATE "CompanyDocument"     SET "fileUrl"                 = REPLACE("fileUrl",                 'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "fileUrl"                 LIKE 'http://huahai-aimaimai%';
UPDATE "MerchantApplication" SET "licenseFileUrl"          = REPLACE("licenseFileUrl",          'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "licenseFileUrl"          LIKE 'http://huahai-aimaimai%';
UPDATE "Shipment"            SET "waybillUrl"              = REPLACE("waybillUrl",              'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "waybillUrl"              LIKE 'http://huahai-aimaimai%';
UPDATE "Invoice"             SET "pdfUrl"                  = REPLACE("pdfUrl",                  'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "pdfUrl"                  LIKE 'http://huahai-aimaimai%';
UPDATE "AiUtterance"         SET "audioUrl"                = REPLACE("audioUrl",                'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "audioUrl"                LIKE 'http://huahai-aimaimai%';
UPDATE "AfterSaleRequest"    SET "replacementWaybillUrl"   = REPLACE("replacementWaybillUrl",   'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "replacementWaybillUrl"   LIKE 'http://huahai-aimaimai%';
UPDATE "VipGiftOption"       SET "coverUrl"                = REPLACE("coverUrl",                'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "coverUrl"                LIKE 'http://huahai-aimaimai%';

-- ⚠️ Order.giftSnapshot 是 JSON 字段，需 jsonb 操作单独处理：
-- UPDATE "Order" SET "giftSnapshot" = jsonb_set(...) WHERE "giftSnapshot"::text LIKE '%http://huahai-aimaimai%';
-- 执行前再次 grep 防漏：grep -nE "Url\s+String|url\s+String" backend/prisma/schema.prisma
```

## 前端必改清单（汇总）

| 文件 | 改动 | 部署 |
|------|------|------|
| `app/account-security.tsx:21-26,103,134-149` | 删除邮箱 UI 和 `maskEmail` | OTA |
| `src/types/domain/UserProfile.ts:16` | 删除 `email?` 字段 | OTA |
| `app/(tabs)/_layout.tsx:20-25` | tabBarStyle 改用 `useSafeAreaInsets()` | OTA |
| `src/components/layout/Screen.tsx` | 加 `keyboardAvoiding` prop + KAV+ScrollView | OTA |
| `app/checkout.tsx:741`、`account-security.tsx`、`me/profile.tsx` 等 11+ 页面 | 用 `<Screen keyboardAvoiding>` | OTA |
| `app/checkout-address.tsx:58,68` | router.push 加 `?openNew=1` | OTA |
| `app/me/addresses.tsx:130-134` | KAV behavior=height + View → ScrollView + 读 `openNew` 参数 | OTA |
| `app/checkout.tsx:118,259-264` | 加 `agreedRef` | OTA |
| `src/utils/alipay.ts:10,34` | 改用 `require(...).default` | OTA |
| `app/_layout.tsx:148` | `__DEV__` 改 `process.env.EXPO_PUBLIC_ALIPAY_SANDBOX === 'true'` | OTA |
| OTA 发布命令 / EAS environment | 注入 `EXPO_PUBLIC_ALIPAY_SANDBOX=true`（**eas.json 的 build env 不会被 update 自动读取**，必须命令行带或 EAS 后台配 environment） | OTA |
| `app.json` android | （Bug 3 的 `edgeToEdgeEnabled` 待验证 APK manifest 是否已配置后再决定） | TBD |
| `src/hooks/useVoiceRecording.ts:307`（Android 块） | 改 `.m4a` + `MPEG_4` + `AAC` | OTA |
| `src/repos/AiAssistantRepo.ts:193` | mimetype 改 `audio/m4a` 并加上传日志 | OTA |
| `app/inbox/index.tsx:77` | 加路由白名单兜底 | OTA |

---

## 修复纪律提醒

1. 按 CLAUDE.md「同一个 Bug 修改不超过 2 次」原则，每个 bug 修一次后必须真机验证再决定是否再改
2. Bug 7 涉及支付，修改前必须按 CLAUDE.md「安全检查清单」过一遍
3. 推 OTA 前必须按 `docs/operations/app-发布与OTA手册.md` 第四章 checklist 执行
4. 推 GitHub 前必须问用户确认
5. **Bug 7 / Bug 9 上一轮误判教训**：用户实测 build-4-29.apk 已含 alipay 原生类 + RECORD_AUDIO 权限，所以"缺 plugin / 缺权限"的诊断都是错的。下次类似排查时，**先让用户/agent 用 `aapt dump permissions` / `unzip -p APK classes.dex` 抽查 APK 实际内容**，再下"必须重打 APK"的结论
6. Bug 9 改完格式后必须真机 + 后端日志双向验证（看 bytes 长度和文件头），如果 transcript 仍空，再走候选 B 排查上传层

---

## P5 真机验证后第一轮回归（2026-04-29，OTA group `16bde688-fde3-436c-9a2b-0fa9f797f357` 之后）

### 用户真机测试现象
1. **Bug 7 第一次提交订单**：等了很久 → 仍显示"支付触发失败"
2. **退出页面再进确认订单页**，再次点提交订单：
   - **Bug 6 复发**：退换货规则**再次弹出**（应该首次同意后永不再弹）
   - **Bug 7 改善但仍失败**：这次出现"去支付宝支付"文字 → **1 秒后**显示"支付失败，请重试"

### Bug 6 复发真根因（前端闭包修复 + 后端字段缺失双层 bug，P1 漏掉后端层）

P1 commit 86229cf 加了 `agreedRef` 解决"同一次会话内"的闭包陷阱（弹窗死循环），但**没解决退出再进的复发问题**。

真因：`backend/src/modules/user/user.service.ts:32-58` 的 `getProfile()` return 对象里**根本没把 `user.hasAgreedReturnPolicy` 字段返回前端**：
- schema.prisma:563 `User.hasAgreedReturnPolicy Boolean @default(false)` 字段存在
- `after-sale.service.ts:633` `agreePolicy()` 也确实把该字段更新成 true
- **但 `getProfile()` return 的 13 个字段里没列这个**
- 前端 `app/checkout.tsx:118` `hasAgreedReturnPolicy = localAgreed || profileData?.data?.hasAgreedReturnPolicy` → 后者永远 undefined → falsy
- 退出 checkout → agreedRef 随组件 unmount 清零 → 重进 → profileData 也读不到 true → 弹窗再次弹出

P1 修 11ed366（getProfile 加 phone/wechatNickname）时**漏了顺手补 hasAgreedReturnPolicy**。

### Bug 7 1 秒失败根因（待诊断日志确认）

好消息：用户看到"去支付宝支付"屏说明 default import 修复**生效**（旧代码连这屏都看不到，直接 NATIVE_UNAVAILABLE）。但 SDK 调起后 1 秒返回失败 → 当前 `src/utils/alipay.ts` 仅在 catch 里 console.log 异常，**正常返回但 success=false（如 resultStatus=4000）的路径没日志**，无法定位是凭据/签名/网关哪一层错。

按概率排序的可能根因：
1. **沙箱 flag 未真正生效**：`EXPO_PUBLIC_ALIPAY_SANDBOX=true` OTA 命令带了，但 Metro 内联结果不可控（需日志验证）
2. **沙箱凭据 / appId 不匹配** → SDK 验签失败
3. **后端 orderStr 签名/参数有问题**（如金额格式、商品标题特殊字符）

### 修复方案（一次提交，含后端 + 前端诊断）

#### Bug 6 后端补字段
- `backend/src/modules/user/user.service.ts` getProfile return 追加：
  ```ts
  hasAgreedReturnPolicy: user.hasAgreedReturnPolicy,
  ```
- 部署：push staging → 自动重启即可，App 不需要 OTA（前端代码已经在读这个字段）

#### Bug 7 前端加诊断日志
- `src/utils/alipay.ts` `payWithAlipay`：
  - 调 `Alipay.alipay(orderStr)` 前打印 `console.log('[Alipay] orderStr length:', orderStr.length, 'preview:', orderStr.slice(0, 80))`
  - 拿到 result 后 console.log resultStatus + memo + result（success 和 fail 分支都打）
  - 启动 sandbox 时打印当前的 `process.env.EXPO_PUBLIC_ALIPAY_SANDBOX` 真实值（验证 OTA 是否正确内联）
- 部署：OTA 推一次（仍带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true`）

#### 真机验证流程
1. 后端 push 推完先验证 Bug 6（提交订单 → 同意弹窗 → 退出 → 重进 → 不再弹）
2. OTA 推完冷启动两次，再触发支付 → USB+adb 抓日志 `adb logcat | grep -i alipay`
3. 把日志贴回来，定位 Bug 7 真因（凭据/签名/沙箱 flag）

### 状态
✅ 已补丁完成（commit 9f98eb0 后端 + 526f4a2 + 23db438 前端，未推 staging）

---

## P5 真机验证后第一轮：Bug 7 第二个隐藏根因（2026-04-30 用户深查）

### 用户分析（已逐行核对，全部坐实）

第一次"支付触发失败"和第二次"去支付宝支付 → 1s 失败"是**两个独立 bug**，需要分别处理。

#### Bug 7-A：默认 paymentMethod = 'wechat' 导致第一次必定失败

| 位置 | 代码 | 后果 |
|---|---|---|
| `app/checkout.tsx:56` | `useState<PaymentMethod>('wechat')` | 默认选微信 |
| `backend/src/modules/order/checkout.service.ts:19-23` | `CHANNEL_MAP = { wechat:'WECHAT_PAY', alipay:'ALIPAY', bankcard:'UNIONPAY' }` | 前端小写转后端枚举 |
| `backend/src/modules/order/checkout.service.ts:112` | `if (session.paymentChannel === 'ALIPAY' && ...)` 才生成 orderStr | **微信/银行卡渠道 paymentParams = {} 空** |
| `app/checkout.tsx:329` else 分支 | `OrderRepo.simulatePayment(merchantOrderNo)` | 非支付宝走模拟支付 |
| `app/checkout.tsx:333` | `show({ message: '支付触发失败，请稍后重试' })` | simulatePayment 在 staging/prod 拒绝 → 弹这条 |

**完整故障链**（用户第一次提交场景）：
1. 进 checkout，`paymentMethod = 'wechat'`（默认）
2. 用户没改直接点提交 → 前端发 `paymentChannel: 'wechat'`
3. 后端 `CHANNEL_MAP['wechat'] → 'WECHAT_PAY'` 落库
4. 后端 line 112 判 `=== 'ALIPAY'` → false → `paymentParams = {}`
5. 前端 `paymentParams?.channel === 'alipay'` → false → 走 simulatePayment
6. simulatePayment 在生产环境被拒 → 弹"支付触发失败"

**注**：之前我把"支付触发失败"完全归到 alipay 接入问题，**漏看了 paymentMethod 默认是 wechat**。这是 P1 漏的第三个 bug。

#### Bug 7-B：第二次"去支付宝支付 → 1s 失败"才是真正的 alipay SDK 调用失败

用户第二次显式选了支付宝，所以走到了 `payWithAlipay()` → 看到"去支付宝支付"屏 → SDK 1s 后返回 fail。这才是 commit b6358cc 修复后剩余的真问题（沙箱凭据/orderStr/网关之一），需要诊断日志才能定位。

### 修复方案（一次提交三组改动）

#### Bug 6 后端补字段
- `backend/src/modules/user/user.service.ts` getProfile return 追加 `hasAgreedReturnPolicy: user.hasAgreedReturnPolicy`

#### Bug 7-A：禁用未接入渠道 + 默认改支付宝（推荐 A+B 组合）
- `app/checkout.tsx:56` 默认值 `'wechat'` → `'alipay'`
- `src/constants/payment.ts` 给 paymentMethods 加 `available?: boolean` 字段：
  - alipay: `available: true`
  - wechat: `available: false, comingSoon: 'v1.1 上线'`
  - bankcard: `available: false, comingSoon: 'v1.2 上线'`
- `app/checkout.tsx:699-` 渲染时：
  - `available === false` 的 radio 灰掉（opacity: 0.5）
  - 标签后追加"暂不支持"小字
  - `onPress` 时 toast "暂不支持，请选支付宝"，不调 setPaymentMethod

#### Bug 7-B：诊断日志（用 adb logcat 抓真因）
- `src/utils/alipay.ts` `payWithAlipay`：
  - 调 `Alipay.alipay()` 前打印 `console.log('[Alipay] orderStr length:', orderStr.length, 'preview:', orderStr.slice(0, 80))`
  - 拿到 result 后 `console.log('[Alipay] result:', JSON.stringify(result))`，success/fail 分支都打
- `src/utils/alipay.ts` `initAlipayEnv`：
  - 打印当前 `process.env.EXPO_PUBLIC_ALIPAY_SANDBOX` 真实值（验证 OTA Metro 是否正确内联）

### 部署节奏
1. 改三组代码 + commit
2. push staging → 后端 Bug 6 自动部署
3. OTA 推一次（带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true`）
4. 用户冷启动两次
5. 验证：
   - Bug 6：提交订单 → 同意弹窗 → 退出 → 重进 → **不应再弹**
   - Bug 7-A：进 checkout → 看到默认选了支付宝 + wechat/bankcard 灰掉
   - Bug 7-B：选支付宝 → 提交 → USB+adb `adb logcat | grep -i "Alipay"` 抓日志 → 贴回来

### 状态
✅ 已补丁完成（Bug 6=9f98eb0 / 7-A=526f4a2 / 7-B=23db438 / 用户审查 High+Medium=4ab674a / Low=本 commit）

### 用户审查 finding 收口（4ab674a + 本 commit）

P5 第一轮补丁完成后用户基于代码再次审查，发现 4 个 finding：

| # | 等级 | 问题 | 处理 |
|---|------|------|------|
| F1 | High | 后端 SDK 失败时 paymentParams={} 仍走 simulatePayment fallback → 复现"支付触发失败"，影响主结算 + VIP 两个分支 | 4ab674a：加 `else if (paymentMethod === 'alipay')` 显式判后端 SDK 失败场景，toast "支付服务暂不可用" + cancel session |
| F2 | Medium | NATIVE_UNAVAILABLE 在 release APK 也走 simulate fallback → 必失败装作"支付触发失败" | 4ab674a：用 __DEV__ 区分 dev 走 simulate / release 直接 toast "支付组件不可用，请更新 App" |
| F3 | Low | alipay.ts 诊断日志含签名参数，不应长期保留 | 本 commit：加 `⚠️ TODO(沙箱诊断专用)` 注释 + 上线前必移除/加 debug flag 提醒 |
| F4 | Low | 文档状态仍写"待补丁"+ bankcard 版本号 v1.1/v1.2 不一致 | 本 commit：状态改为"✅ 已补丁完成"+ 文档 bankcard 改 v1.2 与代码一致 |

副作用：F1+F2 修复后，"支付触发失败"这个含糊文案彻底消失。每种失败场景都有具体原因：
- 用户取消 → "已取消支付"
- SDK 4000 失败 → "支付失败，请重试"
- 后端无 orderStr → "支付服务暂不可用，请稍后重试或联系客服"
- 原生模块缺失（release）→ "支付组件不可用，请更新到最新版 App 后重试"
- Expo Go 模拟支付失败 → "模拟支付失败（Expo Go 开发环境）"
- 非 alipay 渠道（理论不会发生，防御）→ "当前支付方式暂未开通，请使用支付宝"

---

## P5 真机验证后第二轮（2026-04-30，第一轮 5 commit 仍在本地待推）

### Bug 3 复发：Android 三键虚拟键 OEM bug

**用户实测**：换一台手机（华为，三键虚拟键 ← / ○ / □）打开 AI 买买页，
下面 tab bar 的"首页 / [中] / 我的"label **仍被系统按钮覆盖**（截图显示
label 上半部分可见、下半部分被系统按钮挡住）。

**根因**：commit 3ecab89 用 `height: 56 + insets.bottom`，但部分华为/小米/
OPPO 机型的三键虚拟键模式下 `useSafeAreaInsets().bottom = 0`（OEM 没正确
实现 WindowInsets API），即使 Expo SDK 54 默认 edge-to-edge。退化成
height=56 没 padding → 系统按钮覆盖 label。

**修复（commit fc9a493，纯 OTA）**：
```ts
const safeBottomPad = Platform.OS === 'android'
  ? Math.max(insets.bottom, 32)
  : insets.bottom;
tabBarStyle: {
  height: 56 + safeBottomPad,
  paddingBottom: safeBottomPad + 4,
}
```
- Android 强制 32dp 底部 padding（覆盖三键虚拟键约 48dp 高度的下半段）
- iOS 不受影响（home indicator 走 insets.bottom 正常返回 ~34dp）
- 老的有 insets 正确返回的 Android（gesture bar / 现代机型）走 max 取大值不变

### 状态
✅ 已补丁完成（commit fc9a493，本地未推）

待第一轮 + 本轮共 6 个 commit (9f98eb0 / 526f4a2 / 23db438 / 4ab674a / 08cdb3b / fc9a493) push + OTA 后继续验证。后续新问题在此段追加。
