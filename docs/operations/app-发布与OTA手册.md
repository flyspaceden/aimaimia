# 爱买买 App 发布与 OTA 操作手册

> 本文档是 App 维度的**操作权威来源**。任何关于"改了 App 代码该怎么更新""OTA 怎么推""APK 怎么打包""测试人员怎么装"的问题，**先查这里**。
>
> 本文档**不**重复 `docs/operations/版本管理.md` 已经讲过的 Git 分支策略与三阶段发布概念，那些内容请直接参阅原文。

---

## 一、最重要的一条

**用户手机上的 App 不会因为你 `git push` 而自动更新。**

- 网站：`git push` → GitHub Actions → 服务器自动 `git pull` + 重启 → 用户刷新就看到新版
- App：`git push` → GitHub Actions **不部署 App**（workflow 里故意没配，见 `.github/workflows/deploy-website.yml`）→ 用户什么都看不到

App 上线必须**手动**走 EAS：要么推 OTA（覆盖 JS 改动），要么重新打包（覆盖 native 改动）。

---

## 二、OTA vs Build 决策表（最关键）

每次改完 App 代码，先问自己：**改的内容会不会影响 native 二进制？**

### 走 OTA（`eas update`）—— 90% 的迭代

只动 JS / TS / 前端资源时用，**几分钟全员到位**：

- `app/` 下任何路由页面
- `src/` 下组件、theme、repos、store、services、hooks
- `node_modules/` 下纯 JS 库的版本变化（无原生代码）
- `require()` 引用的图片、字体、JSON 数据
- 文案、样式、业务逻辑、API 调用、状态管理
- 修 Bug、加新页面、改交互

### 必须 `eas build` —— 10% 的迭代

任何下列改动 OTA **推不动**，硬推 = 用户白屏 / 闪退：

| 改动 | 为什么 OTA 不行 |
|---|---|
| `app.json` / `eas.json` 任何字段 | 打包时编译进 AndroidManifest / Info.plist |
| 图标 / splash / 应用名 / 包名 | 同上，在 native res/mipmap 里 |
| `package.json` 新增/升级**带原生代码**的库（`react-native-xxx`） | 原生 .so / .framework 在 APK 里 |
| `plugins/` 下任何 config plugin（含 `withWechat.js`） | 同上 |
| Android `intentFilters` / iOS `associatedDomains` | 写在 manifest，不在 JS bundle |
| 升级 Expo SDK / RN / Hermes | 整条原生工具链都变了 |
| 改 keystore / 签名 | OTA 完全没办法 |

### 最简判断口诀

> **需要重新跑 `npx expo prebuild` 才能看到效果的改动 = 必须 `eas build`。其他都走 OTA。**

---

## 三、EAS 命令速查

### 推 OTA（最常用）

```bash
# 推 preview 环境（给测试人员用）
EXPO_PUBLIC_ALIPAY_SANDBOX=true eas update --branch preview --message "修复xxx / 加xxx功能"

# 推 production 环境（线上正式版）
EXPO_PUBLIC_ALIPAY_SANDBOX=false eas update --branch production --message "修复xxx"

# 不建议同时推 preview + production：支付宝沙箱开关不同，先 preview 验，再 production
```

### 查 OTA 历史

```bash
# 看 preview branch 最近 5 次推送
eas update:list --branch preview --limit 5

# 看每次推送的 group ID、提交人、时间、commit message
# Group ID 是回滚需要的关键 → 必须能找到稳定版本的 group ID
```

### OTA 回滚（紧急）

```bash
# 把某个旧 group 重新发布，盖掉当前坏的版本
eas update:republish --group <旧的稳定 Group ID>

# 实际案例（2026-04-20 微信白屏事故）：
# eas update:republish --group 92035e48-aad4-4616-a16c-73ccd4a2676f
```

### 重打 APK / IPA

```bash
# Android preview APK（25 分钟左右）
eas build --profile preview --platform android

# Android 上架包（AAB 给应用商店）
eas build --profile production --platform android

# iOS preview（需要 Apple Developer 账号，目前未启用）
eas build --profile preview --platform ios
```

### 查 Build 历史

