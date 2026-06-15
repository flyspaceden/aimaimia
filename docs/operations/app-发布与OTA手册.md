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
# 推 preview 环境（给测试人员用；2026-06-02 起支付宝/微信都走真实链路）
EXPO_PUBLIC_ENV=staging EXPO_PUBLIC_USE_MOCK=false \
EXPO_PUBLIC_API_BASE_URL=https://test-api.ai-maimai.com/api/v1 \
EXPO_PUBLIC_ALIPAY_SANDBOX=false EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true \
  eas update --branch preview --message "修复xxx / 加xxx功能"

# 推 production 环境（线上正式版）
EXPO_PUBLIC_ENV=production EXPO_PUBLIC_USE_MOCK=false \
EXPO_PUBLIC_API_BASE_URL=https://api.ai-maimai.com/api/v1 \
EXPO_PUBLIC_ALIPAY_SANDBOX=false EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true \
  eas update --branch production --message "修复xxx"

# 不建议同时推 preview + production：env 不同，先 preview 验，再 production
```

**必带 env 前缀，否则 OTA bundle 里相关变量是 undefined**：

| Env Var | 不带前缀的后果 |
|---------|---------------|
| `EXPO_PUBLIC_USE_MOCK` | 可能 fallback 到 Mock / 本地开发逻辑，生产 bundle 行为不可控 |
| `EXPO_PUBLIC_API_BASE_URL` | API 目标可能 fallback 到开发/测试默认值，生产 OTA 可能打到错误后端 |
| `EXPO_PUBLIC_ALIPAY_SANDBOX` | 真机付款显示"商家订单参数异常"（详见 memory `feedback_ota_must_prepend_alipay_sandbox.md`） |
| `EXPO_PUBLIC_WECHAT_PAY_AVAILABLE` | 微信支付入口依赖该开关；漏带会导致 Android 入口关闭 |
| `EXPO_PUBLIC_ENV`（2026-05-27 P0 起） | `APP_ENV` fallback 到 `'development'`，红条文案显示"开发环境"而非"测试环境/生产环境"；非生产 build 仍能看到红条但文案细节不对 |

OTA env 和 build env 是**完全分离**的：build 时 `eas.json` 的 env 烧进 native APK + 当时的 JS bundle；OTA 时只看 `eas update` 命令前缀的 env，不会自动从 `eas.json` 读取。

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

## 六、当前 App 实际状态（2026-06-15）

### EAS 配置

- Project ID: `d76ba8ac-06f3-45d2-b674-afec17737029`
- Owner: `flyspaceden`
- Slug: `ai-aimaimai`
- Updates URL: `https://u.expo.dev/d76ba8ac-06f3-45d2-b674-afec17737029`
- Runtime version policy: `appVersion`（当前 `app.json` 为 1.0.3；runtime 随 App version 变化）

### 三档 Profile（见 `eas.json`）

| Profile | Channel | API URL | `EXPO_PUBLIC_ENV` | `EXPO_PUBLIC_ALIPAY_SANDBOX` | `EXPO_PUBLIC_WECHAT_PAY_AVAILABLE` | 包格式 | 用途 |
|---|---|---|---|---|---|---|---|
| development | development | test-api | `development` | `true` | 未配置（等同关闭） | dev-client | 开发调试 |
| preview | preview | test-api | `staging` | `true` | `true` | apk | 测试人员内部分发 |
| production | production | api（生产） | `production` | `false` | `true` | apk（v1.0 暂用） | Google Play / 国内商店上架 |

> **微信支付开关**（2026-06-09 当前配置）：`preview` 与 `production` 档均注入 `EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true`。买家端 `src/constants/payment.ts` 仍额外限制 `Platform.OS === 'android'`，因此 iOS 入口继续灰掉；Android production APK 会展示微信支付入口。若业务决定生产暂缓微信入口，必须先关闭 production profile 的该 env 并重新 build（否则新装用户首启内嵌 bundle 仍会看到入口）。

**环境区分约定（2026-05-27 起，单包名方案）**：

- 包名只有一个（`com.aimaimai.shop`，android/ios 共用），无法在同一台手机同时装测试和生产版本——这是已上架后单包名方案的硬限制
- 三档 profile 通过 `EXPO_PUBLIC_ENV` env var 让 App 运行时知道自己是哪个环境，`src/repos/http/config.ts` 导出 `APP_ENV` / `IS_PRODUCTION` 常量供业务代码判断
- `app/_layout.tsx` 在非生产 build 顶部渲染 22px 红色"测试环境"横条（`src/components/feedback/EnvBanner.tsx`），生产 build 不显示；测试人员一眼分得清装的是哪个版本，避免拿测试 build 当生产 build 反馈 bug
- **测试设备纪律**：测试团队的手机永远只装 internal distribution 的 preview / development build（带红条），真实用户永远从应用商店下载 production build（无红条）；切换环境 = 卸载重装
- 支付宝回调只有一套（生产），preview / development build 的支付宝链路走沙箱（`EXPO_PUBLIC_ALIPAY_SANDBOX=true`，dev/preview 默认开启）。**微信支付 V3 无沙箱**：2026-05-30 起 staging 联调改为在**测试服务器配真实微信商户凭据**（`notify_url` 指向 `test-api`）+ preview build 开 `EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true`，用真账号 0.01 元真金验证（退款也真退回微信钱包）；2026-06-09 当前 production build 也已注入 `EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true`，分发前必须确认生产微信商户凭据、回调和真金退款链路已经具备上线条件

### 本机构建验证记录

#### 2026-06-11 本地 production Android rebuild（1.0.3，抽奖转盘展示修复内嵌包，待分发/提审）

- 类型：`eas build --profile production --platform android --local --non-interactive --output "$(pwd)/apk/正式版/prod-1.0.3-lottery-20260611-222117.apk"`
- Profile: production / Platform: Android / Channel: production
- Commit: `86f5017`（`fix(lottery): 完善抽奖展示和未中奖统计`；main 已通过 `b3e0a8d` merge 发布，同内容。App 内嵌本次抽奖转盘奖品名完整展示 + 奖品实例调色板；后端“谢谢参与”统计修复需服务器部署生效，不属于 APK 内嵌逻辑）
- Version: 1.0.3 / VersionCode: 9 / RuntimeVersion: 1.0.3
- 本地 APK: `apk/正式版/prod-1.0.3-lottery-20260611-222117.apk`（117 MB）；`apk/aimaimai-latest.apk` 已同步为同一文件
- SHA-256: `599630a4ed09fabd79d2a68da9f4044a8c45ae18065b04b81ce48d30d96c96e3`
- 结果：✅ `BUILD SUCCESSFUL in 7m 43s`；`aapt dump badging` 反查 `versionName='1.0.3'` / `versionCode='9'`；`apksigner verify --verbose --print-certs` 通过（v2 签名，证书 MD5 `766bafb6a3b34a678761e4b07e3665c4`）；AndroidManifest 确认 channel 为 `production`，`expo_runtime_version` resource 为 `1.0.3`；APK 内嵌 bundle 二进制搜索确认含本次转盘实例调色板新色值 `#1565C0`
- 64 位校验：✅ `aapt dump badging` 反查 `native-code: 'arm64-v8a' 'armeabi-v7a' 'x86' 'x86_64'`；APK 内 `arm64-v8a` / `armeabi-v7a` / `x86` / `x86_64` 均为 26 个 `.so`，可满足 vivo 等渠道 64 位要求
- 构建前验证：✅ `npm run test:legal`（13/13）、✅ `cd backend && npm test -- admin-lottery.service.spec.ts --runInBand`（2/2）、✅ `npx tsc -b --noEmit`、✅ `NODE_ENV=production npx expo export --platform android`
- 构建环境：`EXPO_PUBLIC_ENV=production`、`EXPO_PUBLIC_USE_MOCK=false`、`EXPO_PUBLIC_API_BASE_URL=https://api.ai-maimai.com/api/v1`、`EXPO_PUBLIC_ALIPAY_SANDBOX=false`、`EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true`
- 注意：本次源码基于已推送的 `origin/staging` commit `86f5017` 构建，构建产物输出到 `apk/正式版/`；`expo doctor` 在 EAS local 流程中仍有既有告警（支付/微信原生库 RN Directory 元数据、Expo SDK 54 patch 版本落后、npm audit 若干漏洞）；Gradle release build、APK 签名、版本反查、64 位 ABI 和转盘 bundle 特征反查均已通过。Gradle 另提示本次后 daemon 会因 Metaspace 达阈值停止，属于本机构建性能提示，不影响本 APK 产物。

