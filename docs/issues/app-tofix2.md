# 推荐链路全链路 Bug 修复清单（2026-05-04）

> **生成日期**: 2026-05-04
> **触发场景**: 用户买完 VIP，会员中心"我的专属推荐码"显示"暂无推荐码"。审查发现整条推荐链路（QR 生成 → 扫码 → 落地页 → 下载引导 → App 首启延迟匹配 → 注册自动绑定）多点断裂
> **审计方式**: 逐文件 file:line 读取 + 与 `docs/superpowers/specs/2026-03-27-deferred-deep-link-design.md` 设计稿交叉比对
> **状态说明**: ⬜ 待修 | 🔧 修复中 | ✅ 代码已修 | ⏭️ 待部署/迁移 | ❓ 需真机验证 | ⏸️ 暂缓（iOS 阶段再处理）
> **当前测试阶段**: 仅 Android APK 直发分发（无 OSS 公开 URL，靠手动发 APK 文件给测试人员），v1.0 暂未走 iOS App Store / 国内应用商店上架
> **已暂缓**:
> - Bug 2 / Bug 4 / 任务 17 — iOS 阶段再处理
> - Bug 5 — 等正式上架前（应用宝 / 华为 / 小米 / OPPO / vivo），改为应用商店深链；测试期手动发 APK

---

## 总览

| Bug | 严重 | 类别 | 部署方式 | 状态 |
|-----|------|------|----------|------|
| 1 | CRITICAL | 注册时 MemberProfile 不写 referralCode → NULL | 后端部署 + 一次性 SQL 补码 | ⬜ |
| 2 | CRITICAL | iOS AASA 文件 `appID` 占位 `TEAM_ID...` → Universal Link 全失效 | website 部署 + iOS 真机验证 | ⏸️ 暂缓 |
| 3 | CRITICAL | 落地页 Cookie domain 写死 `.xn--ckqa175y.com`（旧域名）+ 中英双活域名 cookie 桶不互通 → Cookie 路径全废 | website 部署 + Nginx 配置 | ⬜ |
| 4 | CRITICAL | App Store 链接 `id000000000` 占位 → iOS 用户没法下载 | website 部署 | ⏸️ 暂缓 |
| 5 | HIGH | Google Play 链接在国内不可达，无 APK / 国内市场 fallback | website 部署 | ⏸️ 暂缓 |
| 6 | HIGH | 启动后已登录态不会主动绑定 pending code（只在 `setLoggedIn` 那一瞬触发） | OTA | ⬜ |
| 7 | HIGH | 指纹精确匹配几乎必失败（浏览器 UA vs RN WebView UA 必定不同） | 后端部署 + OTA | ⬜ |
| 8 | MEDIUM | DDL `ddl_checked` 一次性兜死，永不重试 | OTA | ⬜ |
| 9 | MEDIUM | `app.ai-maimai.com` 子域名是否在宝塔/Nginx 上实际建站 + SSL，需服务器侧确认 | 服务器侧 | ❓ |
| 10 | MEDIUM | Android assetlinks sha256 与 EAS keystore 是否匹配，需真机验证 | 真机 | ❓ |
| 11 | MEDIUM | URL 监听器在隐私同意前不挂 → 待同意期间外部唤起 URL 丢失 | OTA | ⬜ |
| 12 | MEDIUM | 同 IP 多用户碰撞，模糊匹配会拿错码（设计已知权衡） | 后端部署 + 监控 | ⬜ |

---

## 关键判断

**当前可用路径只有两条**：
- ✅ **路径 D**：App 内主动扫码（已登录用户在 scanner 页扫别人的码）
- ✅ **路径 E**：手动输入 8 位推荐码（已登录用户在 Sheet 输入）

**面向新用户的"扫码 → 下载 → 注册自动绑定"几乎全线断裂**，所有路径在 Bug 1 不修的情况下连第 0 步（QR 内容里没有合法推荐码）都过不了。

---

## Bug 详情

### Bug 1 ⚠️ CRITICAL — 注册时 MemberProfile.referralCode 不写入，导致 NULL

**症状**：
- 用户买完 VIP 后，`/api/v1/bonus/member` 返回的 `referralCode` 为空字符串
- 前端 `app/me/vip.tsx:117` `member?.referralCode ?? ''` → 空 → 命中"暂无推荐码"分支

**根因**（数据流追溯）：
1. `backend/prisma/schema.prisma:1718` — `referralCode String? @unique`，可空且无 `@default()`
2. 注册时三处 create 空 MemberProfile：
   - `backend/src/modules/auth/auth.service.ts:127`（手机+密码注册）
   - `backend/src/modules/auth/auth.service.ts:464`（微信首次登录）
   - `backend/src/modules/auth/auth.service.ts:567`（验证码登录自动注册）
   - 三处都是 `memberProfile: { create: {} }`，没生成 `referralCode`
