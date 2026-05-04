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
eas update --branch preview --message "修复xxx / 加xxx功能"

# 推 production 环境（线上正式版）
eas update --branch production --message "修复xxx"

# 同时推两个环境（一般不这么干，先 preview 验，再 production）
eas update --branch preview --branch production --message "xxx"
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

---

## 五、用户侧：OTA 什么时候生效

```
你跑 eas update
    ↓ (~30 秒)
Expo CDN 部署完成
    ↓
用户冷启动 App（杀进程后再开）
    ↓
后台静默下载新 bundle（~3-10 秒，用户用旧版）
    ↓
用户再一次冷启动
    ↓
应用新 bundle ✅
```

**关键事实**：
- OTA 是**双冷启动生效**，不是即时
- 第一次冷启动只下载、不应用
- 用户不杀进程的话永远不会更新
- 所以测试人员第一次报"还是看到 bug" → 让他们杀进程再开一次

---

## 六、当前 App 实际状态（2026-05-04）

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

### Preview Branch 最近 OTA 历史（按时间倒序）

| Group ID | 内容 | 备注 |
|---|---|---|
| `6d987eeb-d0d0-42ed-be0e-c774ed113a40` | 推荐链路全套修复（P1-P4 + 三轮 review）+ 🚨 cookie 路径一次性消费 hotfix | **当前生效** ✅，commit `e573f14` |
| 中间历史 OTA（含引入 cookie 每启动弹浏览器 bug 的版本） | DDL 48h 重试窗口（commit `58427b9`） | ❌ 已被 hotfix 覆盖 |
| `450d71de-8959-4957-ae18-8367bb5872af` | wechat 别名 v2 + 双层 try/catch | 历史 |
| `14729584-7862-4b7d-a447-82f5e95d5462` | 紧急回滚 OTA#2 白屏 | 中间版本 |
| `e22141eb-4d21-4509-8217-2c33a264058a` | wechat 别名注入（顶层版本） | ❌ 引发白屏，已回滚 |
| `92035e48-aad4-4616-a16c-73ccd4a2676f` | DDL 延迟 + referral 兜底 + splash 文案 | 稳定基线 |

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

- 蒲公英 / fir.im：需要 App 备案（工信部），目前未备案 → **无法用**
- 应用商店（华为 / 小米 / 应用宝）：需要软著 + App 备案，未启动
- **当前只能直接发 APK 链接**给测试人员（链接来自 EAS），全国可下载

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