#### 2026-06-10 本地 production Android rebuild（1.0.3，会员服务协议内嵌包，待分发/提审）

- 类型：`eas build --profile production --platform android --local --non-interactive --output "$(pwd)/apk/正式版/prod-1.0.3-member-agreement-20260610-230843.apk"`
- Profile: production / Platform: Android / Channel: production
- Commit: `5ef92d9`（`fix(app): 补充会员服务协议提示`；包含新增 `src/content/legal/memberServiceAgreement.ts`、`app/member-service-agreement.tsx`，以及 VIP 礼包页 / checkout 支付前会员服务协议提示与勾选拦截）
- Version: 1.0.3 / VersionCode: 8 / RuntimeVersion: 1.0.3
- 本地 APK: `apk/正式版/prod-1.0.3-member-agreement-20260610-230843.apk`（117 MB）；`apk/aimaimai-latest.apk` 已同步为同一文件
- SHA-256: `5f07c07ba0adb39256f0f10a774804b627a87494c9c660500b56fb7cd2d25fdc`
- 结果：✅ `BUILD SUCCESSFUL in 9m 21s`；`aapt dump badging` 反查 `versionName='1.0.3'` / `versionCode='8'`；`apksigner verify --verbose --print-certs` 通过（v2 签名，证书 MD5 `766bafb6a3b34a678761e4b07e3665c4`）；AndroidManifest 确认 channel 为 `production`，`expo_runtime_version` resource 为 `1.0.3`；APK 内嵌 bundle 二进制搜索确认含 `AI爱买买APP会员服务协议`、`请先阅读并同意《会员服务协议》`、`VIP 礼包用于开通会员服务`、`一次性支付购买 VIP 礼包` 等关键字段（中文字段为 UTF-16LE 存储）
- 64 位校验：✅ `aapt dump badging` 反查 `native-code: 'arm64-v8a' 'armeabi-v7a' 'x86' 'x86_64'`；APK 内 `arm64-v8a` 与 `armeabi-v7a` 均为 26 个 `.so`，无缺失的 arm64 对应库，可满足 vivo 等渠道 64 位要求
- 构建前验证：✅ `npm run test:legal`（9/9，新增会员服务协议接入防回归用例）、✅ `npx tsc -b --noEmit`、✅ `NODE_ENV=production ... npx expo export --platform android`
- 构建环境：`EXPO_PUBLIC_ENV=production`、`EXPO_PUBLIC_USE_MOCK=false`、`EXPO_PUBLIC_API_BASE_URL=https://api.ai-maimai.com/api/v1`、`EXPO_PUBLIC_ALIPAY_SANDBOX=false`、`EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true`
- 注意：`expo doctor` 在 EAS local 流程中仍有既有告警（支付/微信原生库 RN Directory 元数据、Expo SDK 54 patch 版本落后、npm audit 若干漏洞）；Gradle release build、APK 签名、版本反查、64 位 ABI 和会员服务协议关键字段反查均已通过。Gradle 另提示本次后 daemon 会因 Metaspace 达阈值停止，属于本机构建性能提示，不影响本 APK 产物。

#### 2026-06-10 本地 production Android rebuild（1.0.3，隐私政策 v1.0.2 OPPO SDK 公示内嵌包，待分发/提审）

- 类型：`eas build --profile production --platform android --local --non-interactive --output "$(pwd)/apk/正式版/prod-1.0.3-privacy-v102-20260610-153840.apk"`
- Profile: production / Platform: Android / Channel: production
- Commit: `e11703e`（包含 OPPO SDK 隐私政策整改记录；源码隐私政策为 `v1.0.2`，支付宝 / 微信 SDK 名称、开发者、收集范围、目的和隐私政策链接已精确公示）
- Version: 1.0.3 / VersionCode: 7 / RuntimeVersion: 1.0.3
- 本地 APK: `apk/正式版/prod-1.0.3-privacy-v102-20260610-153840.apk`（117 MB）；当时 `apk/aimaimai-latest.apk` 已同步为同一文件，2026-06-10 23:18 起 latest 已改指向上方会员服务协议 rebuild 包
- SHA-256: `b9c9a27bcc341981767a2c63a14ff64992ede035a9a84c8e644eb36eb7d8059b`
- 结果：✅ `BUILD SUCCESSFUL in 8m 45s`；`aapt dump badging` 反查 `versionName='1.0.3'` / `versionCode='7'`；`apksigner verify --verbose --print-certs` 通过（v2 签名，证书 MD5 `766bafb6a3b34a678761e4b07e3665c4`）；AndroidManifest 确认 channel 为 `production`，`expo_runtime_version` resource 为 `1.0.3`；Hermes bytecode 二进制搜索确认内嵌隐私版本 `v1.0.2`，并确认 `APP支付客户端SDK`、`微信OpenSDK Android`、`支付宝(杭州)信息技术有限公司`、`深圳市腾讯计算机系统有限公司` 均在 bundle 内（中文字段为 UTF-16LE 存储）
- 64 位校验：✅ `aapt dump badging` 反查 `native-code: 'arm64-v8a' 'armeabi-v7a' 'x86' 'x86_64'`；APK 内 `arm64-v8a` 与 `armeabi-v7a` 均为 26 个 `.so`，无缺失的 arm64 对应库，可满足 vivo 等渠道 64 位要求
- 构建前验证：✅ `npm run test:legal`（8/8）、✅ `npx tsc -b --noEmit`、✅ `NODE_ENV=production ... npx expo export --platform android`
- 构建环境：`EXPO_PUBLIC_ENV=production`、`EXPO_PUBLIC_USE_MOCK=false`、`EXPO_PUBLIC_API_BASE_URL=https://api.ai-maimai.com/api/v1`、`EXPO_PUBLIC_ALIPAY_SANDBOX=false`、`EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true`
- 注意：`expo doctor` 在 EAS local 流程中仍有既有告警（支付/微信原生库 RN Directory 元数据、Expo SDK 54 patch 版本落后、npm audit 若干漏洞）；Gradle release build、APK 签名、版本反查、64 位 ABI 和内嵌隐私政策关键字段反查均已通过。Gradle 另提示本次后 daemon 会因 Metaspace 达阈值停止，属于本机构建性能提示，不影响本 APK 产物。

#### 2026-06-09 本地 production Android rebuild（1.0.3，CB08 隐私政策内嵌包，待分发/提审）

- 类型：`eas build --profile production --platform android --local --non-interactive --output "$(pwd)/apk/正式版/prod-1.0.3-privacy-20260609-221718.apk"`
- Profile: production / Platform: Android / Channel: production
- Commit: `2e73c21` + 本地 dirty working tree（本地构建按当前工作区打包；包含 `app.json` 版本号 1.0.3、隐私政策 `v1.0.1`、剪贴板读取披露和用户协议积分/提现口径更新）
- Version: 1.0.3 / VersionCode: 6 / RuntimeVersion: 1.0.3
- 本地 APK: `apk/正式版/prod-1.0.3-privacy-20260609-221718.apk`（117 MB）；当时 `apk/aimaimai-latest.apk` 已同步为同一文件，2026-06-10 15:48 起 latest 已改指向上方隐私政策 `v1.0.2` rebuild 包
- SHA-256: `0af3a9f2fb446bedffc83ae48ae2947f22c229d5bd174b45168ef4100c511364`
- 结果：✅ `BUILD SUCCESSFUL in 8m 29s`；`aapt dump badging` 反查 `versionName='1.0.3'` / `versionCode='6'`；`apksigner verify --verbose --print-certs` 通过（v2 签名，证书 MD5 `766bafb6a3b34a678761e4b07e3665c4`）；AndroidManifest 确认 channel 为 `production`，`expo_runtime_version` resource 为 `1.0.3`；Hermes bytecode dump 确认内嵌 bundle 含隐私版本 `v1.0.1` 与推荐链接格式 `https://app.ai-maimai.com/r/`
- 构建前验证：✅ `npm run test:legal`（7/7）、✅ `npx tsc -b --noEmit`、✅ `NODE_ENV=production ... npx expo export --platform android`
- 构建环境：`EXPO_PUBLIC_ENV=production`、`EXPO_PUBLIC_USE_MOCK=false`、`EXPO_PUBLIC_API_BASE_URL=https://api.ai-maimai.com/api/v1`、`EXPO_PUBLIC_ALIPAY_SANDBOX=false`、`EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true`
- 注意：`expo doctor` 在 EAS local 流程中仍有 2 个既有告警（支付/微信原生库 RN Directory 元数据、Expo SDK 54 patch 版本落后）；Gradle release build、APK 签名、版本反查和内嵌 bundle 关键字反查均已通过。Gradle 另提示本次后 daemon 会因 Metaspace 达阈值停止，属于本机构建性能提示，不影响本 APK 产物。