3. 管理端/卖家端也有 5 处 create 空 MemberProfile，后续一旦这些账号进入买家/VIP/推荐链路，同样会留下空推荐码：
   - `backend/src/modules/admin/companies/admin-companies.service.ts:55`（管理端直接创建企业主）
   - `backend/src/modules/admin/companies/admin-companies.service.ts:513`（管理端新增企业员工）
   - `backend/src/modules/admin/companies/admin-companies.service.ts:653`（管理端转移企业主）
   - `backend/src/modules/admin/merchant-applications/admin-merchant-applications.service.ts:131`（商户入驻审核通过自动建用户）
   - `backend/src/modules/seller/company/seller-company.service.ts:273`（卖家端邀请员工自动建用户）
4. `bonus.service.ts:23-50` `getMemberProfile` 的 lazy 自动补码（L25 `if (!member)`）只在 MemberProfile 不存在时触发；注册/建号阶段已经预先建了空记录 → lazy 分支永远进不去
5. VIP 激活 upsert（`bonus.service.ts:256-268`）的 `update` 分支只刷 `tier` 和 `vipPurchasedAt`，**不会补 referralCode**
6. 旁路 upsert 也存在同问题：
   - `engine/normal-broadcast.service.ts:113` — create 分支 `{ userId, normalEligible: true }` 不带 referralCode
   - `engine/bonus-allocation.service.ts:930` — create 分支 `{ userId, normalTreeNodeId, normalJoinedAt }` 不带 referralCode

**修复方案**（2026-05-04 更新：去掉一次性 SQL 补码，改成代码层 lazy 兜底）：
1. 三处注册路径改 `memberProfile: { create: { referralCode: <生成的> } }`，或在 `User.create` 后单独跑一次 upsert 补码
2. 管理端/卖家端 5 处自动建用户路径同步补 `referralCode`
3. VIP 激活 upsert 的 `update` 分支加 `referralCode: existing.referralCode ?? generateReferralCode()`（防覆盖已有码）
4. `normal-broadcast` / `bonus-allocation` 两处 upsert 的 create 分支补 referralCode
5. **`getMemberProfile` lazy 兜底升级**（`bonus.service.ts:23-50`）：当前只在 member 不存在时自动 create；改成"member 存在但 `referralCode` 为 NULL → 也自动补码并 update"。这样：
   - 现有测试账号下次访问会员中心，自动补码 → 不需要跑一次性 SQL
   - 任何漏网之鱼（未来再发现新的"忘记写 referralCode"路径）也会被这层兜底捕获

**为何不用 SQL 一次性补码**：用户确认当前没有真实推荐数据（`ReferralLink` 表空），代码层 lazy 兜底足够；省掉 SQL 备份/dry-run/执行的运维流程。

**回滚说明**：所有改动都在代码层，回滚一个 commit 即可，不留数据残余。

---

### Bug 2 ⚠️ CRITICAL — iOS AASA `appID` 占位，Universal Link 全失效

**位置**：`website/public/.well-known/apple-app-site-association:6`
```json
"appID": "TEAM_ID.com.aimaimai.shop"
```

**症状**：iOS 抓 AASA 时发现 `appID` 不是 10 位 Apple Developer Team ID（如 `ABCD123456.com.aimaimai.shop`），直接拒绝信任此文件 → 所有 `applinks:app.ai-maimai.com` 的 Universal Link **不会唤起 App**，扫码全部退化成 Safari 打开网页。

**修复方案**：
1. 在 Apple Developer 后台拿到 Team ID
2. 把 `apple-app-site-association` 里的 `TEAM_ID` 替换为实际 Team ID
3. 部署 website（注意 `Content-Type: application/json`，不能加 `.json` 后缀）
4. iOS 真机测试：
   - 先把 App 卸载重装一次（让系统重新拉 AASA）
   - 用相机扫 `https://app.ai-maimai.com/r/<合法码>`
   - 期望直接唤起 App，不打开 Safari

**注意**：Apple 缓存 AASA 比较激进，刚改完可能需要等几小时或卸载重装。

---

### Bug 3 ⚠️ CRITICAL — 落地页 Cookie domain 写死旧域名 + 双活域名跨域桶不通

**位置**：`website/src/pages/Download.tsx:24`
```js
const domainStr = isLocalhost ? '' : 'domain=.xn--ckqa175y.com;'
```