```bash
eas build:list --limit 5 --status finished
# 关注：Profile / Channel / Commit / Application Archive URL（APK 下载链接）
```

### 提交应用商店

```bash
# 自动提交到 Google Play Internal Track / TestFlight
eas submit --profile production --platform android
eas submit --profile production --platform ios
```

---

## 四、OTA 推送前 Checklist（强制）

**踩过白屏事故，按此 SOP 推**：

### 第一关：本地验证

```bash
# 1. TypeScript 编译（CI 等效）
npx tsc -b --noEmit

# 2. 干跑 bundle 编译（只能验语法，不验运行时）
NODE_ENV=production npx expo export --platform android
```

两者都通过 = bundle 不会因语法错误 / 类型错误炸。但**不能保证运行时不炸**。

### 第二关：模块顶层副作用自查

打开本次改动涉及的所有 `.ts/.tsx` 文件，**模块顶层（import 后直接执行的代码）**只允许：
- ✅ `import` / `export`
- ✅ 函数定义、类型声明
- ✅ `const x = 简单字面量`

**绝对禁止**：
- ❌ 顶层 `NativeModules.X = NativeModules.Y`（赋值可能抛 → 整个 import 链崩）
- ❌ 顶层调用任何可能抛的函数
- ❌ 顶层访问可能未就绪的全局对象（如 `window`、`document`）

> 详见记忆 `feedback_ota_top_level_side_effects.md`。这条是 2026-04-20 用一次白屏事故换来的。

### 第三关：涉及原生模块时分步推

如果本次 OTA 改动涉及 `NativeModules` / `react-native-*` 原生库 / config plugin **的 JS 调用代码**：

1. **先单独推一个绝对安全的 OTA**（比如改个文案、加个 console.log），证明基线没问题
2. **再单独推涉及原生层的 OTA**，便于事故定位
3. 一次推全部 = 闪退时无法定位是哪个改动是凶手

### 第四关：双层 try/catch 降级

涉及原生模块的代码用：

```ts
function risky() {
  try {
    // 内层兜赋值/defineProperty 失败
    try { nm.WeChat = nm.RCTWeChat; }
    catch { Object.defineProperty(nm, 'WeChat', { value: nm.RCTWeChat, configurable: true, writable: true }); }
    return true;
  } catch {
    // 外层兜 require/调用失败
    return false;
  }
}
```

最坏情况返回 false → 上层"功能不可用"提示，**绝不让 bundle 崩**。

### 第五关：响应式 / 大字体 / 虚拟键审计

只要本次 OTA 改了 `app/` 页面、`src/components/` 组件、底部固定栏、支付/提交结果页、购物车/结算/订单链路，就必须按 `docs/architecture/responsive-design.md` 复核：

```bash
# 大字体 / 固定宽度 / 底部栏 / row+flex / 返回键拦截巡检
rg -n "Dimensions\\.get\\(['\"](?:window|screen)['\"]\\)" app src
rg -n "width: [2-9][0-9]{2,}" app src
rg -n -B2 -A2 "fontSize: [2-9][0-9]" app src
rg -n -B1 -A8 "position: 'absolute'" app src | rg -B3 -A8 "bottom: 0"
rg -n -B3 -A10 "flexDirection: 'row'" app src | rg -B3 -A10 "flex: 1"
rg -n "BackHandler\\.addEventListener|hardwareBackPress" app src
rg -n "=>\\s*true|return true" app src
rg -n "gestureEnabled" app src
```

命中不要求机械清零，但必须逐项确认属于“已保护 / 需修 / 可豁免”。结果页（如支付成功）必须在 Android 大字体 + 显示大小偏大 + 虚拟三键场景下确认 CTA 可滚动可点击，物理返回键有安全去向；iOS 危险左滑返回必须禁用。底部固定栏页面必须确认正文底部留白来自实际 bar 高度或保守测量，不只依赖固定估算。

---

## 五、用户侧：OTA 什么时候生效

### 5.1 旧默认（`fallbackToCacheTimeout: 0`，已废弃）

```
你跑 eas update → 用户第一次开 App 看的是嵌入版（旧）
后台下 OTA → 用户必须杀进程再开 → 第二次冷启动才生效
```