#### 2026-06-09 本地 production Android build（1.0.3，待分发/提审）

- 类型：`eas build --profile production --platform android --local --non-interactive --output "$(pwd)/apk/正式版/prod-1.0.3.apk"`
- Profile: production / Platform: Android / Channel: production
- Commit: `2e73c21` + 本地 dirty working tree（本地构建按当前工作区打包；至少包含 `app.json` 版本号 1.0.3 以及用户未提交的法律文案相关改动）
- Version: 1.0.3 / VersionCode: 5 / RuntimeVersion: 1.0.3
- 本地 APK: `apk/正式版/prod-1.0.3.apk`（117 MB）；当时 `apk/aimaimai-latest.apk` 已同步为同一文件，2026-06-09 22:26 起 latest 已改指向上方 CB08 privacy rebuild 包
- SHA-256: `076d9989f1ab71e8b623af266953db3302b65680e5389b729defebe5d19a6a23`
- 结果：✅ `BUILD SUCCESSFUL in 9m 9s`；`aapt dump badging` 反查 `versionName='1.0.3'` / `versionCode='5'`；`apksigner verify --verbose --print-certs` 通过（v2 签名，证书 MD5 `766bafb6a3b34a678761e4b07e3665c4`）；AndroidManifest 确认 channel 为 `production`，`expo_runtime_version` resource 为 `1.0.3`
- 构建环境：`EXPO_PUBLIC_ENV=production`、`EXPO_PUBLIC_USE_MOCK=false`、`EXPO_PUBLIC_API_BASE_URL=https://api.ai-maimai.com/api/v1`、`EXPO_PUBLIC_ALIPAY_SANDBOX=false`、`EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true`
- 注意：`expo doctor` 在 EAS local 流程中有 2 个既有告警（支付/微信原生库 RN Directory 元数据、Expo SDK 54 patch 版本落后），但 Gradle release build、APK 签名和版本反查均已通过。下一轮依赖维护时再评估 `npx expo install --check`。

#### 2026-05-30 本地 preview Android build（未分发）

- 类型：`eas build --profile preview --platform android --local --non-interactive`
- Profile: preview / Platform: Android / Channel: preview
- Commit: `6f28d53` + 本地 dirty working tree（新增 `plugins/withAndroidBuildStability.js`，`app.json` 注册该 config plugin）
- Version: 0.3.0 / VersionCode: 1
- 本地 APK: `/tmp/aimaimai-eas-artifacts-final/build-1780192620517.apk`（117 MB）
- 结果：✅ `BUILD SUCCESSFUL in 7m 18s`；修复本机 EAS local build 的两类失败：① Gradle/Maven 下载优先走本机 `~/.gradle/init.gradle` 阿里云镜像，解决 `intellij-core-31.11.0.jar` 并发下载超时；② config plugin 将 `react-native-reanimated@4.1.7` 的 worklets 链接切到 Prefab target，解决 `libworklets.so missing and no known rule to make it`
- 本机前提：`~/.gradle/gradle.properties` 全局设置了 `org.gradle.parallel=false`、`org.gradle.workers.max=2`、`org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8`。这是用户级 Gradle 配置，会影响本机其他 Gradle 项目；移机复现时必须同步评估。
- 备注：这是本机验证产物，尚未上传蒲公英，不可作为分发 / 回滚基线。