**症状**：
- 当前页面 host 是 `app.ai-maimai.com`（以 `docs/operations/阿里云部署.md` / `docs/operations/github操作.md` 记录的实际部署域名为准）
- 但 Cookie Domain 强行设为 `.xn--ckqa175y.com`（爱买买.com 的 punycode，旧域名）
- 按 RFC 6265，浏览器**静默拒绝** Domain 不是请求 host 后缀的 Set-Cookie
- 结果：Cookie 实际**根本没写入** → `Resolve.tsx:14` 永远读不到 `_ddl_id` → cookie 路径全线断
- 影响范围：所有非微信浏览器扫码场景（Safari、Chrome、各家国产浏览器）的 Cookie 兜底全废，只能依靠指纹模糊匹配（Bug 7 又使其成功率近 0）

**双活域名补充矛盾**：

服务器上 `爱买买.com`（xn--ckqa175y.com）和 `ai-maimai.com` 两个域名都在独立 serving 网站内容（含 `app.` 子域名）。**Cookie 按域名隔离**——写在中文域名的 cookie，英文域名一辈子读不到，反之亦然，是两个完全独立的"cookie 桶"。

而 `app/_layout.tsx:60` 写死了 `APP_DOMAIN = 'app.ai-maimai.com'`，App 端只去英文桶找 cookie。

| 用户扫的域名 | Cookie 落在哪个桶 | App 去哪个桶找 | 结果 |
|------------|-----------------|---------------|------|
| `app.ai-maimai.com/r/CODE` | ai-maimai.com 桶 | ai-maimai.com 桶 | ✅ 通 |
| `app.爱买买.com/r/CODE` | 爱买买.com 桶 | ai-maimai.com 桶 | ❌ 永远找不到 |

"网页代码里同时写两份 cookie 到两个域名"做不到——浏览器禁止跨域写 cookie。

**修复方案（A + B + C 三层防御）**：

**A. 服务器侧（运维一次性动作）**：宝塔/Nginx 中文站点把 deep-link 相关路径 301 到英文域名。**只重定向 `/r/*` `/resolve` `/.well-known/` 三类路径，首页/关于页/产品页等保持双活不变**：

```nginx
server {
    server_name app.xn--ckqa175y.com app.爱买买.com;
    location ~ ^/(r/|resolve$|\.well-known/) {
        return 301 https://app.ai-maimai.com$request_uri;
    }
    # 其余路径继续 serving 中文内容
}
```

**B. 前端代码层兜底（防 Nginx 配置漂掉）**：`Download.tsx` 和 `Resolve.tsx` 组件顶部加中文域名重定向：

```js
const host = window.location.hostname
if (host.includes('xn--ckqa175y')) {
  window.location.replace(
    window.location.href.replace(/app\.xn--ckqa175y\.com/, 'app.ai-maimai.com')
  )
  return null  // 等跳转，不渲染本页
}
```

**C. Cookie domain 改为写死英文**：既然 A+B 已保证 deep-link 路径强制走 `app.ai-maimai.com`，`Download.tsx:24` 直接改：

```js
const domainStr = isLocalhost ? '' : 'domain=.ai-maimai.com;'
```

不需要动态判断 hostname（A+B 已经把流量统一了）。

**部署验证**：
1. Nginx reload 后，curl 测试：
   ```bash
   curl -I https://app.xn--ckqa175y.com/r/ABCD1234   # 期望 301 → app.ai-maimai.com
   curl -I https://app.xn--ckqa175y.com/             # 期望 200（中文站点正常）
   ```
2. 浏览器 DevTools 扫一次中文 QR，验证最终落在 `app.ai-maimai.com`，且 Cookie `_ddl_id` 实际写入到 `.ai-maimai.com` 域

---

### Bug 4 ⚠️ CRITICAL — App Store 链接占位

**位置**：`website/src/pages/Download.tsx:80`
```js
window.location.href = 'https://apps.apple.com/app/id000000000'
```

**症状**：iOS 用户点"前往 App Store 下载"跳到 404 页面。

**修复方案**：
1. App Store Connect 里拿到当前 App 的 numeric App ID
2. 替换 `id000000000` 为真实 ID（格式：`id<纯数字>`）
3. 如果当前还没上架（合规手册显示 v1.0 暂未提交），暂时改成 `https://apps.apple.com/cn/developer/<dev-id>` 或显示"即将上架"提示，避免 404 体验

---

### Bug 5 🟠 HIGH — Google Play 链接国内不可达，缺 APK / 国内市场 fallback

**位置**：`website/src/pages/Download.tsx:82`
```js
window.location.href = 'https://play.google.com/store/apps/details?id=com.aimaimai.shop'
```

**症状**：中国大陆用户点 Android 下载按钮，跳 Play Store 卡死/超时（GFW）。当前国内分发渠道是 APK 直链 / 应用宝 / 华为 / 小米 / OPPO / vivo 商店。