> 这是 expo-updates 的默认行为，但 **新装用户体验极差**：他们没有"杀进程再开"的经验，会一直看到旧版本。

### 5.2 当前配置（`fallbackToCacheTimeout: 5000`，2026-05-09 起）

```
你跑 eas update
    ↓
用户冷启动 App
    ↓
native splash 阻塞最多 5 秒等 OTA 拉取
    ↓
拉到 → 直接用新 bundle 启动 ✅（首次启动看到的就是最新版）
超时 → 回退到嵌入版（OTA 异步下完应用到下次冷启动）
```

**关键事实**：
- 新装用户**第一次冷启动**就能看到最新版（前提：5s 内拉到 OTA）
- 弱网用户最多等 5s 看 splash，超时后回退（不会卡死）
- 已下载的 OTA 应用到下次冷启动（与原默认一致）
- **此配置烧进 AndroidManifest.xml**（`EXPO_UPDATES_LAUNCH_WAIT_MS=5000`），改回 0 必须重新 `eas build`，OTA 推不动

### 5.3 冷启动 /resolve 加速（2026-05-09 配套）

`app.ai-maimai.com/resolve`（推荐码 deep link 落地页）从 React SPA 改为纯静态 HTML：
- 跳过 React bundle 加载（省 1-2 秒）
- fetch 加 3 秒超时，后端卡死时不傻等到 App 端 5 秒 hard cap
- 实施位置：`website/scripts/resolve.template.html` + `website/scripts/build-resolve.mjs`
- 部署：网站改动，`npm run build` 自动产出 `dist/resolve/index.html`，无需重打 APK
- 测试覆盖：`website/scripts/__tests__/resolveLogic.test.mjs`（14 个用例，CI 必跑）

### 5.4 回滚

| 想撤回 | 怎么办 |
|---|---|
| `fallbackToCacheTimeout: 5000` 改回 0 | 改 app.json + 必须重新 `eas build`（不能 OTA） |
| `/resolve` 静态 HTML 还原回 React | 删 `prebuild` 钩子 + 删 `dist/resolve/`，下次部署 React 路由生效 |

---

## 六、当前 App 实际状态（2026-05-18）

### EAS 配置

- Project ID: `d76ba8ac-06f3-45d2-b674-afec17737029`
- Owner: `flyspaceden`
- Slug: `ai-aimaimai`
- Updates URL: `https://u.expo.dev/d76ba8ac-06f3-45d2-b674-afec17737029`
- Runtime version policy: `appVersion`（当前 0.2.0）

### 三档 Profile（见 `eas.json`）

| Profile | Channel | API URL | 包格式 | 用途 |
|---|---|---|---|---|
| development | development | test-api | dev-client | 开发调试 |
| preview | preview | test-api | apk | 测试人员内部分发 |
| production | production | api（生产） | aab | Google Play / 国内商店上架 |

### 最近一次 Build

- ID: `684e3826-1565-484f-809e-082f1a164ffc`
- Profile: preview / Platform: Android
- Commit: `6cb421b`（2026-04-20）
- Version: 0.2.0
- APK URL: `https://expo.dev/artifacts/eas/dT3CL8mC2hUEiewNDJgLxN.apk`
- ⚠️ **此 APK 内嵌的 wechat.ts 是 broken 版本**（`NativeModules.WeChat` 检查失败），修复仅在 OTA 中

### 当前安卓测试分发入口

- 蒲公英测试页：`https://www.pgyer.com/aimaimai-android-test`
- 推荐码落地页：`https://app.ai-maimai.com/r/{CODE}` 仍然是唯一推荐二维码入口；该页会先记录推荐码，再展示/跳转蒲公英测试下载页。
- 网站代码位置：`website/src/pages/Download.tsx`；默认下载链接在 `website/src/lib/downloadLinks.ts`，可用 `VITE_ANDROID_TEST_DOWNLOAD_URL` 覆盖。

### Preview Branch 最近 OTA 历史（按时间倒序）