### 最近一次已分发 Build（当前蒲公英基线）

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
| `c2fd73ad-0cd0-42ae-8d0d-aca7d23956e4` | 下线 AI 多轮对话页（过华为审查 + 规避"网络异常"）：`app/ai/chat.tsx`+`assistant.tsx`+`history.tsx` 默认导出改 `<Redirect href="/(tabs)/home" />`（原实现保留为 `*ScreenDisabled`，恢复时切回 export default）；`app/(tabs)/home.tsx` 短按光球不再进聊天页 + 隐藏「继续对话」「最近对话」（`false &&`）+ 最近对话 query `enabled:false`；`src/hooks/useVoiceRecording.ts` 聊天类回复从跳 `/ai/chat` 改为浮层内联**单轮**显示（`setFeedbackText`+`setFeedbackVisible`）；`AiFloatingCompanion.tsx` `onContinueChat={undefined}`；`cart.tsx` 两入口 / `me.tsx`「AI 小助手」块 / `mocks/me.ts` task-002 / `navigateByIntent.ts` ai-chat→原地反馈，全部注释或不跳页。**保留单轮语音**：首页长按语音 + 全局浮球 + 语音搜索/推荐/跳页/结账 + 溯源/AI推荐/金融页 + 后端 AI 模块均不动 | **当前生效** ✅，commit `db3d7be`（2026-06-02），纯 JS/TS 无原生改动、无顶层副作用/白屏风险、无后端依赖；`tsc -b` 通过 + 独立审查 SHIP；Android update `019e86cc-de81-779b-8f86-6e79929b780f`，iOS update `019e86cc-de81-706d-941d-c5750b646518`；带全 5 个 `EXPO_PUBLIC_*`（`ENV=staging`+`USE_MOCK=false`+`API_BASE_URL=test`+`ALIPAY_SANDBOX=true`+`WECHAT_PAY_AVAILABLE=true`）。⚠️ 多轮 `sendMessage` 后端接口仍在、前端已无入口；背景根因是后端 `chatWithContext` 调 Qwen 10s 超时（`backend/.../ai.service.ts:3789`） |
| `a9b24b6d-a344-4fc1-8690-704d9b758fc4` | 售后申请页真机 bug 修复：①上传凭证入口支持拍照/相册二选一，拍照独立申请相机权限；②提交按钮加同步防重复保护，成功后直达售后详情；③售后详情页对金额、图片数组、物流轨迹数组做渲染前归一化，并加路由级 ErrorBoundary，避免后端已创建售后但详情异常数据导致白屏 | 已被 `c2fd73ad-0cd0-42ae-8d0d-aca7d23956e4` 覆盖，commit `46ef1e7`（2026-06-02），App 端纯 JS/TS 无原生改动；Android update `019e8624-9923-783c-9fcd-ff9c7dafece3`，iOS update `019e8624-9923-723b-b8be-802f8ea61c46`；带 `EXPO_PUBLIC_ENV=staging` + `EXPO_PUBLIC_ALIPAY_SANDBOX=false`（支付宝真实链路）+ `EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true`（微信真实链路入口打开） |
| `ce03bc35-13a4-42b6-8a29-d6e303b3156a` | 售后退款状态同步修复：①买家 App 售后详情在 `REFUNDING` 时 10s 轮询，进入 `REFUNDED/FAILED/REJECTED` 后停止并刷新订单/钱包/售后缓存；②新增 `afterSaleRefundSync` 纯函数与单测，统一退款中/终态判断；③配套后端售后退款 pending 短延迟查单 + 管理后台详情弹窗 15s 查单随 staging commit 自动部署 | 已被 `a9b24b6d-a344-4fc1-8690-704d9b758fc4` 覆盖；commit `6ebae51`（2026-06-01），App 端纯 JS/TS 无原生改动；后端/admin 依赖同 commit 的 staging 部署完成后生效；Android update `019e8186-1ddb-7784-bee7-b558b4ca42dd`，iOS update `019e8186-1ddb-71e0-93e7-c9ddc3d698c3`；带 `EXPO_PUBLIC_ENV=staging` + `EXPO_PUBLIC_ALIPAY_SANDBOX=true` + `EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true` |
| `e382b130-844e-4340-ae59-5141359239d7` | 法律文本上架合规一批：①`src/content/legal/termsOfService.ts`+`privacyPolicy.ts` 整篇替换为法务定稿《AI爱买买APP用户协议/隐私政策》正文（标题改 AI爱买买APP、生效 2026-05-30、version 维持 v1.0 测试期不触发重弹同意）②账号注销功能未上线：用户协议 §六整章、隐私 §4.3 及各处顺带提及全部改注释保留（文件头附恢复清单）③隐私恢复《第三方 SDK 与服务共享清单》附录 + `app/settings.tsx` 加回「第三方 SDK 清单」入口 ④`app/account-security.tsx` 注销按钮+handler 注释隐藏（后端 `/auth/delete-account` 未实现，生产点击 404）+ `PrivacyConsentModal.tsx` 同意弹窗去掉"或注销账号" | 已被 `ce03bc35-13a4-42b6-8a29-d6e303b3156a` 覆盖；commits `ec91c44`+`06783b0`+`3cbf3fd`（2026-05-30），纯 JS/TS 无原生改动，无后端依赖；Android update `019e7a7d-728b-73cf-96d1-9785eb372af6`，iOS update `019e7a7d-728b-7df6-9700-792c4a7066f0`；带 `EXPO_PUBLIC_ENV=staging` + `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `258312d7-6861-4d18-acf2-fc1fed9926c4` | 设置页清理：①`app/settings.tsx` AI 偏好 Section 整段用 JSX 块注释隐藏（保留代码以便恢复，连带注释 `AiBadge` import）②隐私与合规删除「个人信息收集清单 / 第三方 SDK 清单 / 应用权限说明」三个入口（仅去掉设置页跳转入口，`src/content/legal/privacyPolicy.ts` 的 appendix 内容与 `/privacy` 页渲染保留不动） | 已被 `e382b130-844e-4340-ae59-5141359239d7` 覆盖；commit `58eec67`（2026-05-29），纯 JS/TS 无原生改动，无后端依赖；Android update `019e74b7-b6b0-76a0-b6c6-b38b72e9eb1c`，iOS update `019e74b7-b6b0-767e-90dd-625a24a3ff5a`；带 `EXPO_PUBLIC_ENV=staging` + `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `ac76d613-402b-4a05-9b86-e9513ae84eb7` | 买家 App 红包 9 个 bug 一篮子修复：①`app/checkout-coupon.tsx` 5 处——FIXED 金额 `.toFixed(2)` 防浮点尾差；选红包前 isExpired 拦截 + Alert 提示 + 列表归类 ineligible 不再"成功选中再后端拒"；百分比折扣公式注释明确前后端契约（discountValue=20 表示减 20% 即 8 折）；禁用红包用 `MaterialCommunityIcons close-circle-outline` 替代 checkbox；排序加 `id.localeCompare` 二级 key 同金额顺序稳定。②`app/me/coupons.tsx` 4 处——过期日期 `.slice(0,10)` 改 `toLocaleDateString('zh-CN')` 修 UTC+8 时区偏差；空态加"去领券中心"`actionLabel` + `onAction` 切换内置 Tab；未知状态 fallback `未知状态(${status})`；领券中心卡片 minOrderAmount 文案与"我的红包"统一。详见 staging 6 commits ad19ab6..673c420 | 已被 `258312d7-6861-4d18-acf2-fc1fed9926c4` 覆盖；commits `673c420`（结算页）+ `9768bc0`（我的红包页）（2026-05-28），纯 JS/TS 无原生改动，无后端依赖（后端 6 个 bug 由后端自动部署接收）；Android update `019e6cf0-d4aa-7cab-a132-4ba306119caa`，iOS update `019e6cf0-d4aa-7f9b-9f47-45b851681783`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true`（漏带 `EXPO_PUBLIC_ENV=staging`，下次记得补） |
| `8c1f0257-947f-4a47-b27e-f7300d45191e` | VIP 购买页底部 BlurView tint 修价格看不清：`app/vip/gifts.tsx:605` `BlurView intensity={40}` 从 `tint="dark"` 改为 `tint="light"`——金底上 dark tint 在模糊层叠暗化效果，把深金价格 `#B8860B` 和深棕标签 `#3D2E1A` 都压成对比度不足；light tint 让模糊层倾向亮色，深色文字恢复正常显示 | 已被 `ac76d613-402b-4a05-9b86-e9513ae84eb7` 覆盖；commit `1e081be`（2026-05-27），纯 JS/TS 无原生改动，无后端依赖；Android update `019e6bd9-58b2-7af5-af6b-1b0da1796681`，iOS update `019e6bd9-58b2-7d63-986f-d8e4aaf18f82`；带 `EXPO_PUBLIC_ENV=staging` + `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `db56d548-a481-49d6-9142-acdf955bdb0f` | P0 EnvBanner + EXPO_PUBLIC_ENV：单包名方案下区分测试/生产环境的运行时标记。`src/repos/http/config.ts` 新增 `APP_ENV` / `IS_PRODUCTION` 常量；`eas.json` 三档 profile 都注入 `EXPO_PUBLIC_ENV`（development/staging/production），`development` 补 `EXPO_PUBLIC_ALIPAY_SANDBOX=true`；新增 `src/components/feedback/EnvBanner.tsx` 22px 红色顶条（非生产 build 渲染，故意不消耗 safe area 避免双重撑高），`app/_layout.tsx` 根布局 Stack 之上挂 EnvBanner。⚠️ **本次 OTA 命令前缀只带了 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` 没带 `EXPO_PUBLIC_ENV=staging`**（首次推没意识到 EXPO_PUBLIC_ENV 也要前缀注入），现有 preview APK 装这个 OTA bundle 后，`APP_ENV` fallback 到默认 `'development'`，红条显示"⚠️ 开发环境 · test-api.ai-maimai.com"。红条 UI 验证 OK，文案细节差异不影响功能。已同步更新 §三 OTA 命令模板，下次推 preview 时带 `EXPO_PUBLIC_ENV=staging` 前缀红条会显示"⚠️ 测试环境" | 已被 `8c1f0257-947f-4a47-b27e-f7300d45191e` 覆盖；commit `5979e0a`（2026-05-27），纯 JS/TS 无原生改动，无后端依赖；Android update `019e6bc9-d45a-7730-a499-b61579df8817`，iOS update `019e6bc9-d45a-7886-8ed3-7ad9f9d072b7`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true`（漏带 `EXPO_PUBLIC_ENV=staging`）|
| `041c413d-d22c-4089-8a3e-7ae13016a44f` | VIP 专属空间换金色风格轻金 v1：`app/me/vip.tsx` + `app/vip/gifts.tsx` palette 从深墨绿黑底改为暖香槟金底——bgStart/bgEnd `#0A1F1A→#0D0D0D` → `#FFFDF5→#EAD78F`，goldPrimary `#C9A96E→#B8860B`，goldLight `#E8D5A3→#FFD700`，warmWhite `#F5F0E8→#3D2E1A`（key 名保留语义翻转为深棕文字），`cardBg` 0.06→0.55；硬编码 `rgba(201,169,110,*)` 全部 `→rgba(184,134,11,*)`。新增 3 个动效组件 `src/components/effects/`：①`GoldShimmerLine` 顶部金线 7 色金箔渐变 + 4s 水平扫动（接入身份卡顶线）②`GoldShineSweep` CTA 流光扫光半透明白色 3.5s 扫过（接入邀请好友 + 立即开通 CTA）③`GoldBgGlows` 背景 3 个柔焦金色圆斑。皇冠圆加 `shadowColor:#FFD700` 静态金发光替代 conic 转动光环。StatusBar light→dark 适配金底。跳过金箔渐变文字（需 `@react-native-masked-view` 装新原生包会破 OTA） | 已被 `db56d548-a481-49d6-9142-acdf955bdb0f` 覆盖；commit `3b191b6`（2026-05-27），纯 JS/TS 无原生改动，无后端依赖；Android update `019e67f1-2c8b-78aa-8689-2bfb1ff10222`，iOS update `019e67f1-2c8b-7aec-9219-0ae317bda122`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `6faa6331-f6d3-4c6c-8bee-b51883c3c080` | 支付宝支付方式描述按沙箱开关动态切换：`src/constants/payment.ts:26` description 从硬编码"支持快捷支付（沙箱测试中）"改为按 `EXPO_PUBLIC_ALIPAY_SANDBOX` env 动态选择。沙箱 build 仍显示"沙箱测试中"，生产 build 仅显示"支持快捷支付"，避免生产 APK 误导真实用户。仿 `app/payment-success.tsx:55` 的同款 env 切换逻辑 | 已被 `041c413d-d22c-4089-8a3e-7ae13016a44f` 覆盖；commit `8aeafa0`（2026-05-27），纯 JS/TS 无原生改动，无后端依赖；Android update `019e67ac-feb2-78a1-be91-71146ca08d73`，iOS update `019e67ac-feb2-75b8-8f6b-468e68982580`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `b49053f1-56e3-4aab-8418-577c75340385` | 消费积分页空态文案改写：`app/me/wallet.tsx:521` EmptyState description 从「完成消费或推荐好友后即可获得消费积分」改成「成为 VIP 推荐好友获得消费积分」，统一引导用户走 VIP 推荐链路（普通用户/非 VIP 没有可分享推荐码） | 已被 `6faa6331-f6d3-4c6c-8bee-b51883c3c080` 覆盖；commit `1883ef6`（2026-05-27），纯 JS/TS 无原生改动，无后端依赖；Android update `019e67aa-3347-75df-851f-9c29856efbfc`，iOS update `019e67aa-3347-742c-b63f-e760a5978320`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `e6b584f4-094c-44a4-a3c9-8baea6b7f173` | VIP 礼包广告位卡片高度对齐：修 999 比 399/699 视觉高的错位（itemLines 数量不定 + subtitle 行数不定共同造成）；`itemLines` 显示上限 `MAX_ITEM_LINES=2`，超过的在第 2 行末尾加「等 N 款」收口；`cardPressable` / `card` 从 `minHeight:176` 改为 `height:188` 锁死，配合 `overflow:hidden` 把变长内容硬截（188dp = 28padding + 41header + 31title + 39subtitle 2-line + 38items 2-line + 11 buffer） | 已被 `b49053f1-56e3-4aab-8418-577c75340385` 覆盖；commit `a8bc889`（2026-05-27），纯 JS/TS 无原生改动，无后端依赖；Android update `019e679f-b58a-7757-8c55-aa058009573c`，iOS update `019e679f-b58a-7c3d-9f8b-6919a7cf85dc`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `943e0527-c51a-4180-ab08-799be797c90d` | VIP 礼包广告位改连续顺滑滚动 + 长按暂停：修上一版 `8c117b30` 999→399 不循环 + step 跳动不顺滑；抛弃 ScrollView+Animated.loop+snapToInterval，改 `Animated.Value translateX` 自驱循环 + 复制一份卡组 `[...cards, ...cards]` 实现无缝循环（到 `-loopDistance` 时 `setValue(0)` 瞬时回弹，第二组开头视觉等同第一组开头，用户无感）；速度 28dp/s linear `useNativeDriver:true`；交互：`onPressIn` 调 `stopAnimation(cb)` 捕获 translateX 当前值到 `currentXRef`，`onPressOut` 从 `currentXRef` 续滑（duration 按剩余距离算），`onPress` 仍负责快速点击导航——长按不动 / 松开续滑 / 快点击进入三态分明；删除底部指示点（连续滚没意义）；已知局限：wraparound 帧 + 按下瞬间 / 亚帧狂连按时 callback 顺序不定最多 1 帧抖动，不影响功能 | 已被 `e6b584f4-094c-44a4-a3c9-8baea6b7f173` 覆盖；commit `51b70d6`（2026-05-26），纯 JS/TS 无原生改动，无后端依赖；Android update `019e6796-1cdf-740a-962f-1d638e6a5f5b`，iOS update `019e6796-1cdf-7b48-b1d2-5b2d11b37e03`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `8c117b30-27f8-469d-a888-af02a7bd3a1a` | 首页非 VIP 礼包广告位改自动轮播 + 暖白米黄配色：VipHomePromoCarousel 加 setInterval 3.5s 自动切下一张循环，snapToInterval 吸附对齐，onScrollBeginDrag/onPress 触发 pauseAutoPlay 5s 后恢复；卡片渐变从 `#0A1F1A→#173321→#3A2D12` 深墨黑棕改为 `#FFFDF5→#FFF8E1→#FFF1C8` 暖白米黄，描边换品牌绿 `#2E7D32`，价格换暖金 `#B8860B`，标题用 `colors.brand.primaryDark`，礼物图标/圆点/Badge 改 `theme.brand` 令牌；底部 3 颗指示点当前位置高亮放大为品牌绿；响应式 `isLargeText` 下卡片收窄到 184-220dp 防大字体拥挤，标题加 `fitTextProps`，`itemLines` key 改 `index-based` 防内容更新时 React 误判重排 | ⚠️ 已知问题：999 后不回到首张、step 跳动不顺滑，被 `943e0527` 整体重写覆盖；commit `982727b`（2026-05-26），纯 JS/TS 无原生改动，无后端依赖；Android update `019e677d-2296-794e-a263-5264149a930d`，iOS update `019e677d-2296-73fc-9b4e-2ba74edd9344`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `ae7a5bc1-4233-4d1c-a833-88aa138d2d32` | 头像设置页加「历史」按钮：①后端新增 AvatarHistory 表 + GET /me/avatar-history endpoint + recordAvatarHistory 共用工具（Serializable 事务 + pg_advisory_xact_lock 串行化每用户的 check+insert+prune）②updateProfile / syncWechatAvatar / 微信首次登录创建用户 共 3 处 fire-and-forget 入库 ③每用户保留最近 5 条 ④前端 appearance.tsx 上传行 2→3 列加「历史」按钮，AppBottomSheet 横滑预览 + 来源标签（微信/上传） ⑤handleSave 失效 me-avatar-history 缓存 | 已被 `8c117b30-27f8-469d-a888-af02a7bd3a1a` 覆盖；commits `b13b87c`（后端 + 1 migration）+ `5f8274e`（前端），纯 JS/TS 无原生改动；Android update `019e6531-8893-7043-a297-bf02c5f504a2`，iOS update `019e6531-8893-7216-947d-a4d81ff994a4`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true`；后端 workflow 自动跑 `prisma migrate deploy` 已部署 migration `20260526010000_add_avatar_history`（CREATE TABLE 纯新增可逆，回滚需手写 `DROP TABLE "AvatarHistory" CASCADE`） |
| `438dcfa8-46c1-4cea-968c-649fd543395a` | 华为合规整改：①PrivacyConsentModal 协议链接改为弹窗内嵌切换 viewMode（不再 router.push 被遮挡），新增 LegalDocumentView 内嵌阅读 + 返回按钮 ②AuthModal 登录 Tab 补勾选框 + handleSubmit/handleWeChat/handleOpenForgotPassword 全路径校验 agreed（覆盖手机号验证码/密码/注册/微信/忘记密码）③新建 PermissionRationaleModal（imperative API showPermissionRationale），系统权限弹框前先弹自定义说明卡片告知"权限名+服务功能+使用目的"，符合华为审核第 7.18 项 ④接入 5 个调用点：uploadAvatar.ts 头像相机/相册、after-sale/[id].tsx 售后凭证相册、me/scanner.tsx 扫码相机、useVoiceRecording.ts AI 语音麦克风。防竞态：show() 被重复调用先 resolve(false) 释放旧 resolver，组件卸载兜底 | **当前生效** ✅，commit `828dcff`（2026-05-25），纯 JS/TS 无原生改动；Android update `019e625c-aa75-743e-a350-9dc657821977`，iOS update `019e625c-aa75-7592-83ab-d3b58bc45a8c`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `49fa214f-306c-4a73-9e14-33efa8a2600d` | 账号身份绑定（方案 A 仅空位绑）：买家 App「账号与安全」页未绑手机号跳新页 `app/bind-phone.tsx`（手机号 + 60s 倒计时验证码 + 提交）；未绑微信调起 `requestWechatAuth` + 调后端 `POST /me/bind-wechat`；不做换绑/解绑。后端新增 3 个端点 `/me/bind-phone/sms/code`、`/me/bind-phone`、`/me/bind-wechat`，写入用 Serializable 事务 + P2034 退避重试兜底 schema `@@unique([provider, identifier, appId])` 在 appId=null 时 NULLS DISTINCT 让 P2002 不触发的缺陷（详 `docs/issues/tofix-safe.md` B01）；sendCode 端点不预检号码占用避免枚举注册号 | 已被 `438dcfa8-46c1-4cea-968c-649fd543395a` 覆盖；commit `fc760bf`（2026-05-25），纯 JS/TS 无原生改动；Android update `019e6224-df48-7176-b7da-cb7d8f260bd3`，iOS update `019e6224-df48-7abf-8cd8-f644b72200f2`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true`；后端 workflow `26426307927` 1m15s 成功 |
| `345187e7-5f59-45f2-adc5-328f6f7b131a` | 头像与装扮页重写（2026-05-23）：8 个农业主题 SVG 默认头像（DefaultAvatar/UserAvatar 体系 + preset:// sentinel）+ 相册/拍照/微信 3 个上传入口 + 头像框收敛到默认/VIP 两个 + VIP 框 tier 卡权限；后端配套：新增 POST /me/sync-wechat-avatar、updateProfile 加 VIP tier 服务端校验、getProfile fallback 改 preset://sprout | 已被 `49fa214f-306c-4a73-9e14-33efa8a2600d` 覆盖；commit `46ee66e`，纯 JS/TS 无原生改动；Android update `019e57d0-66d1-74ca-90ec-5744bf8bd50e`，iOS update `019e57d0-66d1-74fb-a6db-8d0538971815`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `bd87bc65-a057-43c0-85f0-a91650c0c4e6` | 发票申请页底部 gap 收口 + 订单详情发票操作避开 AI 浮层：保留该页 `ScrollView flex:1`、底部栏 `alignSelf:'stretch'` 和 `flexShrink:0` 布局修复，将单页 `androidMinimumBottomPadding` 从 80dp 收到 64dp，减少确认按钮下方可见空白；订单详情 `InvoiceSection` 的“查看发票 / 取消申请 / 重新申请”操作链接从右对齐改为左对齐，并扩大垂直点击区，避免右侧绿色 AI 浮层拦截“查看发票” | 已被 `345187e7-5f59-45f2-adc5-328f6f7b131a` 覆盖；commit `131c533`（2026-05-21），纯 JS/TS 无原生改动；Android update `019e4885-e28f-7c11-9aa5-2925ba6a34d1`，iOS update `019e4885-e28f-7cf2-8b3c-b3ce9f6eb456`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `580163cc-3576-4a57-b11d-bfa688a3717c` | 发票申请页底部 CTA 布局稳定化：按独立审查结果去掉底部栏内 `Pressable flex:1`，改为 `alignSelf:'stretch'`，`bottomBar` 加 `flexShrink:0`；页面级逃生从 `androidZeroInsetMinimum:64` 改为 `androidMinimumBottomPadding:80`，覆盖 low/zero bottom inset，仍只作用于 `app/invoices/request.tsx`，不恢复全局 Android 兜底，避免其他页面再次出现 gap | 已被 `bd87bc65-a057-43c0-85f0-a91650c0c4e6` 覆盖；commit `e5e55f9`（2026-05-21），纯 JS/TS 无原生改动；Android update `019e4879-014f-7f75-8c62-176406d20900`，iOS update `019e4879-014f-751e-a718-c6313ba90982`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `2c4c8e81-484d-4a95-ae69-93d3073391e5` | 发票申请页底部 CTA 局部逃生：保持全局 `useBottomInset()` 不做 Android 64dp 推断，避免首页/商品详情/购物车/确认订单/VIP 礼包再次出现 gap；仅 `app/invoices/request.tsx` 传 `androidZeroInsetMinimum: 64`，处理该页在 `insets.bottom=0` 真机上确认按钮被系统手势区压到屏幕外的问题；新增回归测试确保该逃生必须显式传参 | 已被 `580163cc-3576-4a57-b11d-bfa688a3717c` 覆盖；commit `49358d4`（2026-05-21），纯 JS/TS 无原生改动；Android update `019e486b-a123-716c-b28d-ab22a7ba4e01`，iOS update `019e486b-a123-72d1-a960-cbf8220fa711`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `689576fb-4f03-4aaf-8a62-80a7098ce7e2` | Android 底部 gap 回归修复：撤销上一轮 JS 侧根据 `Dimensions` 推断 64dp 导航栏兜底；`useBottomInset()` 和 tab bar 只使用系统 safe-area + 调用方 extra，避免 `insets.bottom=0` 的手势导航设备被误判后首页、商品详情、购物车、确认订单、VIP 礼包等所有页面统一底部留白；全 app 64 个路由文件静态审查，底部固定栏/FAB/BottomSheet 无 `Math.max(insets.bottom, 64)`、无硬编码 `bottom: 90`、无 UI 侧 `Dimensions.get('screen')` 推断导航栏 | 已被 `2c4c8e81-484d-4a95-ae69-93d3073391e5` 覆盖；commit `3ee8fdb`（2026-05-21），纯 JS/TS 无原生改动；Android update `019e4864-8d4b-772b-8c93-a80875f18f8f`，iOS update `019e4864-8d4b-747a-b157-406cb6ed3b09`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `5e752f48-11f4-4657-8abc-1f5162f230f4` | Android 底部导航栏 / 手势条适配根治：新增 `src/theme/bottomInset.ts` 统一判断 Android `window` 与 `screen` 尺寸差，能区分系统已预留三键导航栏 vs edge-to-edge 错报 `insets.bottom=0`；`useBottomInset` 与底部 tab bar 共用同一算法；收口购物车、StickyCTABar、商品搜索 FAB、AI/客服输入栏、扫码页、地址表单、VIP 礼包页、BottomSheet 等底部固定区域，避免不同品牌手机反复出现按钮被挡或底部 gap | 已被 `689576fb-4f03-4aaf-8a62-80a7098ce7e2` 覆盖；commit `077b66e`（2026-05-21），纯 JS/TS 无原生改动；Android update `019e4853-ae26-7657-810e-83b50f551c4f`，iOS update `019e4853-ae26-75cd-91be-6d5ed8f99f69`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `10e07537-3b53-4937-aebc-d8cb658c9995` | useBottomInset 阈值策略修正：上轮无条件 `Math.max(insets, 64)` 让正确报 insets 的设备（如 Xiaomi 手势条报 24dp）被强制提到 64dp，tab bar 出现 30-40dp 可见 gap（用户截图反馈）。改为阈值检测——`insets.bottom > 16dp` 信任系统值，`≤ 16dp` 才兜底 64dp（覆盖华为 HarmonyOS edge-to-edge 错报 0）。`app/(tabs)/_layout.tsx` 同步回退到原 edge-to-edge 条件兜底逻辑（fallback 32dp）。invoices 根因修复（ScrollView flex:1）保留，不依赖 helper 给多大 padding | 已被 `5e752f48-11f4-4657-8abc-1f5162f230f4` 覆盖，commit `fe6600e`（2026-05-20），纯 JS/TS 无原生改动；Android update `019e4838-c358-7f4b-9d7d-c238b1f94888`，iOS update `019e4838-c358-729d-a79d-cd369502ba79`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
| `c0faa525-0049-4cda-a178-1220e8fa7d45` | invoices 3 页根本性修复 + helper 收口：真机回归发现根因不只是 OEM inset 而是布局——`<Screen flex:1>` 下 `ScrollView/FlatList` 没有显式 `style={{ flex: 1 }}` 时取自然内容高度，短内容场景（EmptyState/单条目）会让 flex 兄弟底部栏贴在 ScrollView 后面（页面中部）而非屏幕底部。修复 `invoices/request.tsx` + `invoices/profiles.tsx` + `invoices/index.tsx` ScrollView/FlatList + EmptyState wrapper 全部加 `flex: 1`；同时 `src/theme/responsive.ts` `useBottomInset` 取消 edge-to-edge 检测（华为 HarmonyOS / 小米 MIUI 上不可靠），Android 改用无条件 `Math.max(insets.bottom, 64)`，fallback 56→64 覆盖华为 split-display；`app/(tabs)/_layout.tsx` 同步。2 Agent 并行审查全 app 54 文件确认其他页面要么 absolute 定位要么内容总是长，**只 invoices 3 页踩坑**。⚠️ 这轮的 Math.max 改动在下一轮 `10e07537` 已回退为阈值策略 | commit `771d5a1`（2026-05-20），纯 JS/TS 无原生改动；Android update `019e4829-dca0-7ed1-b9ca-c940a6dd2fee`，iOS update `019e4829-dca0-7b95-a160-1b4998125a5c`；带 `EXPO_PUBLIC_ALIPAY_SANDBOX=true` |
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