**修复方案**（按工作量从小到大）：
- **方案 A（最小**）：把 Play Store 链接改为后端配置项，默认指向当前最新 APK 的 OSS 直链（如 `https://oss.../aimaimai-latest.apk`）。每次 `eas build --profile production --platform android` 后上传 APK 到 OSS 并更新指针
- **方案 B**：检测 UA 决定显示哪个商店深链（华为/小米/OPPO/vivo 商店 schema），fallback 到 APK
- **方案 C**：跳一个"选择应用商店"的中间页，列各家市场图标 + APK 直链

参考 `docs/operations/app-发布与OTA手册.md` 看当前实际分发渠道再决定。

---

### Bug 6 🟠 HIGH — 启动后已登录态不会主动绑定 pending code

**位置**：`src/store/useAuthStore.ts:68-86`

**症状**：
- 用户首次启动 → DDL 匹配成功 → `pending_referral_code` 写入 AsyncStorage
- 用户没立即注册 → 关 App → 下次打开 App 直接看到首页（已是登录态）
- `setLoggedIn` 不会再触发 → 自动绑定逻辑不会执行 → pending code 永远不会绑定

**修复方案**：
- 在 `app/_layout.tsx` 启动钩子里加一段：`isLoggedIn === true && pendingCode 存在` → 主动调一次 `BonusRepo.useReferralCode(code)` 后清除
- 也要处理：用户已是 VIP 时调用会被拒（业务错误），按现有 `Result<T>` 模式直接清 pending（避免堆积）
- **风险**：如果 App 启动时网络不通，调用失败会保留 pending（与现有 catch 逻辑一致），下次启动重试即可

---

### Bug 7 🟠 HIGH — 指纹精确匹配几乎必失败

**位置**：
- 落地页采集：`website/src/pages/Download.tsx:48` `userAgent: navigator.userAgent`
- App 端匹配：`src/services/deferredLink.ts:48` `Constants.getWebViewUserAgentAsync()`
- 后端归一化：`backend/src/modules/deferred-link/deferred-link.service.ts:12-20` 只剥离微信特征

**症状**：
- 落地页采集时 UA 是浏览器 UA（Safari/Chrome/微信内置）
- App 启动时 UA 是 RN 拿到的 WebView UA（iOS 是 WKWebView，Android 是 Chrome WebView）
- 两者字符串差异极大（Safari vs WKWebView 特征不同），SHA256 一字之差即不同
- `normalizeUA` 只处理微信特征，没处理 Safari↔WebView 差异
- 结果：精确匹配（service.ts:94-101）成功率 ≈ 0，所有匹配都掉到模糊匹配（IP + screenInfo），而模糊匹配又有 Bug 12 的同 IP 碰撞风险

**修复方案**（2026-05-04 拍板：保留精确匹配，走方案 B 加强归一化）：
- **方案 B**：UA 归一化加强 — 在 `deferred-link.service.ts:12-20` 的 `normalizeUA` 里继续剥离 Safari/Chrome/WebView 等浏览器引擎字段，只保留 OS + 主版本 + 设备型号（iPhone vs iPad / Android Pixel 6 等）
  - 落地页采集：浏览器原生 UA → 归一化后只剩"OS + 设备"
  - App 端采集：RN WebView UA → 归一化后也只剩"OS + 设备"
  - 两侧归一化结果一致 → SHA256 命中
- 模糊匹配（IP + screenInfo + language）作为兜底**保留不变**
- 配合 Bug 12 的同 IP 多人监控

**为何不删精确匹配**：用户确认精确匹配是 spec 第 3.3 节的设计核心（双层匹配机制），删除即设计回退；改用归一化加强可保持原设计语义。

**风险**：归一化越激进，"OS+设备"维度越粗，碰撞概率越高。需 Bug 12 监控配合：如果同一 fingerprint 在 48h 内有 ≥3 条未消费记录，写日志报警。

---

### Bug 8 🟡 MEDIUM — DDL 一次性兜死，永不重试

**位置**：`app/_layout.tsx:95` `markDDLChecked()` 在 finally 里无条件设为 true

**症状**：
- 用户首次启动 App 时碰巧没网 / 服务器临时宕机 → DDL 匹配失败 → 永久标记已检查 → 再也不重试
- 用户先装 App 但没立即打开（隔了几小时再扫码再打开）→ 第一次启动跑了 DDL 拿不到，第二次启动也不会再匹配