| Group ID | 内容 | 备注 |
|---|---|---|
| `c0faa525-0049-4cda-a178-1220e8fa7d45` | invoices 3 页根本性修复 + helper 收口：真机回归发现根因不只是 OEM inset 而是布局——`<Screen flex:1>` 下 `ScrollView/FlatList` 没有显式 `style={{ flex: 1 }}` 时取自然内容高度，短内容场景（EmptyState/单条目）会让 flex 兄弟底部栏贴在 ScrollView 后面（页面中部）而非屏幕底部。修复 `invoices/request.tsx` + `invoices/profiles.tsx` + `invoices/index.tsx` ScrollView/FlatList + EmptyState wrapper 全部加 `flex: 1`；同时 `src/theme/responsive.ts` `useBottomInset` 取消 edge-to-edge 检测（华为 HarmonyOS / 小米 MIUI 上不可靠），Android 改用无条件 `Math.max(insets.bottom, 64)`，fallback 56→64 覆盖华为 split-display；`app/(tabs)/_layout.tsx` 同步。2 Agent 并行审查全 app 54 文件确认其他页面要么 absolute 定位要么内容总是长，**只 invoices 3 页踩坑** | **当前生效** ✅，commit `771d5a1`（2026-05-20），纯 JS/TS 无原生改动；Android update `019e4829-dca0-7ed1-b9ca-c940a6dd2fee`，iOS update `019e4829-dca0-7b95-a160-1b4998125a5c`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `35b27464-0588-4144-b488-d7b348b66719` | 全 app 底部按钮 safe-area 收口（4 Agent 并行审查 55 文件后定位）：`me/referral.tsx` 非 VIP 容器 + 双按钮（扫描推荐码 / 了解 VIP）补 inset；`ai/recommend.tsx` 购物车 FAB 之前硬编码 `bottom: 90` 改用 `useBottomInset(40)`；`invoices/index.tsx` "管理发票抬头" 底部入口补 `paddingBottom + bottomInset`；`invoices/profiles/edit.tsx` ScrollView paddingBottom 改用 `useBottomInset(40)` | commit `e97a5d2`（2026-05-20），纯 JS/TS 无原生改动；Android update `019e46b2-cdc1-7160-b722-29834e73fc29`，iOS update `019e46b2-cdc1-7f92-b5c8-a64a7fd33362`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `d4168d69-57e0-4457-9ea8-191452e0c628` | R-RS-LF02 followup：`ANDROID_NAV_FALLBACK` 32→56dp（src/theme/responsive.ts + tabs/_layout.tsx 同步），修复用户在华为 3 键真机反馈"发票抬头管理 / 申请发票 底部按钮被虚拟键挡住"。同时给 `app/invoices/profiles.tsx`「新建抬头」按钮补 `useBottomInset(0)` + `compactActionTextProps`（这页历史上一直在干净文件清单里没改） | commit `0c51049`（2026-05-20），纯 JS/TS 无原生改动；Android update `019e468d-8d23-7eef-b648-406bb4d9dd0d`，iOS update `019e468d-8d23-7d59-b39f-b99a8af5000a`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `1a895d0f-8d07-4880-a3e0-e047c20dde69` | 关于爱买买页面更新：联系邮箱改为 `zenghaifeng13@163.com`，删除「微信客服」占位行与简介「当前为前端占位内容。」尾巴，简介补充「农产品信用确权」，备案号更新为「粤ICP备2023047684号-6A」 | commit `e84fcab`（2026-05-19），纯 JS/TS 无原生改动；Android update `019e3e78-0242-7595-bc37-7c5315164307`，iOS update `019e3e78-0242-7684-8bba-5c4c9f4a7808`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `ef72a077-c628-4c06-ab2f-ce26490a2988` | 商品卡片小格新增「仅剩 x 件」红色徽章（≤ `LOW_STOCK_DISPLAY_THRESHOLD`，默认 10）+「已售罄」黑灰徽章（stock=0）+ 月销行追加「· 限购 x 件」+ 售罄态加购按钮灰化禁用；新增 `src/hooks/useAppConfig` 统一封装阈值读取；Product / CompanyProduct 类型新增 stock / maxPerOrder；6 个 ProductCard 使用页面（museum / search / category / cart 推荐 / company / ai-recommend）全覆盖 | commit `fff5a60`（2026-05-18，含 admin 低库存提示位置 hotfix，不入 App bundle），App 端实际由 `89cfd34` 提供；纯 JS/TS 无原生改动；Android update `019e3e60-3a0a-7099-9203-27ccbf598d11`，iOS update `019e3e60-3a0a-7b35-9f7f-cdc5c1341022`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true`；**后端依赖**：3 个列表接口（product.list / recommendation.getForUser / company.listCompanyProducts）需要 staging deploy 完成才会返回 stock / maxPerOrder 聚合字段，否则卡片软降级（无字段 → 不显示徽章/限购） |
| `fc282546-a7dc-4094-ae9b-c544f82b95de` | R-RS-LF01/LF02 大字体二轮适配：支付成功页 ScrollView 逃生 + Android 安全返回（VIP 流分支）+ iOS gestureEnabled:false；StickyCTABar / cart / checkout / product / vip-gifts / checkout-pending / orders-detail / checkout-coupon 改用 `useMeasuredBottomBar` onLayout 测高 + compact 纵向堆叠；me 页用户卡/订单 5 项/钱包 VIP 双卡按 `isLargeText` 降级；lottery 结果 BottomSheet `scrollable` + 默认字号保留 AiTypingEffect 大字号静态降级；invoices/request 底部按钮吃 safe area | commit `08d091e`（2026-05-18），纯 JS/TS 无原生改动；Android update `019e3d3a-0d5c-7ac6-ac3e-a0a279858e53`，iOS update `019e3d3a-0d5c-7417-8cb0-33574ba418fc`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true`；🟡 待 §4 10 场景真机矩阵验收 |
| `51e6eec3-c0a4-4d2c-ad42-abfbcf08649b` | VIP 礼包订单金额显示修复：订单明细赠品行显示“赠品”而非 SKU 单价，底部实付以后端 `totalPrice` 为准 | commit `b97e3dd`（2026-05-18），App 前端为纯 JS/TS；配套后端同 commit 含 VIP_PACKAGE 金额建单修复 + 历史数据迁移，需 staging deploy 完成后旧单金额才会回填；Android update `019e3c69-b37f-7c4d-bcc6-10dc8cc18fbc`，iOS update `019e3c69-b37f-7084-9268-a6396a901c5f`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `156273ed-3727-495f-8c5a-cb45d084b444` | 推荐码页移除"购买 VIP 前可扫描好友推荐码完成绑定"提示；VIP 礼包购买页移除赠品卡片"市场参考价"展示 | commit `a48bbee`（2026-05-16），纯前端；Android update `019e317d-c669-79d8-ab1d-c84606bf20b9`，iOS update `019e317d-c669-7d65-bf36-ca4fa0c1a996`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `5c40a02a-5b04-4af2-8f67-c8c9f8c7986d` | 我的页常用工具移除"奖励"入口；钱包入口保留在上方钱包卡，常用工具第一项仍为"我的推荐码/推荐关系" | commit `1d779f2`（2026-05-15），纯前端；Android update `019e2ea0-acef-7472-a66c-c132130cf8e2`，iOS update `019e2ea0-acef-7b73-98a2-1328e7cd19d8`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `eb76ecaa-0a10-44e5-ac30-31e915479a9d` | 我的页常用工具新增固定推荐入口：VIP 且有推荐码显示"我的推荐码"，普通用户/暂无 VIP 推荐码显示"推荐关系" | commit `6c21337`（2026-05-15），纯前端；Android update `019e2e9c-6c54-7e65-8ce1-0d789022907e`，iOS update `019e2e9c-6c54-7b81-91c5-90b47ec8106f`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `88967615-b7f0-4019-8f1b-dae236514180` | 推荐码改造（合 87fe8ca + ca77796）：非 VIP `referralCode=null` + 历史普通码绑定/DDL 拒绝 + 推荐码页/会员中心展示绑定推荐人 + 扫码 toast 显推荐人；后续修复 `buildInviterSummary` try/catch + `verified+orderBy` 稳定取手机号 + 前端 `referralRelation` helper 用 `inviterUserId` 判定（避免 user 摘要为空时误判"尚未绑定"） | commits `87fe8ca` + `ca77796`（2026-05-15），含后端改动需 staging deploy；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `646330a6-3a07-4e66-9ca1-6ee2ed28dd48` | 首页非 VIP 礼包推广位：移除礼包卡片底部「当前主推 / 参考价」栏，仅保留价格、标题、赠品组合和数量 | commit `07783c1`（2026-05-15），纯前端，后端无改动 |
| `1d8f952b-769c-4b06-8df4-858b137d0af8` | 发票链路买家端：「我的」tab 加「我的发票」入口；订单详情新增发票区块（申请/查看/取消/重新申请 + 失败原因）；已开票 PDF 用 `expo-web-browser` 打开（不再只 toast）；取消后联动失效 `invoices/invoice-detail/order/orders` 四个 query | commits `9bf17c2` + `2dffa4f`（2026-05-14），纯前端，对应后端发票链路收口同步在 staging；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `b8077df1-5d07-4f48-92f8-ec6d085ad048` | 首页非 VIP 礼包推广位：未登录/普通用户在搜索框下方横滑展示后台 VIP 档位主推赠品组合（价格/赠品标题/商品 SKU 行/参考价），点击携带 `packageId`+`giftOptionId` 进 `/vip/gifts` 并自动定位档位+赠品 | 已被 `646330a6-3a07-4e66-9ca1-6ee2ed28dd48` 覆盖底部文案展示，commit `19c0139`（2026-05-14），纯前端，后端无改动；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `d7606eca-67db-4b5a-8e74-10831778bd64` | `/r/{CODE}` App Link 承接页：已装 App 扫推荐码二维码 → 触发后端绑定 + 2 秒 toast（"推荐码已绑定" / "推荐码已记录"）→ 自动回首页；纯 UI 反馈层，绑定逻辑仍由 `_layout.tsx` 全局 Linking 监听统一处理 | commit `a386196`（2026-05-14），纯前端，后端无改动 |
| `65b0df76-94db-4d7c-ae3a-7af47d66868e` | 我的页换货/售后角标修复:后端 getStatusCounts 早就在返回 afterSale 字段(活跃售后订单数派生态),前端 OrderRepo 类型漏写 + me.tsx 死值 0 → 修补类型 + 改读 orderCounts.afterSale | commit `ae3c3ef`(2026-05-10),纯前端,后端无改动 |
| `e288de75-0587-410e-a1bb-ce0801da0c99` | 售后链路 fix 三件套:1)买家详情页加商家展示(后端 findById 走 sku→product→company);2)卖家列表去掉"开始审核"中间步,REQUESTED 直接显示通过/驳回;3)卖家列表加售后单号模糊搜索(contains) | commit `8222fb3`(2026-05-10),含后端改动需 staging deploy |
| `066ffc01-4686-46c8-844b-2697e9f8010c` | 售后申请页 perf:照片串行 for-await 改 Promise.all 并行,3 张从 6-9s 压到 2-3s,2-3x 提速;overlay 文案改"正在并发上传 N 张/已完成 X/Y" | commit `7abf81f`(2026-05-10),纯前端,后端无改动 |
| `958e7449-c577-41d3-994d-747bcc72ed08` | 售后申请页 UX 跟修:照片上传期间全屏 loading mask + "正在上传 X/Y" 进度计数 + "请勿关闭页面"提示;absolute zIndex 999 阻止用户点击穿透到下层按钮 | commit `f79a281`（2026-05-10），纯前端，后端无改动 |
| `69c6715f-5e4f-4916-b0d1-a73fddef0864` | 售后申请页 hotfix：Step 2 修飞出边界改 2x2 grid；Step 3 改 ApiClient.upload 修 401 静默失败；Step 4 双模（质量类标题改"具体问题"+必选 reasonType；无理由类新增整步 6 chip 多选）；详情页 PhotoTile 加载失败兜底 | commit `e8b6b2c`（2026-05-10），纯前端，后端无改动 |
| `53c91268-d410-443f-a12a-96697863b64e` | 售后链路收口：四类售后类型含 `NO_REASON_EXCHANGE`、顺丰退货面单、买家付退货运费（`AS_SHIP_PAY_*` 前缀，沙箱可测）、退款失败转人工处理文案、三端接线 | commit `f05a20c`（2026-05-10），合入 49 commits；需配合后端同 commit（5 个新服务 + 4 类幂等键 + 43 处 Serializable + 双向一致性 cron）；详见 `docs/superpowers/plans/2026-05-09-after-sale-chain-closure.md` |
| `403330a2-17d0-4404-92fc-0d3bcc132eac` | 地址三级联动 Picker：替代 6 个 TextInput 手打省/市/区，引入 137KB pca-code 行政区划数据 + RegionPicker 组件 + regionCode 标准编码全链路 | commit `9d8d0c1`（2026-05-09）|
| `f0e9a56c-e598-4554-a141-d3e19d944ada` | 订单再次购买功能：已完成订单一键加回购物车 + 详情/列表入口 + 双击防护 | commit `ec27a75`（2026-05-08），需配合后端同 commit（复购 API + 幂等 + 购物车写入）；详见 `docs/superpowers/plans/2026-05-08-order-repurchase.md` |
| `ebf7997d-87fc-4bbf-8af5-67dcba49806e` | PAID 未发货取消退款链路收尾：取消按钮 disabled 视觉反馈 + 6 种 RefundStatus 文案 + VIP 礼包禁取消 + StatusHero 取消后副文案 | commit `db3121c`（2026-05-08），需配合后端同 commit（refundSummary DTO + advisory lock + 30s 节流 + CAS + P2002 兜底）；详见 `docs/superpowers/plans/2026-05-08-unshipped-order-cancel-refund.md` |
| `5a290685-ad7b-4b68-87c6-6226b8148702` | 修复商品下架后购物车幽灵奖品（删不掉/付不掉/过不掉）+ unavailableReason 全链路透传 + 抽奖配额回归 | commit `05018bf`（2026-05-08），需配合后端 5 commit（280e6c1..05018bf）；详见 `docs/issues/app-tofix4.md` |
| `32bb1433-40c7-407c-80ff-ec00d792e570` | Bug 91：取消订单 Alert 二次确认 + cancelingRef 双层防重 + "取消中..." 文案；售后预估 estimatedRefund 与后端 calculateRefundAmount 完全对齐（红包+奖励+VIP 三类抵扣按比例分摊）| commit `f5a75df`（2026-05-07）|
| `cb8d9e03-503c-483c-acf4-18175d6bb1ed` | 「我的」tab 订单角标 60s 轮询 + 详情/物流/列表页 useFocusEffect 自动刷新 | commit `5037c20`（2026-05-06）|
| `6494573b-e0a5-489f-b5b0-12a8b01220b2` | 「我的」tab 订单快捷入口补漏「已发货」第 5 项 | commit `fe34eb2`（2026-05-06）|
| `01f8a817-9810-4d39-b496-de05763d2ebc` | 订单 5 tab 拆分：待发货/已发货/待收货/售后/已完成（之前 SHIPPED+DELIVERED 合并在「待收货」），配套后端 SHIPPED→exact match | commit `9d8dcfa`（2026-05-06）|
| `01c1a667-aed8-4fed-a5bd-f068c966b6c6` | SHIPPED 标签从"运输中"改"已发货"（OrderCard+StatusHero）+ 删物流追踪页"产地实景联动"占位 | commit `6eb6d19`（2026-05-06）|
| `4e713e73-900f-4900-b813-b418ec663607` | Phase 2 状态枚举大写迁移（OrderStatus lowerCamel→大写）+ findById 不再返 'afterSale' | commit `8d3200f`（2026-05-06）配套后端 STATUS_MAP 删除 |
| `75b52ea0-9b9e-41d2-92f5-6f8eaa1ba907` | 重发带回 alipay sandbox flag（修真机付款"商家订单参数异常"）| commit `39600a1`（2026-05-06）|
| `5da9c55c-0e69-4eb5-af77-3d0c39a4b0ef` | R-RS01-07 响应式适配 sprint 全套 + 2 hotfix | commit `694331a`（2026-05-04）|
| `6d987eeb-d0d0-42ed-be0e-c774ed113a40` | 推荐链路全套修复 + cookie 路径一次性消费 hotfix | commit `e573f14`（2026-05-04）|
| `450d71de-8959-4957-ae18-8367bb5872af` | wechat 别名 v2 | 历史 |
| `92035e48-aad4-4616-a16c-73ccd4a2676f` | DDL 延迟 + referral 兜底 + splash | 稳定基线 |