**已存在并持续使用**（channel `production` → branch `production`）。v1.0 已上线：生产设备当前存在 runtime **1.0.1**（华为等旧包用户）与 **1.0.2**（小米 1.0.2 包用户）；2026-06-11 已本地重新生成 1.0.3 production APK（`prod-1.0.3-lottery-20260611-222117.apk`，versionCode 9，内嵌隐私政策 `v1.0.2` OPPO SDK 精确公示 + 会员服务协议 + 抽奖转盘奖品名完整展示 / 奖品实例配色修复），但尚未上传/分发；`apk/aimaimai-latest.apk` 已同步为该包。2026-06-10 源码已按 OPPO 审核整改升级隐私政策 `v1.0.2`（支付宝/微信 SDK 精确公示），并已发 OPPO SDK 公示版 production OTA 到 runtime **1.0.3**；同日晚继续按 OPPO 付费会员审核要求发 runtime **1.0.3** production OTA，新增独立《会员服务协议》页面，并在 VIP 礼包选择页 / VIP 结算支付页醒目提示且支付前强制勾选。2026-06-11 已继续发 runtime **1.0.3** production OTA，将「关于爱买买」联系邮箱改为 `zwf@huahainongke.com`。2026-06-14 已发 runtime **1.0.3** production OTA，新增买家 App「数字资产」入口与累计消费金额页面；该页面依赖本次 `main` 后端部署完成 `DigitalAssetAccount`/`DigitalAssetLedger` migration 与 `/me/digital-assets/*` API 后可用。2026-06-15 曾发 runtime **1.0.3** 首页品牌文案/VIP 礼包卡片精简 OTA，但 Android 侧出现 0 installs / 3 failedInstalls / 100% crashRate，已用 `eas update:republish` 紧急回滚到数字资产稳定版本；同日已从干净 `main` commit `8f6f430` 重新发 runtime **1.0.3** production OTA，包含首页品牌文案/VIP 礼包卡片精简与我的页 VIP 卡片「减免运费权益」文案，且发布前后均验证 Android/iOS manifest 为 45 assets / 19 ttf、launch HBC 约 5.27 MB。runtime 1.0.1 / 1.0.2 用户收不到 1.0.3 OTA，若这些旧包也要同步隐私政策、会员服务协议、抽奖转盘展示修复、关于页邮箱、数字资产入口或首页品牌文案，必须按对应 runtime 另发 OTA 或分发新版 APK。**生产 OTA 必须按目标 runtime 分发**——1.0.3 / 1.0.2 / 1.0.1 / 1.0.0 / 0.2.0 互不通 OTA。