**修复方案**（2026-05-04 拍板：方案 C — 48h 内允许重试）：
- AsyncStorage key 从 `ddl_checked` 改为 `ddl_first_attempt_at`：记录首次尝试时间
- 启动时判断：
  - `ddl_first_attempt_at` 未设置 → 第一次跑 DDL，跑完写入当前时间戳
  - `now - ddl_first_attempt_at < 48h` 且**之前未匹配成功** → 继续重试（每次启动都尝试）
  - `now - ddl_first_attempt_at >= 48h` → 放弃（与后端 `DeferredDeepLink.expiresAt` 48h 对齐，过期记录已被 cron 清理，再试无意义）
  - 一旦匹配成功 → 写另一个 key `ddl_resolved = true` 永久标记，不再尝试

**为何选 48h**：与 `deferred-link.service.ts:52` 的 `expiresAt` 完全对齐——后端记录都已经过期了，App 端再重试也只会查到空，纯粹浪费。48h 内的窗口足够覆盖"扫码后犹豫几小时再下载"的真实场景。

---

### Bug 9 ❓ MEDIUM — `app.ai-maimai.com` 子域名建站状态需服务器侧确认

**症状**：
- `vip.tsx:118` 生成的 QR 链接是 `https://app.ai-maimai.com/r/CODE`
- `_layout.tsx:60` Cookie 兜底 URL 是 `https://app.ai-maimai.com/resolve`
- `.github/workflows/deploy-website.yml:78` 部署到 `/www/wwwroot/website/`
- 仓库里看不到 Nginx 配置（在服务器上）

**待确认**：
1. 宝塔上 `app.ai-maimai.com` 这个子域名是否单独建站？
2. 指向的 root 是不是 `/www/wwwroot/website/`？
3. SSL 证书是否覆盖 `app.` 子域名（通配符或单独申请）？
4. Universal Link 要求 `/.well-known/apple-app-site-association` 必须以 200 + 正确 Content-Type 返回

**验证步骤**：
```bash
# 用户在服务器或本地执行
curl -I https://app.ai-maimai.com/                                   # 期望 200 或 301，非 DNS 错
curl https://app.ai-maimai.com/.well-known/apple-app-site-association  # 期望返回 JSON 内容
curl -I https://app.ai-maimai.com/r/ABCD1234                         # 期望 200（SPA 兜底）
```

如未建站 → 在宝塔新建站点：域名 `app.ai-maimai.com`，root `/www/wwwroot/website/`，配 SSL，加 Nginx fallback `try_files $uri $uri/ /index.html;`。

参考 `docs/operations/阿里云部署.md` 的建站流程。

---

### Bug 10 ❓ MEDIUM — Android assetlinks sha256 与 EAS keystore 是否一致

**位置**：`website/public/.well-known/assetlinks.json:7`
```json
"sha256_cert_fingerprints": ["13:3F:74:69:BF:6F:A7:41:..."]
```

**症状**：sha256 必须与 EAS build 用的实际 keystore 签名证书一致，否则 `autoVerify` 失败 → App Link 退化为"用浏览器 / App 打开"系统选择器，体验割裂。

**验证步骤**：
1. 装最新 production APK 到真机
2. `adb shell pm get-app-links com.aimaimai.shop` → 看 `Status`
   - `verified` ✓
   - `non-verified` / `needs-verification` → sha256 不匹配
3. 不匹配 → 用 `eas credentials` 拿到当前 Android keystore 的 SHA256，更新 assetlinks.json，重新部署 website

参考 `docs/operations/app-发布与OTA手册.md`。

---

### Bug 11 🟡 MEDIUM — 隐私同意门控竞态

**位置**：`app/_layout.tsx:117-127`

**症状**：
- URL 监听器只在 `consentState === 'granted'` 后才挂（L118 的 early return）
- `getInitialURL()` 会返回冷启动 URL（即使晚注册也能拿到）→ **冷启动场景 OK**
- 但用户处于"待同意"弹窗时，外部再发一次 deep link → `addEventListener` 还没挂上 → URL 丢失

**修复方案**：
- 把 `Linking.addEventListener` 提前到组件挂载就注册，回调里再判断 `consentState`：
  - 已同意 → 走 `handleIncomingURL`
  - 未同意 → 暂存到一个 ref，等同意后回放一次

**优先级低**：实际触发的概率低（用户大多冷启动看到弹窗，先同意再做事）。

---

### Bug 12 🟡 MEDIUM — 同 IP 多用户碰撞，模糊匹配可能拿错码

**位置**：`backend/src/modules/deferred-link/deferred-link.service.ts:111-126`

**症状**：
- 公司 / 家庭 / 公共 WiFi 场景，48h 内多人扫码下载
- `findFirst` 按 `createdAt DESC` 取第一条 → 新装 App 的用户拿到的可能不是自己扫的码（被另一个同 WiFi 用户抢了）
- 这是设计文档承认的权衡（spec 第 10.1 节）