### Production Branch

**还没创建**（v1.0 未上架）。第一次推时跑 `eas update --branch production` 会自动创建。

---

## 七、新测试人员分发流程

### 一次性给 APK 的流程

1. 把最新 APK 链接发给测试人员（从 `eas build:list` 拿 Application Archive URL）
2. 告知**两条关键事项**：
   - "下载后系统会提示'未知来源应用'，需要在设置里给浏览器/文件管理器打开'允许安装'权限"
   - "**首次安装后需要冷启动两次**：第一次开 App → 完全杀进程（从最近任务清掉）→ 再开第二次。这样能拿到所有最新修复。"
3. 第一次开 App 报问题（比如微信登录失败），先确认是否做了第二次冷启动

### 国内分发现状

- 蒲公英：测试分发页已启用，当前 URL 为 `https://www.pgyer.com/aimaimai-android-test`
- fir.im：未启用
- 应用商店（华为 / 小米 / 应用宝）：需要软著 + App 备案，未启动
- 当前安卓测试人员可通过推荐码落地页或蒲公英测试页安装；如蒲公英受限，再回退为直接发 EAS APK 链接。

### 备案启动后的方案（待 v1.0）

参考 `docs/operations/app-compliance-guide.md`。

---

## 八、推 OTA 还是 Build 的判断流程图