生产 OTA 完整历史（第 1-21 条，含 Group ID / commit / 内容）以 memory `project_app_release_status.md` 的「Production Branch」节为权威，或跑 `eas update:list --branch production` 查询。

最近一条（2026-06-15，第 21 条）：首页品牌文案与我的页 VIP 权益文案（staging `c200483` / main merge `8f6f430`）——买家 App 首页顶部固定展示「消费者就是生产力，是社会价值的创造者。」；AI 光球下方展示「让每个人创造一个属于自己的世界 / 为全世界创造一个共生的未来」两行使命文案；首页 VIP 礼包轮播卡片不展示 SKU/规格/数量明细；我的页 VIP 卡片第三条权益从「免运费」调整为「减免运费权益」。发布前先从干净 `main` worktree 发诊断 branch `diagnostic-ota-assets-20260615-8f6f430`：Group `bbc8eeb2-976e-439b-9a41-d01f8c3101a7`，Android update `019ec97c-8227-7e87-a86f-d27b7a2bd1e1`，iOS update `019ec97c-8227-7ef3-bc1e-46d891d26d7d`；服务端 manifest 校验 Android/iOS 均为 `assetCount=45`、`ttf=19`、`png=26`，launch HBC 均约 `5.27 MB`。runtime 1.0.3 production OTA：Group `b8cc136d-58aa-415e-95dd-6efea647f1fc`，Android update `019ec97e-4d46-70b9-98a6-148c19b0ecec`，iOS update `019ec97e-4d46-7270-9b00-df556c0ff408`；EAS Dashboard `https://expo.dev/accounts/flyspaceden/projects/ai-aimaimai/updates/b8cc136d-58aa-415e-95dd-6efea647f1fc`；命令带全 5 个生产 `EXPO_PUBLIC_*`，并使用 `--clear-cache --emit-metadata`。发布后已再次拉取 production 服务端 manifest，确认 Android/iOS 均为 `45 assets / 19 ttf`，launch HBC 均约 `5.27 MB`；`eas update:list --branch production --limit 2` 已确认该 Group 为 production branch 最新记录。