**修复方案**（按代价从小到大）：
- **方案 A（最小**）：加监控 — 后台统计同一 IP + screenInfo 在 48h 内有 ≥3 条未消费记录的次数，写日志，便于运营定位异常
- **方案 B**：模糊匹配增加更多字段 — `language` + `userAgent` 前 80 字符相似度（Levenshtein），降低碰撞概率
- **方案 C**：拒绝模糊匹配——同 IP 多条记录直接放弃（牺牲覆盖率换准确率）

设计文档已说明"低频权衡"，建议先做方案 A 监控，看真实碰撞率再决定要不要进一步处理。

---

## 修复方案：执行计划（按风险递增）

### 执行原则（与 app-tpfix1.md 一致）
1. **简单 → 复杂**：先做单文件零逻辑改动，便于精准 revert
2. **一任务一 commit**：commit message 用 `type(scope): 描述` 风格 + Co-Authored-By
3. **本地 commit 不自动推 GitHub**：每阶段完成跟用户复述 + 拿到许可后再 push
4. **涉及钱链路的 Bug 1**：补码脚本 dry-run + 备份后再执行
5. **Bug 1 是先决条件**：不修则后续所有路径连 QR 内容都不合法
6. **每完成一项**：回来更新本文档"进度跟踪表"对应行的状态 + 完成日期

### 进度跟踪表