```
改完 App 代码
    │
    ├── 改了 app.json / eas.json / package.json 原生依赖 / plugins/?
    │       └─ YES → eas build
    │
    ├── 改了图标 / splash / 应用名?
    │       └─ YES → eas build
    │
    ├── 改了 native 配置（intentFilters / associatedDomains）?
    │       └─ YES → eas build
    │
    └── 都没有？
            └─ eas update --branch <环境>
                 │
                 ├── 涉及 NativeModules / 原生库 JS 调用?
                 │       └─ YES → 分步推（先安全 OTA → 再原生层 OTA）
                 │
                 └── 仅改了 UI / 文案 / 业务逻辑?
                         └─ 直接推
```

---

## 九、回滚速查

### OTA 回滚（秒级）

```bash
# 1. 查最近的 group，找上一个稳定版本
eas update:list --branch preview --limit 10

# 2. republish 那个 group
eas update:republish --group <稳定版 Group ID>

# 用户下次冷启动会拿到这个"重新发布"的旧版本
```

### APK 回滚（手动）

EAS 不直接支持"撤回 APK"。如果新 APK 有问题：
1. **如果还没分发给用户** → 直接重新打包覆盖
2. **已经分发** → 推 OTA 修补 JS 层问题；如果是 native 问题，重打新 APK 让用户重装

### 应用商店回滚（最慢）

- iOS App Store：Connect 后台可以"暂停发布上一版本"，让新用户回到上个版本（已下载的不变）
- Google Play：可以在 Console 回滚到上一个版本（仅影响新下载）
- 国内商店：各家不同，多数支持下架重新审核

> **App 回滚成本最高 → 上线前必须充分测试**。

---

## 十、何时更新本文档

任何下列动作发生后，**立即更新本文档**：

- 新增一次 `eas build`（在第六章追加 Build 记录）
- 新增一次 `eas update`（在第六章 OTA 历史追加）
- 出现新的 OTA 事故 / 经验教训（追加到第四章）
- 新增 EAS profile / channel
- 改了 runtimeVersion 策略
- 启动备案 / 应用商店上架 → 第七章更新分发渠道

> 配套记忆：`project_app_release_status.md` 跟踪当前 App 实际部署状态（每次 build/update 后更新）。