上一条（2026-06-15，第 20 条，已被第 21 条覆盖）：紧急回滚首页 OTA，恢复数字资产稳定版本——用户反馈小米 App 1.0.3 卸载重装后首页仍是旧版且“数字资产”入口消失；EAS `update:insights` 确认第 19 条 Android update `019ec93c-dfe0-7427-944e-dc230874d375` 在 1 天窗口内 `installs=0` / `failedInstalls=3` / `crashRatePercent=100`，客户端会拒绝该 OTA 并回退到嵌入包。已执行 `npx eas-cli@latest update:republish --group 997110d3-ec47-4039-be8b-acb102379c8f --destination-branch production --message "回滚首页 OTA：恢复数字资产稳定版本" --non-interactive`。runtime 1.0.3 production OTA：Group `9f9f9c35-5f10-4eb4-bb50-f6bcf627d5fc`，Android update `019ec96a-ef53-7e8d-a846-6652d040cc65`，iOS update `019ec96a-ef53-7320-932f-a5d5e71bebd6`；EAS Dashboard `https://expo.dev/accounts/flyspaceden/projects/ai-aimaimai/updates/9f9f9c35-5f10-4eb4-bb50-f6bcf627d5fc`；回滚后用户真机已重新看到“数字资产”入口。

再上一条（2026-06-15，第 19 条，已回滚且由第 21 条重新发布有效内容）：首页品牌文案与 VIP 礼包卡片精简（staging `1d6fd62` / main merge `5e66039`）——买家 App 首页顶部移除时段问候和随机 AI 引导语，固定展示「消费者就是生产力，是社会价值的创造者。」；AI 光球下方移除快捷指令气泡，改为「让每个人创造一个属于自己的世界 / 为全世界创造一个共生的未来」两行使命文案；首页 VIP 礼包轮播卡片不再展示龙虾默认规格、苏丹鱼 400/500 克包装等 SKU/规格/数量明细，只保留价格、礼包标题和简短副标题。runtime 1.0.3 production OTA：Group `a8c2cf5b-ebdd-40b9-866c-1b71fac39390`，Android update `019ec93c-dfe0-7427-944e-dc230874d375`，iOS update `019ec93c-dfe0-7bfc-bb63-12b1f4b86af2`；EAS Dashboard `https://expo.dev/accounts/flyspaceden/projects/ai-aimaimai/updates/a8c2cf5b-ebdd-40b9-866c-1b71fac39390`。⚠️ Android insights 显示本条 `installs=0` / `failedInstalls=3` / `crashRatePercent=100`，服务端 manifest 缺少 19 个 `font/ttf` 资源且 Android launch HBC 仅约 1.4 MB，已被第 20 条回滚覆盖；第 21 条用 `--clear-cache --emit-metadata` 和 manifest 预检重新发布相同首页有效内容。