| # | 阶段 | 任务 | 文件 | 部署 | 状态 | 完成日期 |
|---|------|------|------|------|------|----------|
| **P1** | **零逻辑风险，单文件改动** | | | | | |
| 1a | P1 | Bug 3 落地页 Cookie domain 改 `.ai-maimai.com` | `website/src/pages/Download.tsx:24` | website 部署 | ✅ | 2026-05-04 (commit `2edb8eb`) |
| 1b | P1 | Bug 3 中文域名前端兜底重定向（Download + Resolve 两页） | `website/src/pages/Download.tsx` + `website/src/pages/Resolve.tsx` | website 部署 | ✅ | 2026-05-04 (commit `1c07b12`) |
| 1c | P1 | 审查修订：重定向同步化（Hook 前 early return 阻止首屏闪现） | `Download.tsx` + `Resolve.tsx` | website 部署 | ✅ | 2026-05-04 (commit `03c9ce9`) |
| 1d | P1 | 审查修订：抽 `redirectToCanonicalDomainIfNeeded` 到 `lib/canonicalDomain.ts` 复用 | `website/src/lib/canonicalDomain.ts`（新增）+ `Download.tsx` + `Resolve.tsx` | website 部署 | ✅ | 2026-05-04 (commit `c082be4`) |
| 2 | P1 | ~~Bug 4 App Store 链接占位~~ | `website/src/pages/Download.tsx:80` | — | ⏸️ 暂缓 | iOS 阶段再处理 |
| 3 | P1 | ~~Bug 2 AASA `appID` 替换为真 Team ID~~ | `website/public/.well-known/apple-app-site-association` | — | ⏸️ 暂缓 | iOS 阶段再处理 |
| **P2** | **后端注册路径补码（Bug 1 核心）** | | | | | |
| 4-prep | P2 | prep：generateReferralCode 抽到共享 util | `backend/src/common/utils/referral-code.util.ts`（新增）+ `bonus.service.ts:1195` | 后端部署 + PM2 重启 | ✅ | 2026-05-04 (commit `b85e365`) |
| 4 | P2 | Bug 1 注册三处补 referralCode | `backend/src/modules/auth/auth.service.ts:127, 464, 567` | 后端部署 + PM2 重启 | ✅ | 2026-05-04 (commit `be01329`) |
| 5 | P2 | Bug 1 管理端/卖家端自动建用户路径补 referralCode（5 处） | `admin-companies.service.ts:55,514,654` + `admin-merchant-applications.service.ts:131` + `seller-company.service.ts:273` | 后端部署 + PM2 重启 | ✅ | 2026-05-04 (commit `2878fc3`) |
| 6 | P2 | Bug 1 VIP 激活 upsert update 分支补码 | `backend/src/modules/bonus/bonus.service.ts:256-275` | 后端部署 + PM2 重启 | ✅ | 2026-05-04 (commit `42fa122`) |
| 7 | P2 | Bug 1 旁路 upsert 补码 | `backend/src/modules/bonus/engine/normal-broadcast.service.ts:113` + `bonus-allocation.service.ts:930` | 后端部署 + PM2 重启 | ✅ | 2026-05-04 (commit `e43e046`) |
| 8 | P2 | Bug 1 `getMemberProfile` lazy 兜底升级（NULL 也补码） | `backend/src/modules/bonus/bonus.service.ts:23-50` | 后端部署 + PM2 重启 | ✅ | 2026-05-04 (commit `8af1c46`) |
| **P3** | **App 端启动逻辑改造** | | | | | |
| 9 | P3 | Bug 6 启动后已登录态主动绑 pending code | `app/_layout.tsx`（新加 effect） | OTA | ✅ | 2026-05-04 (commit `6be9f4e`) |
| 10 | P3 | Bug 8 DDL 加 48h 重试窗口（方案 C） | `app/_layout.tsx` + `src/services/deferredLink.ts`（新增 shouldAttemptDDL/recordDDLAttempt/markDDLResolved） | OTA | ✅ | 2026-05-04 (commit `58427b9`) |
| 11 | P3 | Bug 11 URL 监听器提前挂，未同意期间 ref 缓冲，granted 后回放 | `app/_layout.tsx:118-148` | OTA | ✅ | 2026-05-04 (commit `9439518`) |
| **P4** | **指纹算法 + 监控** | | | | | |
| 12 | P4 | Bug 7 后端 UA 归一化加强（保留精确匹配，方案 B） | `backend/src/modules/deferred-link/deferred-link.service.ts:12-32` | 后端部署 + PM2 重启 | ✅ | 2026-05-04 (commit `f1c764a`) |
| 13 | P4 | ~~Bug 5 Android 下载链接改为 APK 直链~~ | `website/src/pages/Download.tsx:82` + 新增配置项 | — | ⏸️ 暂缓 | 测试期手动发 APK；正式上架前再做 |
| 14 | P4 | Bug 12 后端模糊匹配加同 IP 碰撞监控日志（≥3 候选告警） | `backend/src/modules/deferred-link/deferred-link.service.ts:122-150` | 后端部署 + PM2 重启 | ✅ | 2026-05-04 (commit `8f97c3b`) |
| **P-review** | **二次审查发现的问题修订（用户复审）** | | | | | |
| R1 | 修订 | handleReferralCode + useAuthStore NETWORK 错误保留 pending（原本 Result 模式不 throw 导致 try/catch 失效，pending 被清掉） | `app/_layout.tsx:31-46` + `src/store/useAuthStore.ts:68-86` | OTA | ✅ | 2026-05-04 (commit `cadff14`) |
| R2 | 修订 | 启动主动绑 effect 订阅 isLoggedIn 解 zustand persist rehydrate 竞态 | `app/_layout.tsx:108-180` | OTA | ✅ | 2026-05-04 (commit `9feafe9`) |
| R3 | 修订 | 精确指纹多候选监控（findFirst→findMany take 3，>1 候选 logger.warn） | `backend/src/modules/deferred-link/deferred-link.service.ts:105-135` | 后端部署 + PM2 重启 | ✅ | 2026-05-04 (commit `99db409`) |
| R4 | 修订 | pickUniqueReferralCode 预查找 + 13 处 create 入口替换（**降低**而非消除 P2002 概率，残余 race 见 R6 docstring） | `referral-code.util.ts` 新增 helper + 7 个文件 13 处替换 | 后端部署 + PM2 重启 | ✅ | 2026-05-04 (commit `9275557`) |
| R5 | 修订 | 推荐码绑定改用 `result.error.retryable` 判断（原 `code !== 'NETWORK'` 漏掉 5xx/限流，仍可能丢码） | `app/_layout.tsx` × 2 + `useAuthStore.ts` × 1 | OTA | ✅ | 2026-05-04 (commit `2a43bd9`) |
| R6 | 修订 | pickUniqueReferralCode docstring 诚实标注 P2002 残余 race（无逻辑改动） | `backend/src/common/utils/referral-code.util.ts` | 后端部署 + PM2 重启 | ✅ | 2026-05-04 (commit `d16bf03`) |
| **Backlog** | **已知残余风险（不修，仅记录）** | | | | | |
| BL1 | 风险 | 多候选时仍 pick 最新一条（exact 与 fuzzy 路径），同 WiFi/同型号设备扫码理论上会拿错码。当前已加 logger.warn 告警，正确性优先方案是"多候选放弃匹配"——视真机表现再决策 | `deferred-link.service.ts:105-150` | — | ⬜ | 监控告警频率，必要时升级 |
| BL2 | 风险 | 13 处建号 create 没做 P2002 catch + retry，依赖 32^8 + 预查把概率压到接近 0，但理论存在打断风险。生产观测到 P2002 报警再升级"生成 + create" retry helper | `referral-code.util.ts` + 7 个建号文件 | — | ⬜ | 监控生产 P2002，必要时升级 |
| **P5** | **服务器侧验证 / 真机验证** | | | | | |
| 15 | P5 | Bug 9 服务器侧确认 `app.ai-maimai.com` 子域名建站 + SSL | 宝塔面板 | 用户执行 | ❓ | — |
| 15b | P5 | Bug 3 服务器侧加 Nginx 301：中文 `app.` 子域名的 `/r/*` `/resolve` `/.well-known/` 强制跳英文 | 宝塔面板 / Nginx | 用户执行 | ⬜ | — |
| 16 | P5 | Bug 10 Android `adb shell pm get-app-links com.aimaimai.shop` 验证 | 真机 | 用户执行 | ❓ | — |
| 17 | P5 | ~~iOS 卸载重装后真机扫码验证 Universal Link~~ | 真机 | 用户执行 | ⏸️ 暂缓 | iOS 阶段再做 |
| 18 | P5 | Android 真机扫码验证 App Link autoVerify | 真机 | 用户执行 | ❓ | — |
| 19 | P5 | 走完整链路：未装 App + 微信扫码 → 安装 → 注册 → 检查 ReferralLink 是否建立 | 真机 + DB | 用户执行 | ❓ | — |