再上一条（2026-06-14，第 18 条）：数字资产累计消费（staging `e12c1a6` / main merge `b231c2d`）——买家 App 我的页新增“数字资产”入口与 `/me/digital-assets` 页面，展示“累计消费金额”、未来模块占位和流水；配套后端新增 `DigitalAssetAccount`/`DigitalAssetLedger`、确认收货入账、退款扣回、后台调整和回填脚本，管理后台新增数字资产管理页与用户详情卡片。runtime 1.0.3 production OTA：Group `997110d3-ec47-4039-be8b-acb102379c8f`，Android update `019ec874-30ed-7091-a820-3b3058e06655`，iOS update `019ec874-30ed-7cf6-bdcb-6a78edbed9af`；EAS Dashboard `https://expo.dev/accounts/flyspaceden/projects/ai-aimaimai/updates/997110d3-ec47-4039-be8b-acb102379c8f`；命令带全 5 个生产 EXPO_PUBLIC_*（ENV=production + USE_MOCK=false + API_BASE_URL=api + ALIPAY_SANDBOX=false + WECHAT_PAY_AVAILABLE=true）。本次 OTA 输出 commit 为 `b231c2df40b421e700df179b382643d1b339aa62`，从干净临时 `main` worktree 发布。⚠️ 第 20 条通过 `update:republish` 重发本 Group，使其重新成为当前 production 最新内容。

再上一条（2026-06-11，第 17 条）：关于页联系邮箱更新（commit `0274afc` / main merge `4ed73b6`）——`app/about.tsx` 将「联系我们」邮箱由 `zenghaifeng13@163.com` 改为 `zwf@huahainongke.com`，新增 legal 静态测试锁定关于页邮箱并同步前端文档 / `plan.md`。runtime 1.0.3 production OTA：Group `25afb44d-ffae-482e-81ca-6ce2dd325bd8`，Android update `019eb9c0-7f5c-7f19-84cc-318ca9090386`，iOS update `019eb9c0-7f5c-79b8-96ec-aa7d551b5904`；EAS Dashboard `https://expo.dev/accounts/flyspaceden/projects/ai-aimaimai/updates/25afb44d-ffae-482e-81ca-6ce2dd325bd8`；命令带全 5 个生产 EXPO_PUBLIC_*（ENV=production + USE_MOCK=false + API_BASE_URL=api + ALIPAY_SANDBOX=false + WECHAT_PAY_AVAILABLE=true）。本次 OTA 输出 commit 为 `0274afc*`，星号来自临时 main worktree 为 bundler 挂载的未跟踪 `node_modules` symlink；实际源码 commit 已推到 `origin/staging`，并通过 main merge `4ed73b6` 推到 `origin/main`。⚠️ 本次 OTA 只覆盖 runtime 1.0.3；新装用户首启嵌入版仍以 `prod-1.0.3-lottery-20260611-222117.apk` 为准，联网拉取本 OTA 后关于页邮箱才变为 `zwf@huahainongke.com`。

再上一条（2026-06-10，第 16 条）：OPPO 付费会员审核整改（commit `5ef92d9` / main merge `6a1256c`）——新增独立 `AI爱买买APP会员服务协议` 法律文本与 `/member-service-agreement` 页面；VIP 礼包选择页底部新增「开通前请阅读并同意《会员服务协议》」；VIP 礼包结算支付页新增醒目的「会员服务协议」卡片与勾选项，未勾选时阻止创建 VIP 支付会话并提示「请先阅读并同意《会员服务协议》」；新增 legal 测试锁定会员协议入口。runtime 1.0.3 production OTA：Group `707d721e-141c-4acb-9830-35d1db96c24e`，Android update `019eb4b0-8945-7603-830d-950aad81f3dd`，iOS update `019eb4b0-8945-7531-9d1a-b7c8260dfccc`；EAS Dashboard `https://expo.dev/accounts/flyspaceden/projects/ai-aimaimai/updates/707d721e-141c-4acb-9830-35d1db96c24e`；命令带全 5 个生产 EXPO_PUBLIC_*（ENV=production + USE_MOCK=false + API_BASE_URL=api + ALIPAY_SANDBOX=false + WECHAT_PAY_AVAILABLE=true）。本次 OTA 输出 commit 为 `6a1256c*`，星号来自临时 main worktree 为避免干扰本机 APK 构建而挂载的未跟踪 `node_modules` symlink；实际源码 commit 与远端 main 均为 `6a1256c`。⚠️ 本次 OTA 只覆盖 runtime 1.0.3；2026-06-11 商店新包首选 `prod-1.0.3-lottery-20260611-222117.apk`（versionCode 9），该包在会员协议包基础上继续内嵌抽奖转盘奖品名完整展示和奖品实例配色修复。

再上一条（2026-06-10，第 15 条）：OPPO SDK 隐私政策公示整改（commit `1857ee8` / main merge `11dd1ba`）——隐私政策升级 `v1.0.2`，附录按 OPPO 审核要求精确公示 `APP支付客户端SDK`（开发者：支付宝(杭州)信息技术有限公司）与 `微信OpenSDK Android`（开发者：深圳市腾讯计算机系统有限公司）的 SDK 名称、开发者、收集信息范围、目的和 SDK 隐私政策链接；同步 App / 爱买买官网 / 华海官网 / Word 审核稿；新增 legal 测试防回归。runtime 1.0.3 production OTA：Group `d605d047-aca2-4018-b8b4-b4c9d93e0754`，Android update `019eb2f9-adab-7c65-b6b8-9b32fd220fca`，iOS update `019eb2f9-adab-77c5-bd5d-18c6be7aaf17`；命令带全 5 个生产 EXPO_PUBLIC_*（ENV=production + USE_MOCK=false + API_BASE_URL=api + ALIPAY_SANDBOX=false + WECHAT_PAY_AVAILABLE=true）。✅ 2026-06-10 23:18 已重新打出 `prod-1.0.3-member-agreement-20260610-230843.apk`（versionCode 8，内嵌隐私 `v1.0.2` + 会员服务协议），可用于商店新用户首启直接看到 OPPO SDK 公示版隐私政策，并在 VIP 开通路径看到会员服务协议；旧 `prod-1.0.3-privacy-v102-20260610-153840.apk`（versionCode 7，未含会员服务协议）、`prod-1.0.3-privacy-20260609-221718.apk`（versionCode 6，内嵌 `v1.0.1`）和 `prod-1.0.3.apk`（versionCode 5，早于 CB08 法律文本补丁）不再作为对外分发首选。

更早一条（2026-06-09，第 14 条）：推荐码剪贴板口令替代 Cookie 弹浏览器（commit `bd1a844` / main merge `92317dc`）——`performDeferredLinkCheck` 改剪贴板优先（`readReferralCodeFromClipboard`，只认推荐链接 URL 格式防误绑）→ 指纹兜底，删除 WebBrowser Custom Tab 路径（首启不再闪网页）；配套 website 同 merge 上线（落地页点下载写剪贴板 + 邀请码大字卡片 + 二维码指向推荐链接堵漏）。**双发 1.0.2 + 1.0.1**：runtime 1.0.2 Group `67379e56-5699-4fd4-a737-dcab79da6936`（小米商店 1.0.2 用户）；runtime 1.0.1 Group `7fb5f823-676e-4c3a-bbae-076e0dac5e06`（华为商店用户，临时 sed `app.json` version→1.0.1 发、sed 还原 1.0.2）。两条均带全 5 个生产 EXPO_PUBLIC_*；纯 JS/TS（expo-clipboard 原生模块 1.0.0 起就在包内），双轮对抗审查通过。✅ 2026-06-10 源码已补隐私政策「剪贴板读取」披露并升级隐私版本 `v1.0.1`；2026-06-09 22:17 已重新打出 `prod-1.0.3-privacy-20260609-221718.apk`（versionCode 6，内嵌 CB08），可用于商店新用户首启直接看到新版隐私政策。旧 `prod-1.0.3.apk`（versionCode 5）早于 CB08 法律文本补丁，不再作为对外分发首选。

更早记录（2026-06-08，第 13 条）：订单号脱敏展示+眼睛展开+复制（`OrderNoReveal` 三页接入，commit `7e4d16f` / main `832b178`）。双发 runtime 1.0.1 Group `ee5dc8eb-b393-4c04-8ccc-51296b656ebc` / runtime 1.0.2 Group `5f872560-9320-4329-b192-8a326a6fd379`。完整历史见 memory `project_app_release_status.md`。

> ⚠️ Preview channel 测试机仍在 runtime **0.3.0**（v1.0 版本号 bump 后未再发 preview OTA，直接 `eas update --branch preview` 会目标 1.0.1 而 0.3.0 测试机收不到）；给测试机发 OTA 前先确认其 runtime。

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