### 阶段说明

- **P1（任务 1a/1b）**：当前 Android 测试阶段只做 Bug 3 修复（cookie domain + 双活域名兜底重定向），任务 2/3（Bug 4 / Bug 2）暂缓到 iOS 上架阶段
- **P2（任务 4-8）**：Bug 1 后端代码（8 处 create 补码 + getMemberProfile lazy 兜底升级），**不写一次性 SQL**（用户已确认无真实推荐数据，lazy 兜底足够），回滚一个 commit 即可
- **P3（任务 9-11）**：App 端启动逻辑，必须 OTA 真机验证
- **P4（任务 12-14）**：指纹算法 + 国内分发；Bug 5 涉及 OSS 上传 APK 流程，配合 `docs/operations/app-发布与OTA手册.md`
- **P5（任务 15-19）**：服务器侧 + 真机验证，由用户主导执行

### 阶段关卡（每完成一阶段必做）
- ✅ 后端验证：`cd backend && npx prisma validate && npx tsc --noEmit`
- ✅ 买家 App 验证：`npx tsc --noEmit`
- ✅ website 验证：`cd website && npx tsc --noEmit && npm run build`
- ✅ Bug 1 后端部署后回归：访问 `/api/v1/bonus/member` 验证存量 NULL 用户被 lazy 兜底自动补码
- ✅ 跟用户复述本阶段所有 commit + 等回复 + 拿到许可后再 push 部署
- ✅ 每完成一个 bug 更新本文档进度跟踪表 + 完成日期 + commit SHA

---

## 影响场景对照表（修复前 vs 修复后）

> 当前测试阶段仅 Android，iOS 列暂时不作为目标，灰色斜体标识。

| 场景 | 修复前 | Bug 1 修后 | + Bug 3 修后 | + Bug 5/6/7/8 修后 |
|------|--------|-----------|--------------|----------------------|
| Android 已装 + 任意扫码 | ❌ QR 内容空 | ⚠️ 待验 sha256（Bug 10） | ⚠️ 待验 sha256 | ✅ App Link 唤起 |
| Android 未装 国内 | ❌ QR 内容空 | ❌ Play Store 不可达 | ⚠️ Play Store 仍不可达 | ✅ APK/国内市场 fallback |
| 微信内分享链接（Android 已装） | ❌ QR 内容空 | ❌ 走路径 B → cookie 桶不通 | ⚠️ cookie 通了，依赖指纹兜底 | ✅ 指纹放宽 + 启动重试 |
| App 内主动扫码（已登录） | ✅ 通 | ✅ | ✅ | ✅ |
| 手动输入 8 位码 | ✅ 通 | ✅ | ✅ | ✅ |
| _iOS 已装 + 系统相机扫码_（暂缓） | _❌ QR 空_ | _❌ AASA TEAM_ID 错_ | _❌ 同上_ | _留待 iOS 阶段_ |
| _iOS 未装_（暂缓） | _❌ QR 空_ | _❌ AppStore 链接 404_ | _❌ 同上_ | _留待 iOS 阶段_ |

---

## 关联文档

- 设计文档：`docs/superpowers/specs/2026-03-27-deferred-deep-link-design.md`
- 实施计划：`docs/superpowers/plans/2026-03-27-deferred-deep-link.md`
- App 发布手册：`docs/operations/app-发布与OTA手册.md`
- 部署文档：`docs/operations/阿里云部署.md`
- 域名/部署状态：以 `docs/operations/阿里云部署.md` 和 `docs/operations/github操作.md` 记录为准
- 同期 bug 清单：`docs/issues/app-tpfix1.md`（2026-04-29 真机测试 9 bug）
