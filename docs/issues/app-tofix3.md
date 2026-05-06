# 物流链路全链路 Bug 修复清单（2026-05-04 → 2026-05-06 真机端到端 staging 验收完成）

> **生成日期**: 2026-05-04（2026-05-05 沙箱实证后大幅修订；2026-05-06 真机端到端打通）
> **触发场景**: 用户付款链路打通后开始测真机物流，发现整条快递链路（从买家下单到顺丰发货到买家签收到退换货）基本没真实跑通过。文档 `docs/features/shipping.md` 写"顺丰直连 2026-04-12 已完成"，但实际审查后端代码 + 三端前端发现：签名算法错、字段对不上、业务流缺、监控空、前端 PDF 都打不出来
> **审计方式**: 逐文件 file:line 读取 + 与 `docs/features/shipping.md` / `backend/prisma/schema.prisma` / 顺丰丰桥 API 文档交叉比对，2026-05-05 用顺丰开放平台 API 测试工具沙箱真单实证关键 P0
> **状态说明**: ⬜ 待修 | 🔧 修复中 | ✅ 代码已修 | ⏭️ 待部署/迁移 | ❓ 需真机/沙箱验证 | ⏸️ 暂缓
> **真相源**: 顺丰丰桥（https://qiao.sf-express.com）+ 顺丰月结管家（https://v.sf-express.com）+ 本仓库的 `backend/src/modules/shipment/` 全部源码 + 2026-05-05 沙箱抓包

## 🎯 2026-05-06 真机端到端 staging 验收 ✅

**Phase 1（14 项）+ Phase 2（11 主线 + 7 hotfix-1 + 7 hotfix-2 + 3 hotfix-3 + 3 hotfix-4 + 第六轮外审）真机全程跑通**。

### 已验证主链路

| 环节 | 命令/操作 | 结果 |
|---|---|---|
| App 真机下单 + 支付宝沙箱付款 | `EXPO_PUBLIC_ALIPAY_SANDBOX=true` OTA | ✅ |
| admin 后台「自动取号」点击 | Switch 默认开 + 转圈 loading | ✅ 拿到 SF7444703624576 |
| 顺丰沙箱 token 路径鉴权 | `/sf/callback/<32位hex>` | ✅ |
| WaybillRoute / OrderState 双格式解析 | `parseWaybillRoutes` / `parseOrderStates` | ✅ |
| 时间字段安全解析 | `safeParseTime` 替换非 ISO 格式 | ✅ |
| Shipment + TrackingEvent 入库 | `handleSfCallback` 在 Serializable tx 中 | ✅ |
| App 物流时间线显示 | `app/orders/track.tsx` | ✅ |
| SHIPPED → DELIVERED 状态推进 | SF push opCode=80 → 整单已签收 | ✅ |
| DELIVERED → RECEIVED 买家确认收货 | App「确认收货」按钮 | ✅ |
| 商家地址必填校验 | seller + admin 公司信息 | ✅ |
| 普通树插入算法（容忍位置空隙）| `assignNormalTreeNodeInline` 重写扫描真实空位 | ✅ 修了 P2002 |
| VIP_PLATFORM_SPLIT enum 补齐 | `20260506010000_add_vip_platform_split_allocation_rule` | ✅ |

### 真机验收期间发现并修复的额外 bug

| Bug | 位置 | Commit |
|-----|------|--------|
| admin 详情页运单号显示空白（只读 trackingNo 不读 waybillNo）| `admin/src/pages/orders/detail.tsx:242` | `7c506f7` + `10518cf` |
| admin ship Modal 自动取号 10-30 秒无反馈用户多次点击 | `admin/src/pages/orders/index.tsx` | `37e63cd` |
| sender 地址 detail 缺失时 SF 抛 20004 黑盒错误 | `admin-orders.service.ts:452` | `66836ca` |
| seller / admin 公司信息详细地址未必填 | seller `company/index.tsx` + admin `companies/detail.tsx` | `1870327` |
| SF OrderState 推送 body 不含 WaybillRoute → warn 刷屏 | `parsePushPayload` 双格式分派 | `1870327` |
| SF 时间格式 "YYYY-MM-DD HH:mm:ss" Node 解析 Invalid Date | `safeParseTime` | `e4e738f` |
| App OrderCard / StatusHero SHIPPED 显"运输中"与 admin"已发货"不一致 | OrderCard.tsx + StatusHero.tsx | `6eb6d19` |
| 物流追踪页"产地实景联动"占位卡需删除 | `app/orders/track.tsx` | `baee231` |
| 「我的订单」5 tab 拆出"已发货"独立 + 后端 SHIPPED→exact match | `app/orders/index.tsx` + `order.service.ts:291` | `9d8dcfa` |
| 「我的」tab 订单快捷入口同步 5 项 | `app/(tabs)/me.tsx:28` | `fe34eb2` |
| 普通树节点插入算法 nodeCount 推算位置失败（P2002）| `bonus-allocation.service.ts:850` | `243a0f3` |
| AllocationRuleType enum 缺 VIP_PLATFORM_SPLIT（历史遗漏）| Prisma migration | `8d3200f` |

### 验收期间生效的 OTA（preview branch）

按时间倒序，最新优先：

| Group ID | Commit | 内容 |
|---|---|---|
| `6494573b-e0a5-489f-b5b0-12a8b01220b2` | `fe34eb2` | 「我的」tab 订单入口补漏「已发货」第 5 项 |
| `01f8a817-9810-4d39-b496-de05763d2ebc` | `9d8dcfa` | 订单 5 tab 拆已发货/待收货 |
| `01c1a667-aed8-4fed-a5bd-f068c966b6c6` | `6eb6d19` | SHIPPED 显已发货 + 删产地实景占位 |
| `4e713e73-900f-4900-b813-b418ec663607` | `8d3200f` | Phase 2 状态枚举大写迁移 |
| `75b52ea0-9b9e-41d2-92f5-6f8eaa1ba907` | `39600a1` | 重发带回 alipay sandbox flag |

### 待 P1 测试

- 卖家自助发货路径（seller 后台），主路径
- 多商户订单（一个 CheckoutSession 拆多家）
- 退货 / 退款流程

### 未来生产部署 checklist（暂记）

- 推 main 时 `prisma migrate deploy` 会自动应用 VIP_PLATFORM_SPLIT migration
- 顺丰生产推送 URL 改回 `https://api.ai-maimai.com/api/v1/shipments/sf/callback/<token>`
- 生产 .env 要配 SF_PUSH_SECRET（与沙箱不同 secret）
- 申请顺丰生产月结账户 + 切换 SF_MONTHLY_ACCOUNT
- 切回 SF_ENV=PROD（之前是 SANDBOX）

---

## 📌 2026-05-05 21:30 Phase 2 计划（真机端到端测试阻塞项盘点）

**沙箱测试已完成**（6 个 API 全成功 + 协议确认），但**真机端到端测试还有 13 项阻塞**。Phase 2 = 把这 13 项做掉，然后真机跑。

### 🔴 Phase 2 阻塞项（12 项 — 2026-05-06 外审后修订）

| # | Bug | 位置 | 修法 | 工作量 |
|---|-----|------|------|--------|
| **新-1** | Bug 86 — 管理后台 VIP_PACKAGE 调 SF 自动取号 | admin orders + admin-orders.service ship | 提取 generateWaybill 到公共 ShippingService，admin/seller 共享 | 中 |
| **新-2** | Bug 70-补丁 — `parsePushPayload` 真实结构 `{Body:{WaybillRoute}}` | sf-express.service parsePushPayload | 重写返回数组 + 新字段路径 | 小 |
| **新-3** | Bug 87 — **URL secret token 路径**（外审修订：弃用"无签名放行"，改 `/sf/callback/:token` + crypto.timingSafeEqual） | shipment.controller + .env + 顺丰后台 | 32 位随机 secret 写入 .env + 顺丰后台 + 密码本 | 小 |
| 11 | Nginx 配 `/api/v1/shipments/sf/callback/:token` 路由（含 token 路径段） | 测试服 nginx | ssh 配置 + reload | 小 |
| 12 | `handleCallback` 按 trackingNo 查 shipment（trackingNo=null 时跳过）| shipment.service | Bug 14 一起改 — 用 waybillNo 关联 | 中 |
| 13 | `queryTracking` 跳过 `!shipment.trackingNo` | shipment.service | Bug 14 一起改 | 小 |
| 14 | `Shipment.waybillNo` vs `trackingNo` 双字段语义混乱 | schema + shipment.service | 统一：`waybillNo` 是物流单号唯一字段，trackingNo 删除/改别名 | 中 |
| 36 | SF 推送回调返回值格式（OK/ERR XML vs JSON）| shipment.controller | 沙箱实推确认 + 调整 return 格式 | 小 |
| 72 | `ShipmentStatus.SHIPPED` 卖家前端 statusMap 漏 | seller statusMaps | 加映射 | 小 |
| 74 | App OrderStatus lowerCamel vs schema 大写 | App constants | 统一为 schema 枚举值 | 小 |
| 75 | OPERATOR 角色生面单后无法确认发货卡死 | seller-roles guard | 加 OPERATOR 到确认发货权限 | 小 |
| 16 | 买家 App 物流页 fallback 假数据 | app/orders/track | 删 fallback 或显示真空态 | 小 |

**预计总工作量**：1-1.5 天（约 12 个 commit）

**已降级出 Phase 2**:
- ~~Bug 15「付款建 Shipment 行」~~ → **降到 Phase 4**：核实 `seller-shipping.service.ts:184-241` 已经 `findUnique → if exist update / else create`，主链路不阻塞。付款建 INIT 占位是 UX 优化（让 App 立刻显示"待发货"），不阻塞真机测试。

### 🟠 Phase 3 候选（拆分 A/B 子组 — 外审建议采纳）

**Phase 3A — 含影响正向物流稳定性的后台监控能力**（5 项）：
- Bug 20（cancelWaybill 分布式锁）
- Bug 21（queryTracking 节流）
- Bug 22（ShipmentMonitorService 静音）
- Bug 25（买家发货 / 签收 / 异常 Push）
- Bug 26（管理后台物流监控面板）
- Bug 48（卖家物流轨迹卡）
- Bug 85（取消 + 推送在途竞态）

**Phase 3B — 售后 / 退货链路**（5 项）：
- Bug 18（买家退货纯文本输入无校验）
- Bug 19（换货面单字段冗余命名不一致）
- Bug 78（SF 单号孤儿 — 下单成功但本地 rollback 失败）
- Bug 80（卖家拒收回寄没接 SF）
- Bug 24（商家新订单 webhook 通知）

### 🟢 Phase 4+（30+ 项 — 优化 / LOW / 文档；2026-05-06 外审后新增 4 项）

**外审采纳新增**：
- **F4-1**: 全链路 SF 调用日志表 — 保存 `serviceCode / requestId / msgData / msgDigest / parseResult / error`，生产排错必备
- **F4-2**: OSS 持久化失败重试 job — `WaybillUploadJob` 表 + `retried_at` + 指数退避重试，替代当前"留空让卖家手动重试"
- **F4-3**: 沙箱 22/22 联调 checklist — 22 个 SF API 联调进度 + 自动化测试钩子
- **F4-4**: 隐私 trackingNo 双版本暴露处理（原 Bug 73 + 81 整体改造）

**原有项**：边角优化、文档、性能、UI 文案、隐私加固、运营面板：Bug 8 / 9 / 15（降级）/ 23 / 27 / 28 / 29 / 31~35 / 37 / 39~47 / 49~67 / 73 / 76 / 77 / 79 / 81~84

### Phase 2 执行前需验证的 3 个假设（外审后 4→3，Bug 15 已自验消解）

1. ✅ **Bug 11 nginx（2026-05-06 已验证消解）**: 测试服 `/www/server/panel/vhost/nginx/test-api.ai-maimai.com.conf` 已有 `location ^~ / { proxy_pass http://127.0.0.1:3001; ... }` catch-all 反向代理，且包含完整 X-Forwarded-* + 600s timeout，**Bug 87 加 token 路径不需要 nginx 改动**
2. ⏸ **Bug 36 推送返回**: 真推未发生（沙箱「测试」按钮是 SF 内部模拟，access log 无 `/shipments/sf` 记录）。Phase 2 改完 parsePushPayload 后真机端到端时观察：返 JSON `{ok:true}` 200 → 不重推 = 接受；如重推则需改 XML `<Response><Head>OK</Head>`
3. ⏸ **Bug 12 推送 mailno 命中 DB**: 真机走完整链路后 mailno 自动入 DB，bug 可能自动消解（Bug 14 重构 schema 时一并解决）

### Phase 2 准备物料（2026-05-06 已就绪）

- ✅ **SF_PUSH_SECRET 已生成**：32 位随机十六进制，存入 `docs/operations/密码本.md` §七
- ✅ **顺丰沙箱联调 6/22**：核心 API 全部协议级验证通过（下订单/云打印/路由查询/订单查询/取消/筛选）
- ✅ **测试服 .env**：SF_CLIENT_CODE / CHECK_WORD / MONTHLY_ACCOUNT_UAT/PROD / TEMPLATE_CODE / ALLOW_E2E_MOCK 全部就绪

---

## 📌 2026-05-05 Phase 1 第二轮审查加固（4 项追加，已修）

外审 Agent 发现 5 项 Phase 1 残留问题，逐项审查后判定 4 项为真问题（1 项重复），全部已修：

| # | 严重度 | 位置 | 真伪判定 | 修复 |
|---|---|---|---|---|
| 86 | HIGH | `shipment.service.ts:336-345` | ✅ 真 — `msgData`/`timestamp` 任一缺失就跳过签名校验，攻击者能伪造推送改物流状态 | 改成「缺任一签名要素一律 401」，全部三参数必传 |
| 87 | HIGH | `sf-express.service.ts:274-289` | ⚠️ 半真（防御纵深）— 仅判 `success===false`，漏判 `errorCode≠'S0000' && success` 缺失场景 | 加 `(errorCode && errorCode !== 'S0000')` 旁路检查 |
| 88 | MEDIUM | `seller-shipping.service.ts:438-461` | ✅ 真 — OSS 失败回退 SF 临时 URL 入库 = 1-2h 后买家点打印是死链 | 取消回退，`waybillUrl` 留空，日志升 ERROR；卖家走"重新打印"重试 |
| 89 | LOW | `sf-express.service.ts:594` | ⚠️ 理论真但低风险 — `===` 字符串比较存在时序泄露 | 改 `crypto.timingSafeEqual` 加固（先校验长度） |
| 〜 | — | 重复 #88 | ❌ 与 #88 同位置 | — |

单测：sf-express 32 通过 / shipment.controller 67 通过 / seller-shipping 49 通过；`tsc --noEmit` 0 错误。

---

## 📌 2026-05-05 Phase 1 P0 代码已修（10 项）

**commit**: 待 push staging（本地已 commit 候选）
**改动文件**:
- `backend/src/modules/shipment/sf-express.service.ts`（核心 SF 集成）
- `backend/src/modules/shipment/shipment.controller.ts` + `shipment.service.ts`（回调端点）
- `backend/src/modules/shipment/shipment.module.ts`（清理 WebhookIpGuard provider）
- `backend/src/modules/seller/shipping/seller-shipping.service.ts` + `seller-shipping.controller.ts` + `seller-shipping.module.ts`（PDF OSS 持久化 + iframe 兼容）
- `backend/src/modules/upload/upload.service.ts`（新增 `uploadBuffer` 内部直传方法）
- `backend/src/common/utils/remote-binary-fetch.util.ts`（支持 PDF MIME 白名单）
- `backend/.env.example`（UAT/PROD 月结分流 + SF_ALLOW_E2E_MOCK）
- `seller/src/pages/orders/index.tsx`（批量打印 `<img>` → `<iframe>`）
- 单测：`sf-express.service.spec.ts`（32 通过）+ `shipment.controller.spec.ts`（67 通过）+ `seller-shipping.service.spec.ts`（49 通过）

**已修**: Bug 1 / 2 / 3 / 4 / 5 / 7 / 10 / 68 / 70 / 71（详见各 Bug 详情末尾「✅ 实施记录」）
**部署**: 测试服务器 .env 已同步（2026-05-05 19:18 改完，含 SF_TEMPLATE_CODE/SF_MONTHLY_ACCOUNT_UAT/PROD/SF_ALLOW_E2E_MOCK）
**待跑**: 沙箱全流程调测（速运）22 项中 4 项关键用例（下单/云打印/路由查询/取消）

---

## 📌 2026-05-05 沙箱实证关键发现

通过顺丰开放平台「沙箱工具 → API测试工具」用真凭证（clientCode `HHNYKCL5OWXM` + UAT checkWord）打了 3 个 API 拿到真实响应，**关键 P0 全部钉死**：

1. **顺丰协议确认**: V1 form-urlencoded body + 双层响应 `{apiResultCode, apiResultData(JSON 字符串)}` + 业务级 `{success, errorCode, msgData, obj}`
2. **签名算法确认**:「标准MD5」= `Base64(MD5(URLEncode(msgData+timestamp+checkWord, "UTF-8")))`（Java URLEncoder 风格，不是 JS encodeURIComponent）
3. **createOrder 真响应路径**: `apiResultData.msgData.waybillNoInfoList[0].waybillNo`（拿到真单号 `SF7444703608745`）
4. **printWaybill 真响应路径**: `apiResultData.obj.files[0].url`（**临时 OSS 短链，不是 base64**）
5. **真模板代码**: `fm_150_standard_HHNYKCL5OWXM`（之前的 `fm_150_standard_HNGHAfep` 是顺丰文档示例占位，跟我们应用没关系）
6. **沙箱月结号**: `7551234567`（顺丰统一沙箱测试号），生产用我们真号 `7551253482`
7. **customerCode 不必填**: 不传也能触达业务校验层，但建议传以提升健壮性
8. **声明价值/保价/cargoDetails 不必填**: 沙箱接受最小入参，但隐性理赔上限低
9. **协议是 V1 form-urlencoded**（不是新版 V3 JSON），代码现在的 form 提交是对的
10. **联调进度 0/22**: 应用状态「API测试中」，需完成 22 项联调用例 + 顺丰审核才能切生产

## 📌 2026-05-05 三端一致性 / 安全 / 极端时序深度审查（追加 Bug 72-85）

新发现 14 项问题，详见维度 F：
- **3 端状态不一致**：`OrderStatus` App 用 lowerCamel 自创、`ShipmentStatus.SHIPPED` 卖家前端漏映射、PAID 文案 "已付款" vs "待发货" 不一致
- **隐私泄露**：买家 API 返回明文 trackingNo + 脱敏值（双版本暴露）；打印 URL 无 IP 限制可被转发
- **权限边界裂缝**：OPERATOR 能生面单不能确认发货，流程卡死
- **极端时序**：顺丰推送同秒 false-dedupe；下单后本地 DB 失败留孤儿单号；取消 + 推送在途竞态
- **时区一致性**：autoReceiveAt 跨 TZ 漂移可能影响分润 7 天触发
- **死代码**：App 多包裹 UI 永不触发；客服 tel 链接无降级
- **业务流缺**：卖家拒收退货回寄链路没接 SF

---

## 总览（按维度切片）

### 🔴 阻断级（沙箱实证后确证 P0，共 9 项）

| Bug | 文件:行 | 类别 | 部署方式 | 状态 |
|-----|--------|------|----------|------|
| 1 | `sf-express.service.ts:537-562` | 云打印响应路径错：当前读 `obj.files[0].token`（token 是访问授权令牌不是 PDF），实证真路径是 `apiResultData.obj.files[0].url` | 后端 | ✅ 代码已修（待 push staging） |
| 2 | `sf-express.service.ts:144-176, 575-595` | 「标准MD5」签名算法**漏 URL 编码**：当前 `MD5(msgData+timestamp+checkWord)`，应该是 `Base64(MD5(URLEncode(msgData+timestamp+checkWord,"UTF-8")))`（Java URLEncoder 风格，与 JS encodeURIComponent 在 6 个字符上有差异需补丁） | 后端 | ✅ 代码已修（待 push staging） |
| 3 | `sf-express.service.ts:264-306` | `routeLabelForUpdate` 不是回调 URL 字段，删除该字段；回调推送配置入口在丰桥后台 | 后端 + 丰桥后台 | ✅ 代码已修；丰桥后台订阅待你登 sandbox 配 |
| 4 | `shipment.controller.ts:48-90` × `shipment.module.ts` | SF callback 走 `WebhookIpGuard`，生产空白名单 throw 403；签名校验已够，删除该 guard | 后端 | ✅ 代码已修（删 guard + module provider 同步清理） |
| 6 | `.env.example:SF_*` | ~~凭证未申请~~ **已备齐**（密码本.md:176-191，2026-04-17 写入测试 .env） | 部署侧 verify | ✅ |
| 10 | `seller/src/pages/orders/index.tsx:250-289` | 批量打印用 `<img src="${pdfUrl}">`，浏览器不渲染 PDF MIME → 空图标，改 iframe 内嵌或后端合并 PDF | 前端 OTA | ✅ 代码已修（iframe + 800ms 延迟触发 print） |
| 68 | `sf-express.service.ts:122-141` | 沙箱必须用 `7551234567` 月结号（顺丰统一），生产用 `7551253482`；当前代码写死单值，需按 `SF_ENV` 分流 | 后端 + .env | ✅ 代码已修（UAT/PROD 双变量 + legacy fallback）；测试 .env 已同步 |
| 70 | `sf-express.service.ts:191-247` | `callApi` 读响应字段名错：当前读 `result.msgData`，实测顺丰返回字段是 `result.apiResultData`（字符串需 JSON.parse 一次）+ 缺业务级 `success/errorCode` 双层判断 | 后端 | ✅ 代码已修（V2 双层判断 + 兼容 msgData 旧字段名） |
| 71 | `.env.example:60-78` + `sf-express.service.ts:152-162` | `SF_TEMPLATE_CODE="fm_150_standard_HNGHAfep"` 是顺丰文档示例占位，跟我们应用无关；实证我们应用真模板是 `fm_150_standard_HHNYKCL5OWXM`（顺丰用 clientCode 后缀生成）| 后端 + .env | ✅ 代码已修（启动期校验 endsWith `_<clientCode>`）；测试 .env 已同步 |

### 🟠 沙箱首轮必验（共 3 项）

| Bug | 复审后判断 | 状态 |
|-----|----------|------|
| 5 | `seller-shipping.service.ts:436-460` 面单 PDF Base64 落 DB `String?` 列 — 真单 N 单后必拖慢列表，**当前空表无即时影响**，规模化前必改（拿 SF 返回 URL 立即下载到我方 OSS） | ✅ 代码已修（fetchBinaryWithLimit 下载 + UploadService.uploadBuffer OSS 持久化 + 失败回退 SF 临时 URL） |
| 7 | `sf-express.service.ts:251-262` `NODE_ENV=test` mock 写死生产代码 — 防御纵深，加 `SF_ALLOW_E2E_MOCK==='1'` 双重保险 | ✅ 代码已修（SF_ENV!=PROD && NODE_ENV=test && SF_ALLOW_E2E_MOCK=true 三重门）；测试 .env 已同步 false |
| 11 | Nginx 配置 — `/api/v1/shipments/sf/callback` 是否已在生产/测试 Nginx 配 location，**需 ssh 实测** `sudo nginx -T \| grep 'shipments/sf'` | ❓ 待你 ssh 测试服务器验证 |

### 🟢 已实证降级 / 删除

| 原 Bug | 沙箱实证结果 | 调整 |
|-------|-------------|-----|
| Bug 8 (declaredValue/cargoDetails/serviceList) | 沙箱接受不传，但理赔上限低 | 降为 LOW |
| Bug 9 (printWaybill 缺 customerCode) | 不传也能触达业务校验，**非协议必填** | 降为 LOW（建议传沙箱号 `7551234567`）|
| Bug 30 (`SF_TEMPLATE_CODE` 是沙箱模板) | 真因更糟——是别家应用的占位 | **合并到 Bug 71，删除** |
| Bug 38 (V1 form vs V3 JSON 协议) | 沙箱实证 V1 form-urlencoded 是对的 | **误判删除** |
| Bug 6 (凭证未申请) | 凭证已备齐 | **✅ 已完成** |

### 🟡 重要（功能缺失或会出错，共 28 项）

| Bug | 文件:行 | 概要 | 状态 |
|-----|--------|------|------|
| 12 | `shipment.service.ts:174` | `handleCallback` 按 `trackingNo` 查 shipment，但发货前 `trackingNo=null` | ⬜ |
| 13 | `shipment.service.ts:381` | `queryTracking` 跳过 `!shipment.trackingNo` → 面单生成但未"确认发货"时主动刷新永远空 | ⬜ |
| 14 | `schema.prisma:1571-1572` | `Shipment.waybillNo` vs `trackingNo` 双字段 — 顺丰场景下值完全相同，到处条件判断"哪个非空"，含义混乱 | ⬜ |
| 15 | `checkout.service.ts:1450-1482` | 付款建单时**不创建 Shipment 行**（只在卖家点"生成面单"才创建）→ 买家在"已付款 → 卖家发货"之间打开物流页看到 fallback mock 时间线 | ⬜ |
| 16 | `app/orders/track.tsx:24-28` | 没有 shipment 时落 `fallbackTimeline` mock（"青禾农场 / 上海转运中心"）— 真用户看到伪数据 | ⬜ |
| 17 | `seller-after-sale.service.ts:716` | `replacementShipmentId = request.replacementWaybillNo` — shipmentId 字段塞了 waybillNo，语义错位 | ⬜ |
| 18 | `after-sale.service.ts:352-378` | 买家退货物流：`returnCarrierName` 纯文本输入，无格式校验、无顺丰单号正则、不接 SF 路由查询 | ⬜ |
| 19 | `seller-after-sale.controller.ts:281` | 售后换货面单仍走顺丰 createOrder，但 `replacementSfOrderId / replacementCarrierCode` 字段在 schema 里还和 `replacementShipmentId` 重复 | ⬜ |
| 20 | `seller-shipping.service.ts:496-543` | `cancelWaybill` 不获取 `pg_advisory_xact_lock`（generateWaybill 有锁），并发"生成 + 取消"竞态 | ⬜ |
| 21 | `shipment.service.ts:359-497` | `queryTracking` 对每个 shipment 串行调 SF（无 rate limit / 无 last-query 节流），多包裹订单买家狂刷会爆 SF QPS（默认 5 QPS） | ⬜ |
| 22 | `shipment-monitor.service.ts:21,57-61` | 卡单监控只是 `inboxService.send` 通知 + `touch updatedAt` **静音**问题 — 不主动 SF 查询 / 不告警卖家 / 不告警管理员 | ⬜ |
| 23 | `shipment-monitor.service.ts:10` | `STALE_DAYS = 3` 硬编码，无配置项 | ⬜ |
| 24 | 全局 | 缺商家新订单 webhook 通知（钉钉/企微/短信）— 卖家不知道有单要发 | ⬜ |
| 25 | 全局 | 买家发货/签收/物流异常**没有 Push**（仅 Inbox 站内信，关 App 收不到） | ⬜ |
| 26 | `admin/src/pages/` | 管理后台**完全没有**物流监控/Shipment 列表/SF 推送日志/异常面板 | ⬜ |
| 27 | `admin/src/pages/orders/detail.tsx:241-242` | 管理后台订单详情虽然展示物流卡片，但没有"重查 SF / 修改 trackingNo / 强制取消面单"等运营动作 | ⬜ |
| 28 | 全局 | 没有 SF 配置管理 UI（admin） — 切沙箱/生产、看 API 健康全靠 SSH 改 .env | ⬜ |
| 29 | `seller-shipping.service.ts:413` | 顺丰下单 `orderId = ${orderId}_${companyId}` 拼接 ~51 字符，紧贴顺丰 64 字符上限，未来 prefix/cuid 变长会爆 | ⬜ |
| 30 | `sf-express.service.ts:127-130` | `SF_TEMPLATE_CODE` 默认 `fm_150_standard_HNGHAfep` 是沙箱模板代码，生产必须换 | ⬜ |
| 31 | `seller-shipping.service.ts:401-405` | 卖家发货地址不结构化时 `BadRequestException` 抛错，但**没有引导卖家去补地址**的前端跳转链路 | ⬜ |
| 32 | `parse-region.ts` × `seller-shipping.service.ts:88-93` | 直辖市（北京/上海/天津/重庆）和自治区（西藏/新疆）地址解析正确性需 e2e 验证 — 顺丰对收件人区县必填 | ❓ |
| 33 | `schema.prisma:1162` | `ProductSKU.weightGram Int?` 可空 — 卖家若没填重量，SF 下单 `totalWeight=undefined`，运费规则按重量匹配的规则**永远不命中** | ⬜ |
| 34 | `shipping-rule.service.ts:121-166` | 平台运费规则按地区/金额/重量匹配，**没有承运商成本核算** — 平台收 8 元运费但顺丰收 12 元，亏损沉默 | ⬜ |
| 35 | `shipping-rule.service.ts:138-143` | 地区匹配仅用前 2 位省级前缀，**无法表达"省内 vs 省外""偏远地区加价"等**常见快递阶梯 | ⬜ |
| 36 | `shipment.controller.ts:55,90` | SF 推送回调返回值 `{apiResultCode: 'A1000'}` — 这是**请求方**的成功码，**回调方**顺丰期望的应答格式可能不同（待沙箱验证） | ❓ |
| 37 | `seller-shipping.service.ts:419-428` | 收件人 `tel` 直接传明文 — 顺丰丰桥推荐传 `phone` 或 `tel` 字段顺丰文档要求严格区分手机号/座机 | ❓ |
| 38 | `sf-express.service.ts:165-211` | callApi 用 `application/x-www-form-urlencoded` body 发请求 — 顺丰丰桥**新版 V2/V3 协议要求 `application/json` + Header 携带 partner/timestamp/digest** | ❓ |
| 39 | `schema.prisma:2184-2185` | `replacementSfOrderId` 和 `replacementShipmentId` 两个字段语义重叠 + `replacementCarrierCode` 永远是 'SF' 冗余 | ⬜ |

### 🟢 体验/合规层（共 22 项）

| Bug | 文件:行 | 概要 | 状态 |
|-----|--------|------|------|
| 40 | `app/orders/track.tsx:185` | 注释里还写"主动调用快递100查询"— 文案落后 | ⬜ |
| 41 | `app/orders/track.tsx:24-28` | fallback 文案"青禾农场仓库"— 旧品牌名（应改为爱买买） | ⬜ |
| 42 | `app/orders/track.tsx:37-39` | `CARRIER_PHONES` 列了 7 家快递客服，只用 SF 一家，残留代码 | ⬜ |
| 43 | `OrderRepo.ts:680-690` | `getShipment` mock 模式返回随机 `SF${Date.now()}` 单号 + 假事件，开发者切 mock 模式时混淆 | ⬜ |
| 44 | `seller/pages/orders/detail.tsx:300` | 文案"生成面单（顺丰速运）"— 没有"本平台仅支持顺丰"全局说明，卖家可能误以为能选别家 | ⬜ |
| 45 | `seller/pages/orders/detail.tsx:316` | `window.open(waybillPrintUrl, '_blank')` 弹窗依赖浏览器允许 — 没有降级 inline iframe / 无打印调度 | ⬜ |
| 46 | `seller/pages/orders/index.tsx:651` | 批量生面单 Modal 标题写死"批量生成面单（顺丰速运）"— UI 无承运商选择是对的，但应明示"全平台统一顺丰" | ⬜ |
| 47 | `seller/pages/orders/detail.tsx:152-154` | `canManageShipment` 仅 `INIT` 时显示"取消面单"，但已发货后想退回重打没入口 | ⬜ |
| 48 | `seller/pages/orders/detail.tsx:457-517` | 物流信息卡只展示快递公司/单号/时间，**不显示物流轨迹**（卖家追踪不到自己已发的单） | ⬜ |
| 49 | `seller/pages/dashboard/index.tsx` | 卖家 dashboard 没有"待发货 SLA / 卡单数量 / 异常包裹"等物流运营指标（只在订单 tab 计数） | ⬜ |
| 50 | `app/orders/[id].tsx:107` | 买家订单详情"查看物流"跳转 OK，但没有"催发货"按钮 | ⬜ |
| 51 | `app/orders/[id].tsx` | 没有"未发货前修改地址"功能 | ⬜ |
| 52 | `app/me/addresses/...` | 买家地址簿是否强制结构化 省/市/区 输入需核实 — SF 收件人 `province/city/county/address` 都必填 | ❓ |
| 53 | `app/orders/after-sale-detail/[id].tsx:478-484` | 买家退货物流单号无格式校验 / 无 OCR / 无图片上传 | ⬜ |
| 54 | `app/orders/after-sale-detail/[id].tsx` | 买家寄回退货后无法在 App 内追踪退回包裹（卖家也追踪不到） | ⬜ |
| 55 | `seller/src/pages/after-sale/detail.tsx` | 卖家售后页面是否能看买家退货物流轨迹 + 主动查 SF？需核实 | ❓ |
| 56 | `admin/src/pages/shipping-rules/index.tsx` | 平台运费规则页有 preview API，但缺"按地址簿真实测算"+"批量导入规则"+"规则冲突检测" | ⬜ |
| 57 | `admin/src/pages/after-sale/index.tsx` | 仲裁队列没有"快递异常 → 自动升级仲裁"通道 | ⬜ |
| 58 | `seller-shipping.controller.ts:33` | `@Public()` 装饰器加在整个 controller 上，靠各方法各自加 `@UseGuards(SellerAuthGuard)`；打印接口 `printWaybill` 没显式加 SellerAuthGuard，**仅靠 HMAC sig 防御**（设计如此但需文档说明） | ❓ |
| 59 | `seller-shipping.service.ts:317-326` | 打印 URL HMAC 用 `SELLER_JWT_SECRET` 做 key — JWT 轮换会 invalidate 所有正在打印的 URL（轮换罕见，但要文档说明） | ⬜ |
| 60 | `seller-shipping.controller.ts:108-109,140-146` | `recordWaybillPrintAccess` 只记审计日志，没有打印频率 rate limit — 恶意 staff 可批量爬面单 | ⬜ |
| 61 | `schema.prisma:1604-1616` | `ShippingTemplate` model 已废弃但留在 schema — 加 `@@map("...")` 或 migration 删除 | ⬜ |

---

## 关键判断

**当前可在沙箱跑通的最小路径**（修了 P0 之后）：
1. 卖家点"生成面单" → SF createOrder 拿到运单号 → printWaybill 拿 PDF → DB 存 OSS URL
2. 卖家点"打印" → 浏览器下载 PDF → 贴单
3. 卖家点"确认发货" → Shipment INIT → IN_TRANSIT，Order PAID → SHIPPED
4. 顺丰扫码后开始推送回调 → 验签通过 → 写 trackingEvent + 更新 status
5. 全部签收 → CAS 更新 Order DELIVERED + 设 returnWindowExpiresAt
6. autoConfirm cron 7 天后自动 RECEIVED → 触发分润

**整条链路从未跑通过，文档"已完成"是工程"代码骨架完成"，不等于业务可上线。**

---

## Bug 详情

### 维度 A — 顺丰丰桥 API 协议错误（阻断级）

#### Bug 1 ⚠️ CRITICAL — `printWaybill` 响应路径错，PDF 永远取不到

> ✅ **2026-05-05 已修**：`printWaybill` 改返回 `{ pdfUrl }`，读 `apiResultData.obj.files[0].url`；类型 `SfPrintWaybillResult` 已导出；调用方 `seller-shipping.service.ts` 配合 Bug 5 改成下载 + OSS 持久化。

**位置**: `backend/src/modules/shipment/sf-express.service.ts:480-492`

**症状**: 卖家点"生成面单"看到"成功"提示，但 `Shipment.waybillUrl` 是空字符串；点打印按钮下载到空 PDF / 404。

**根因**:
```ts
const fileBase64 = data?.obj?.files?.[0]?.token   // ❌ token 是访问授权令牌不是文件
  || data?.obj?.files?.[0]?.url                    // ✅ 正确路径，但被前面的 token 拦截
  || data?.files?.[0]?.token
  || data?.files?.[0]?.fileBase64;
```

**2026-05-05 沙箱实证响应**（用 API 测试工具真调拿到，应用 clientCode `HHNYKCL5OWXM`）：
```json
{
  "apiResultCode": "A1000",
  "apiResultData": "{\"obj\":{\"clientCode\":\"HHNYKCL5OWXM\",\"fileType\":\"pdf\",\"files\":[{\"areaNo\":1,\"pageCount\":0,\"pageNo\":1,\"seqNo\":1,\"token\":\"AUTH_tkv12_...\",\"url\":\"https://eos-scp-core-shenzhen-futian1-oss.sf-express.com:443/v1.2/AUTH_EOS-SCP-CORE/print-file-sbox/...SF7444703608745_fm_150_standard_HHNYKCL5OWXM_1_1.pdf\",\"waybillNo\":\"SF7444703608745\"}],\"templateCode\":\"fm_150_standard_HHNYKCL5OWXM\"},\"requestId\":\"...\",\"success\":true}"
}
```

**确证真路径**：`apiResultData.obj.files[0].url`（不是 documents 嵌套层，**不是 base64**）。注意 `url` 里包含 `print-file-sbox` 路径片段 = 顺丰沙箱 OSS 临时预签名 URL，**会过期**。

**修复方案**（与 Bug 5 / 70 联动）:
```ts
async printWaybill(waybillNo: string): Promise<{ pdfUrl: string }> {
  if (!this.isConfigured()) throw new BadRequestException('顺丰丰桥服务未配置');

  const msgData = {
    customerCode: this.monthlyAccount,  // 沙箱用 7551234567（Bug 68），非协议必填但建议传
    templateCode: this.templateCode,    // fm_150_standard_HHNYKCL5OWXM（Bug 71）
    version: '2.0',
    fileType: 'pdf',
    sync: true,
    documents: [{ masterWaybillNo: waybillNo }],
  };
  const data = await this.callApi('COM_RECE_CLOUD_PRINT_WAYBILLS', msgData);
  // callApi 已经把 apiResultData 解析 + success 判断（Bug 70）
  const pdfUrl = data?.obj?.files?.[0]?.url;
  if (!pdfUrl) {
    this.logger.error(`顺丰云打印未返回 PDF URL: waybillNo=${waybillNo}, data=${JSON.stringify(data).slice(0, 300)}`);
    throw new BadRequestException('面单打印失败: 未获取到 PDF URL');
  }
  return { pdfUrl };
}
```

接着在 `seller-shipping.service.ts:436-448` 把 `pdfBase64` 字段全部改成 `pdfUrl`，并 fetch 下载存 OSS（Bug 5）。

---

---

#### Bug 2 ⚠️ CRITICAL — 「标准MD5」签名漏 URL 编码（请求 + 推送都受影响）

> ✅ **2026-05-05 已修**：新增 `javaUrlEncode()`（6 字符 patch：` `→`+`、`!'()~`→编码）；`buildVerifyCode` 在 MD5 前先做 URL 编码；`verifyPushSignature(msgData, timestamp, digest)` 改三参数复用同算法；controller 从 body 拆 `msgData` / `timestamp` / `msgDigest` 传入。单测加 32 个 case 含中文/特殊字符对拍。

**位置**:
- 2A 请求签名: `backend/src/modules/shipment/sf-express.service.ts:149-153` (`buildVerifyCode`)
- 2B 推送验签: `backend/src/modules/shipment/sf-express.service.ts:500-512` (`verifyPushSignature`)

**症状**: 真实顺丰调用 / 推送到 `/shipments/sf/callback` 都会被认为签名错。控制台显示 `apiErrorMsg: "数字签名无效"` (apiResultCode `A1006`) 或 `UnauthorizedException("顺丰推送签名验证失败")`。

**根因（之前误判已纠正）**: 之前判断"缺 timestamp 因子"是错的（其实当前代码 `msgDataStr + timestamp + checkWord` 已经把 timestamp 加进去了）。**真根因是**：丰桥应用配的「数字签名: 标准MD5」要求**整个拼接字符串先做一次 Java URLEncoder.encode(UTF-8) 再 MD5**，当前代码漏了这一步。

**当前代码（漏 URL 编码）**:
```ts
buildVerifyCode(msgData: string, timestamp: string): string {
  const raw = msgData + timestamp + this.checkWord;
  const md5Binary = crypto.createHash('md5').update(raw, 'utf8').digest();
  return md5Binary.toString('base64');
}
```

**正确算法（顺丰开放平台 2026-05-05 文档实证 + 多个开发者实现交叉验证）**:
```
msgDigest = Base64( MD5( URLEncoder.encode( msgData + timestamp + checkWord , "UTF-8" ) ) )
```

**JS vs Java URLEncoder 在 6 个字符上不一致**（必须做兼容补丁）：

| 字符 | Java URLEncoder | JS encodeURIComponent |
|------|----------------|---------------------|
| 空格 | `+` | `%20` |
| `!` | `%21` | `!` |
| `~` | `%7E` | `~` |
| `'` | `%27` | `'` |
| `(` | `%28` | `(` |
| `)` | `%29` | `)` |

**修复方案 — Bug 2A（请求签名）**:
```ts
private javaUrlEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/!/g,   '%21')
    .replace(/'/g,   '%27')
    .replace(/\(/g,  '%28')
    .replace(/\)/g,  '%29')
    .replace(/~/g,   '%7E');
}

buildVerifyCode(msgData: string, timestamp: string): string {
  const raw = msgData + timestamp + this.checkWord;
  const encoded = this.javaUrlEncode(raw);          // ← 关键新步骤
  const md5 = crypto.createHash('md5').update(encoded, 'utf8').digest();
  return md5.toString('base64');
}
```

**修复方案 — Bug 2B（推送验签）**:
顺丰路由推送回调采用同算法，但 `timestamp` 在 HTTP Header `Service-Timestamp`（不在 body）：
```ts
verifyPushSignature(msgDataStr: string, timestamp: string, pushDigest?: string): boolean {
  if (!pushDigest) {
    this.logger.warn('顺丰推送缺少签名');
    return false;
  }
  const expected = this.buildVerifyCode(msgDataStr, timestamp);  // 复用同函数
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(pushDigest, 'utf8')
    );
  } catch {
    return false;
  }
}
```

`shipment.controller.ts:62` 控制器从 Header 取 timestamp：
```ts
const timestamp = req.headers['service-timestamp'] || req.headers['x-sf-timestamp'] || '';
```

**单测要求**:
- 用顺丰文档/工具的示例 payload + checkWord，跑 `buildVerifyCode` 输出必须等于顺丰生成的 msgDigest
- 用「鉴权测试工具」交叉对拍

**沙箱实证状态**: Bug 2A 算法已对（顺丰自己的 API 测试工具用同套算法跑通了 createOrder）；Bug 2B 推送验签需要"沙箱全流程调测"实推一次回调验证 — 标记 ❓ 待沙箱实证。

---

#### Bug 3 ⚠️ CRITICAL — `routeLabelForUpdate` 不是顺丰回调 URL 字段

> ✅ **2026-05-05 已修**：`createOrder` msgData 删除 `...(this.callbackUrl ? { routeLabelForUpdate } : {})`；推送订阅改走丰桥后台「订阅服务 → 路由订阅」配置（待你 sandbox 后台手动配）。

**位置**: `backend/src/modules/shipment/sf-express.service.ts:269-271`

**症状**: 即使 `SF_CALLBACK_URL` 配了 `https://api.ai-maimai.com/.../sf/callback`，顺丰也根本不会推送过来。

**根因**:
```ts
...(this.callbackUrl ? { routeLabelForUpdate: this.callbackUrl } : {}),
```
`routeLabelForUpdate` 在丰桥 `EXP_RECE_CREATE_ORDER` 文档里是「电子运单的电子面单内容路由」（控制是否返回 routeLabel 信息），**不是回调 URL 字段**。下单接口本身**不接受**回调 URL 参数。

**正确做法**: 顺丰路由订阅推送地址必须在丰桥后台「应用管理 → 应用详情 → 路由推送配置」里**全局配置一次**（每个应用只能配一个 URL）。

**修复方案**:
1. 删除 `sf-express.service.ts:270` 的 `routeLabelForUpdate` 注入
2. 用户在丰桥后台手动配置：
   - 推送地址：`https://api.ai-maimai.com/api/v1/shipments/sf/callback`
   - 推送鉴权：用顺丰内置的 verifyCode 签名（不需要额外 token）
3. 下单时如果想要顺丰返回路由标签信息（用于打印"路由码"），改成 `isReturnRoutelabel: 1`（已在 line 245）— 这才是该字段的用途
4. 文档同步：`docs/features/shipping.md` 章节 8.x 加一步"在丰桥后台配置回调 URL"

---

#### Bug 4 ⚠️ CRITICAL — `WebhookIpGuard` 生产强校验白名单，顺丰 IP 没维护

> ✅ **2026-05-05 已修**：`shipment.controller.ts` 删 `@UseGuards(WebhookIpGuard)`；`shipment.module.ts` 同步清掉 provider 与 import（payment 模块继续用 guard 保留）。安全完全依赖 Bug 2 修好的标准 MD5 签名校验。

**位置**: `backend/src/common/guards/webhook-ip.guard.ts:40-48` × `backend/src/modules/shipment/shipment.controller.ts:53`

**症状**: 即使签名修好（Bug 2）+ 回调 URL 配好（Bug 3），生产环境 `WEBHOOK_IP_WHITELIST` 没有顺丰 IP 段，顺丰推送一律 `403 ForbiddenException("请求来源不在允许范围内")`。

**根因**:
```ts
if (this.whitelist.length === 0) {
  if (process.env.NODE_ENV === 'production') {
    throw new ForbiddenException('支付回调服务暂不可用');
  }
}
```
顺丰丰桥推送 IP 段顺丰**不主动公布**（避免被攻击者伪造），只能联系顺丰技术对接人索取，且会动态变化。

**修复方案**（三选一，推荐方案 B）:
- **方案 A**: 找顺丰技术对接人要 IP 段（CIDR 列表），加到 `WEBHOOK_IP_WHITELIST`，定期联系顺丰确认更新
- **方案 B**（推荐）: 移除 SF 回调的 `WebhookIpGuard`，**完全依赖签名验证**（Bug 2 修好后签名 = 顺丰共享密钥 + 防重放，已足够防伪造）。`shipment.controller.ts:53` 删掉 `@UseGuards(WebhookIpGuard)`
- **方案 C**: 给 SF 回调单独的 guard `SfPushGuard`，里面只做签名 + timestamp 防重放，不做 IP 白名单

**注意**: 支付回调（微信/支付宝）保留 `WebhookIpGuard` — 它们的 IP 段公开。

---

#### Bug 5 ⚠️ CRITICAL — 面单 PDF Base64 直接落 DB 文本字段

> ✅ **2026-05-05 已修**：`generateWaybill` 拿到 SF `pdfUrl` 后立即 `fetchBinaryWithLimit`（10MB / 15s 上限，PDF MIME 白名单）→ `UploadService.uploadBuffer` 直传 OSS `waybills/<uuid>.pdf` → `waybillUrl` 存 OSS 域名。失败则回退 SF 临时 URL（不阻塞发货，但加日志告警）。打印代理 controller 同步识别 `*.pdf` URL 路径（旧 `data:base64` 仍兼容历史数据）。

**位置**: `backend/src/modules/seller/shipping/seller-shipping.service.ts:436-448` × `schema.prisma:1573 (Shipment.waybillUrl)`

**症状**: 一张顺丰 PDF 200KB-1MB，Base64 后膨胀 33%，写进 `Shipment.waybillUrl String?` 列。后果：
- `findUnique(Shipment)` 一次拖几百 KB 文本流到内存
- React Query 把整串 base64 缓存到前端 store
- 卖家订单列表页 `ProTable` 拉所有列时**直接卡死**（哪怕没显示这一列，Prisma 默认 select all）
- DB 行尺寸接近 toast 边界，全表扫描性能塌方
- `seller-shipping.controller.ts:99-112` 每次打印都从 DB 读 Base64 → decode → 返回 → 慢

**根因**:
```ts
const printResult = await this.sfExpress.printWaybill(orderResult.waybillNo);
waybillUrl = `data:application/pdf;base64,${printResult.pdfBase64}`;
```
文档 `shipping.md` 第 4 个待修问题明确说"应该上传 OSS"，但**从未实施**。

**修复方案**（与 Bug 1 联动）:
1. `printWaybill` 改返回 `{ pdfUrl: string }`（顺丰短链）— 已在 Bug 1 修好
2. 新增 `WaybillStorageService.persistWaybill(pdfUrl): Promise<{ ossUrl: string }>`：
   - 用现有 `upload` 模块下载顺丰短链
   - 上传到阿里云 OSS（私有 bucket，3 年保留）
   - 返回 OSS 永久签名 URL
3. `seller-shipping.service.ts` 调用顺序：createOrder → printWaybill 拿短链 → persistWaybill 转 OSS → 写 DB
4. **Schema 收紧**：`Shipment.waybillUrl` 改为 `@db.VarChar(512)` 仅放 URL，从 migration 起拒绝 base64
5. **数据迁移**：现有 `data:application/pdf;base64,...` 的 row（如果有）批量导出到 OSS，回写 URL（但当前没真单跑，估计是空表）

**🔗 联动修复 — `seller-shipping.controller.ts:99-112` 打印代理**:
当前打印代理逻辑：
```ts
if (printData.waybillUrl.startsWith('data:application/pdf;base64,')) {
  const base64Data = printData.waybillUrl.replace('data:application/pdf;base64,', '');
  const pdfBuffer = Buffer.from(base64Data, 'base64');
  res.setHeader('Content-Type', 'application/pdf');
  return res.send(pdfBuffer);
}
```
Bug 5 修了之后 `waybillUrl` 已经是 OSS URL，**这段 base64 解码逻辑要全部重写**：
```ts
// 改为：从 OSS URL 直接 fetch，pipe 给客户端，过程中加水印
const remote = await fetchBinaryWithLimit(printData.waybillUrl);
res.setHeader('Cache-Control', 'no-store');
res.setHeader('Content-Type', 'application/pdf');
res.setHeader('Content-Disposition', `inline; filename="waybill-${orderId}.pdf"`);
return res.send(remote.buffer);
```
（PDF 水印因复杂度问题暂不加，OSS URL 已经被 HMAC sig 保护）

---

#### Bug 6 ✅ 已完成 — 顺丰凭证已备齐（2026-04-17）

**位置**: `docs/operations/密码本.md:176-191`（gitignored 本地保留）

**实际状态**:
- `clientCode`: `HHNYKCL5OWXM`
- UAT `checkWord`: `1JXsMPM8xT8WFTr5VFOn6T74qn51mN7c`
- PROD `checkWord`: `mO1AN9899aAJJlzO3ilCJPlEbRjScE8n`
- 月结账号: `7551253482`
- 面单模板: 丰巢150标准模板 100×150
- UAT/PROD 回调地址已规划

`docs/operations/阿里云部署.md:552` 记录 `2026-04-17 写入 .env 测试环境配置（顺丰 UAT）`，测试服务器 `backend/.env` 沙箱凭证已就位。

**剩余动作**（不再阻塞，~1 天内可完成）:
1. ❓ Verify 测试服务器 `.env` 当前值与密码本一致：`ssh staging "grep '^SF_' backend/.env"`
2. ❓ Verify `SF_TEMPLATE_CODE` 是否为生产真模板代码（当前 `.env.example` 写的 `fm_150_standard_HNGHAfep` 看起来像真值，但需进丰桥后台「应用 → 模板配置」对照"丰巢150标准模板 100×150"的实际 code 确认）
3. ⬜ 在丰桥后台配置 UAT 回调推送 URL（参见 Bug 3）
4. ⬜ 上线前再切 PROD checkWord + 切 SF_ENV=PROD（参见 Bug 71）

**对全 Phase 计划的影响**: Phase 2「用户外部审批 8-21 天」**不再存在**，可直接 Phase 1 改完代码进沙箱联调。整体上线时间**前移 10-14 天**。

---

#### Bug 7 🟠 MEDIUM（原 CRITICAL，沙箱实证降级）— `NODE_ENV=test` 时返回伪造单号写死在生产代码

> ✅ **2026-05-05 已修**：mock 触发条件从「`NODE_ENV==='test'`」改成「`SF_ENV !== 'PROD'` && `NODE_ENV !== 'production'` && `SF_ALLOW_E2E_MOCK === 'true'` && 调用时 `NODE_ENV === 'test'`」四重门，启动期固化为常量。测试服务器 `.env` 已设 `SF_ALLOW_E2E_MOCK=false`。

**位置**: `backend/src/modules/shipment/sf-express.service.ts:223-233`

**症状**:
```ts
if (process.env.NODE_ENV === 'test') {
  return {
    waybillNo: `SFE2E${ts}`,
    sfOrderId: `SFORDE2E${ts}`,
    ...
  };
}
```
PM2 启动如果忘了 `NODE_ENV=production`（PM2 默认不强制设），生产环境**返回伪造单号且不抛错**，污染真实订单 — 卖家以为下单成功，实际顺丰侧没单。

**修复方案**:
1. 加双重确认：`NODE_ENV==='test' && process.env.SF_ALLOW_E2E_MOCK==='1'` 才返回 mock
2. PM2 ecosystem 文件强制 `NODE_ENV=production`（检查 `ecosystem.config.js` 或 systemd unit）
3. CI 跑测试时 export `SF_ALLOW_E2E_MOCK=1`，本地开发 `.env.local` 也设
4. 生产部署 checklist 加一项"确认 PM2 启动时 NODE_ENV=production"

---

#### Bug 8 🟢 LOW（原 CRITICAL，沙箱实证降级）— createOrder 推荐字段缺失

**沙箱实证（2026-05-05）**: 用最小入参（不传 `declaredValue/cargoDetails/serviceList`）调 `EXP_RECE_CREATE_ORDER` 直接成功 `apiResultCode: A1000`，拿到真单号 `SF7444703608745`。**这些字段不是协议必填，仅是推荐**。

**位置**: `backend/src/modules/shipment/sf-express.service.ts:239-271` + `seller-shipping.service.ts:411-433`

**实际风险（不阻断上线，但隐性损失）**:
- 不传 `declaredValue` → 顺丰按默认 100 元理赔上限，高价值丢件理赔不足
- 不传 `cargoDetails` → 顺丰审计抽查可能要求补，但短期不影响下单成功
- 不传 `serviceList` 保价 → 不强制，平台业务决策项

**Phase 1 不修，留作 Phase 4 优化项**。等首批真单跑通再回头加这些字段。

---

#### Bug 9 🟢 LOW（原 CRITICAL，沙箱实证降级）— `printWaybill` 缺 `customerCode` 字段

**沙箱实证（2026-05-05）**: 不传 `customerCode` 直接调云打印接口，顺丰返回 `apiResultCode: A1000` + 业务级 `success: false` + `errorMessage: "templateCode:xxx is not matched the clientCode:yyy"` — **顺丰直接进入业务校验层（templateCode 验证），说明 customerCode 不是协议必填**。

**仍建议传**: 提升健壮性 + 与生产逻辑统一。

**修复方案（合入 Bug 1 一起改）**:
```ts
const msgData = {
  customerCode: this.monthlyAccount,  // 沙箱 7551234567 / 生产 7551253482（Bug 68 分流）
  templateCode: this.templateCode,
  version: '2.0',
  fileType: 'pdf',
  sync: true,
  documents: [{ masterWaybillNo: waybillNo }],
};
```

---

#### Bug 10 ⚠️ CRITICAL — 卖家批量打印用 `<img>` 标签渲染 PDF

> ✅ **2026-05-05 已修**：`<img>` 改 `<iframe>`；CSS 加 `iframe { width:100%; height:90vh }` 屏显 + `@media print { height:100vh; border:0 }`；`onload` 后 `setTimeout(print, 800)` 等 PDF 加载完再触发打印对话框。

**位置**: `seller/src/pages/orders/index.tsx:240-287`

**症状**:
```tsx
const pages = printableOrders.map((order, index) => `
  <section class="page">
    <header>订单 ${escapeHtml(order.id)}</header>
    <img src="${escapeHtml(url)}" alt="..." />
  </section>
`).join('');
```
`url` 实际上是后端返回的 PDF URL（`Content-Type: application/pdf`），浏览器**不会**在 `<img>` 标签里渲染 PDF — 显示一堆碎图标，批量打印完全不可用。

**修复方案**（按工作量阶梯）:
- **MVP**（1 天）: 改用 `<iframe src="${pdfUrl}" />` 或 `<embed type="application/pdf">`，每个 iframe 占一页
- **进阶**（2-3 天）: 后端新增 `POST /seller/orders/batch-waybill/print-merge` 接口，用 `pdf-lib` 把多个 PDF 合并成一个，前端一次 open
- **顶配**: 接顺丰云打印机（CLOUD 模式打印），跳过浏览器

---

#### Bug 11 ⚠️ CRITICAL — Nginx 未暴露 SF 回调端点

**位置**: 阿里云宝塔站点 `api.ai-maimai.com` 的 Nginx 配置

**症状**: 顺丰推送到 `https://api.ai-maimai.com/api/v1/shipments/sf/callback` 收到 404，因为站点 location 配置可能没把这个路径转发到 NestJS 进程。

**修复方案**:
1. 用户登录宝塔 → 站点设置 → 配置文件，加：
   ```nginx
   location /api/v1/shipments/sf/callback {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_read_timeout 30s;
       client_max_body_size 256k;
   }
   ```
2. 用 curl 模拟一次推送，确认能到达 NestJS：
   ```bash
   curl -X POST https://api.ai-maimai.com/api/v1/shipments/sf/callback \
     -H 'Content-Type: application/json' \
     -d '{"msgData":"{}"}' -v
   ```
3. 更新 `docs/operations/阿里云部署.md` 第 X 章「物流」节
4. 同时确认 `client_max_body_size` 足够（顺丰推送轨迹 payload 一般 < 50 KB，256k 够用）

---

### 维度 B — 数据流 / 业务链路逻辑（重要）

#### Bug 12 🟡 HIGH — `handleCallback` 按 `trackingNo` 查 shipment，发货前 trackingNo 为 null

**位置**: `backend/src/modules/shipment/shipment.service.ts:174`

**症状**:
```ts
const shipment = await this.prisma.shipment.findFirst({ where: { trackingNo } });
if (!shipment) throw new NotFoundException('物流单号未找到');
```
`Shipment.trackingNo` 只在卖家点"确认发货"那一刻被设置（`seller-orders.service.ts:330` `trackingNo: freshShipment.waybillNo`）。如果顺丰在卖家"生成面单"后、"确认发货"前推送（理论上不会但偶发），shipment 行只有 `waybillNo` 没有 `trackingNo`，回调被 NotFound 抛掉。

**修复方案**:
```ts
const shipment = await this.prisma.shipment.findFirst({
  where: { OR: [{ trackingNo }, { waybillNo: trackingNo }] },
});
```
或者根本上**统一字段**（参见 Bug 14）。

---

#### Bug 13 🟡 HIGH — `queryTracking` 跳过 `!shipment.trackingNo`

**位置**: `backend/src/modules/shipment/shipment.service.ts:381-389`

**症状**: 同 Bug 12。买家在面单生成、卖家未点"确认发货"窗口期点"刷新物流"，因为 `shipment.trackingNo === null`，循环里 `continue`，永远空。

**修复方案**: 同 Bug 12，用 `shipment.trackingNo || shipment.waybillNo` 兜底。

---

#### Bug 14 🟡 HIGH — `Shipment.waybillNo` vs `trackingNo` 双字段语义混乱

**位置**: `backend/prisma/schema.prisma:1571-1572`

**根因**: 历史遗留 — 快递100时代 `waybillNo` 是面单号，`trackingNo` 是真实运单号（少数快递公司面单号 ≠ 运单号）。**顺丰场景下两者完全相同**，但代码里到处条件判断"哪个字段非空"，**含义混乱**：
- `seller-orders.service.ts:289` `if (!companyShipment?.waybillNo)` 判面单
- `seller-orders.service.ts:330` `trackingNo: freshShipment.waybillNo` 拷贝
- `shipment.service.ts:174,381` 查询用 `trackingNo`
- `seller-orders.service.ts:246` 列表显示 `trackingNo || waybillNo` 兜底

**修复方案**（任选其一）:
- **方案 A（推荐）**: 删 `trackingNo`，全部统一用 `waybillNo`。Migration:
  ```sql
  -- 把 trackingNo 数据回填到 waybillNo（绝大多数已经一样）
  UPDATE "Shipment" SET "waybillNo" = COALESCE("waybillNo", "trackingNo");
  ALTER TABLE "Shipment" DROP COLUMN "trackingNo";
  ```
  改三处 service 用 `waybillNo`
- **方案 B**: 文档化定义 `waybillNo` = SF 下单返回，`trackingNo` = 已发货状态镜像。所有查询统一查 `waybillNo`，trackingNo 仅作"是否已发货"标记位

---

#### Bug 15 🟡 HIGH — 付款建单时不创建 Shipment 行

**位置**: `backend/src/modules/order/checkout.service.ts:1450-1482`（建单 `tx.order.create`）

**症状**: 多搜了整个 `checkout.service.ts` + `payment` 模块都没有 `tx.shipment.create({...})`。Shipment 行只在卖家**手动点"生成面单"**时才被创建。

**链路时序**:
```
PAID 时刻 → Order 创建 ✅ Shipment 不创建 ❌
卖家生成面单 → Shipment 创建（status=INIT）
卖家确认发货 → Shipment status=IN_TRANSIT
```

**问题**:
1. 买家在"已付款 → 卖家生成面单"窗口期打开物流页（`/orders/track`），后端 `getByOrderId` 返回 `null`，前端走 `fallbackTimeline` 显示假数据（参见 Bug 16）
2. 多商家订单 checkout 已经按 company 拆成多 Order（`for (let idx = 0; idx < companyGroups.length; idx++)`），所以**每个 Order 只对应 1 个 Shipment**。但 `Shipment` schema `@@unique([orderId, companyId])` 暗示支持多 shipment / order — **schema 设计与 checkout 实现不一致**

**修复方案**:
- **选项 A（推荐）**: 在 `checkout.service.ts` 建单时同步建 Shipment（status = `PENDING_LABEL`，企业 = 订单的 companyId）。卖家生成面单时 update 这一行。状态机加：`PENDING_LABEL → INIT → IN_TRANSIT → DELIVERED`
- **选项 B**: 保持现状，但 `getByOrderId` 在没有 shipment 时返回 `{ status: 'AWAITING_SHIPMENT', message: '卖家正在打包' }`，前端识别该 sentinel 显示"卖家正在准备发货"占位
- **同步删除**: 既然每 order 只一个 shipment，schema unique 保留没问题，但应该在 doc 上明确"实际场景一对一"

---

#### Bug 16 🟡 HIGH — 买家 App 物流页 fallback 显示假数据

**位置**: `app/orders/track.tsx:24-28, 148-158`

**症状**:
```tsx
const fallbackTimeline = [
  { id: 't1', time: '今天 09:20', status: '包裹已揽收', location: '上海转运中心' },
  { id: 't2', time: '昨天 18:40', status: '已发货', location: '青禾农场仓库' },
  ...
];
const timeline = useMemo(() => {
  if (shipment?.events && shipment.events.length > 0) { ... }
  return fallbackTimeline;
}, [shipment]);
```
当 `shipment === null`（未建 Shipment 行）或 `shipment.events.length === 0`（已建 Shipment 但无轨迹）时，**展示完全虚构的"上海转运中心"等位置**。买家以为真有物流，实际卖家还没打包。

**修复方案**:
1. 删 `fallbackTimeline`
2. 三态分流：
   - `shipment === null` → "卖家正在打包，请耐心等待"（Empty 态 + 倒计时商家发货 SLA）
   - `shipment.status === 'INIT' && events.length === 0` → "面单已生成，等待顺丰揽收"
   - `events.length > 0` → 显示真实轨迹
3. 配合 Bug 15 选项 B 的 sentinel 状态，UI 文案精确匹配

---

#### Bug 17 🟡 HIGH — `replacementShipmentId = replacementWaybillNo` 字段语义错位

**位置**: `backend/src/modules/seller/after-sale/seller-after-sale.service.ts:716`

**症状**:
```ts
data: {
  status: 'REPLACEMENT_SHIPPED',
  replacementShipmentId: request.replacementWaybillNo,  // ❌ 不是 shipment id
}
```
`AfterSaleRequest.replacementShipmentId` 字段名暗示是 `Shipment.id` 外键，但实际塞了 `waybillNo`（运单号字符串）。

**修复方案**:
- **方案 A**: 删字段 `replacementShipmentId`（schema migration），代码用 `replacementWaybillNo` 即可
- **方案 B**: 给售后换货也建立独立 `Shipment` 行（关联 `AfterSaleRequest.id` 而不是 `Order.id`），`replacementShipmentId` 真存 Shipment id。这样换货物流轨迹也能用 `ShipmentTrackingEvent` 表 + 共用回调链路（推荐，但工作量大）

---

#### Bug 18 🟡 HIGH — 买家退货物流：纯文本输入，无格式校验，不接 SF 路由查询

**位置**: `backend/src/modules/after-sale/after-sale.service.ts:352-388` + `app/orders/after-sale-detail/[id].tsx:478-484`

**症状**:
- 买家在 App 手填"快递公司"和"运单号"，**没有任何格式校验**（后端只存原文）
- 顺丰单号 `SF1234567890` 12 位 / 圆通 `YT1234567890123`13 位 — 纯字符串塞库
- 卖家收到退货物流号后**无法主动查 SF**（只能等买家寄到、卖家手动签收）
- 买家自己也**追踪不到**自己寄回的包裹（App 物流页只显示 Order 关联的 Shipment）

**修复方案**:
1. 后端 `AfterSaleFillReturnShippingDto` 加正则校验：
   ```ts
   @Matches(/^SF\d{10,12}$/, { message: '请填写 SF 开头 12 位顺丰单号' })
   returnWaybillNo: string;
   ```
2. 既然平台只用顺丰，**强制买家用顺丰寄回**（文案"请使用顺丰快递寄回"，去掉 carrier 输入框，仅留顺丰单号）
3. 后端调 `SfExpressService.queryRoutes(returnWaybillNo)` 验证单号确实存在
4. 给退货建一条独立 `ReturnShipment` 关联 `AfterSaleRequest`（参考 Bug 17 方案 B），共用现有轨迹追踪能力
5. 买家 App 售后详情页加"查看退回物流"按钮，跳转到独立追踪页

---

#### Bug 19 🟡 HIGH — 售后换货面单字段冗余 + 命名不一致

**位置**: `backend/prisma/schema.prisma:2179-2185`

**症状**:
```prisma
replacementCarrierCode String?   // 永远是 'SF'
replacementCarrierName String?   // 永远是 '顺丰速运'
replacementWaybillNo  String?
replacementWaybillUrl String?
replacementSfOrderId String?     // SF 订单ID（用于取消/复打）
replacementShipmentId String?    // 与 replacementWaybillNo 重复（参见 Bug 17）
```

**修复方案**:
- 删 `replacementCarrierCode / replacementCarrierName / replacementShipmentId`
- 保留 `replacementWaybillNo / replacementWaybillUrl / replacementSfOrderId`
- 等做完 Bug 17 方案 B 后，全部字段迁到独立 `ReplacementShipment` 表
- Schema 注释：`// 仅顺丰发货，承运商默认 SF` 而不是冗余存

---

#### Bug 20 🟡 HIGH — `cancelWaybill` 不获取分布式锁，并发"生成 + 取消"竞态

**位置**: `backend/src/modules/seller/shipping/seller-shipping.service.ts:496-543`

**症状**: `generateWaybill` 用 `pg_advisory_xact_lock(seller-waybill-order, companyId:orderId)` 防并发生成，但 `cancelWaybill` 没拿同一把锁。两个 staff 同时点"生成"+"取消"或重复点击时：
- 取消刚把 `waybillNo = null` 写入，但顺丰侧面单还在
- 生成又拿到新锁，再次创建 → 顺丰返回相同 orderId 重复错（被 cancelOrder 幂等吃掉），但本地状态可能 inconsistent

**修复方案**:
```ts
async cancelWaybill(companyId: string, orderId: string) {
  await this.prisma.$transaction(async (tx) => {
    await this.acquireWaybillGenerationLock(tx, `${companyId}:${orderId}`);
    // ... 后续逻辑
  });
}
```
或者干脆：先在 controller 层用 `RedisLock` / `pg_try_advisory_lock` 拿锁，避免事务边界。

---

#### Bug 21 🟡 HIGH — `queryTracking` 串行调 SF，无节流，多包裹订单狂刷会爆 SF QPS

**位置**: `backend/src/modules/shipment/shipment.service.ts:359-497`

**症状**: 当前实现对每个 `shipment` 串行调用 `sfExpress.queryRoutes`。虽然多商家订单已被拆成多 Order（每 Order 1 Shipment），所以"多 shipment / order"场景几乎不存在；但**仍然没有 last-query-at 节流**：
- 买家进物流页就调 `queryTracking`
- 下拉刷新又调
- 上下文切换刷新又调
- 5 个买家同时刷 = 5 QPS，丰桥单接口默认限速 5 QPS，**直接 429**

**修复方案**:
1. 给 `Shipment` 加字段 `lastSfQueryAt DateTime?`
2. `queryTracking` 节流：距上次查询 < 60 秒直接返回缓存
3. 用 `BullMQ` 把"主动查询"做成异步 job，前端"下拉刷新"=入队，立即返回缓存 + 后台异步刷
4. 监控 SF API 错误码 429 → 自动 backoff

---

#### Bug 22 🟡 HIGH — `ShipmentMonitorService` 静音问题不告警

**位置**: `backend/src/modules/shipment/shipment-monitor.service.ts:21-68`

**症状**:
```ts
@Cron(CronExpression.EVERY_DAY_AT_9AM)
async checkStaleShipments() {
  // 找 IN_TRANSIT 且 updatedAt < N 天前的
  // 通知买家"物流更新异常"
  // touch updatedAt → 防止重复通知
}
```
**问题**:
1. 卡单原因可能是 Bug 2（签名失败 → 推送全丢）— 监控只是告诉买家"物流异常"，**不主动重新查 SF**，**不告警卖家或管理员**
2. `touch updatedAt` 是**静音**问题 — 第 4 天 updatedAt 又被更新，查不出来了
3. 没有"异常包裹列表"管理后台页面（参见 Bug 26）
4. 3 天硬编码，无法配置

**修复方案**:
1. 卡单时**主动调用 `sfExpress.queryRoutes`** 强制刷新一次轨迹
2. 真没轨迹更新时：通知**买家 + 卖家 + 客服管理员**三方
3. 不要 touch updatedAt — 改用单独字段 `staleNotifiedAt`，控制重复通知频率（每 3 天通知一次而不是只通知一次）
4. STALE_DAYS 改为 system_config 项可在管理后台调

---

#### Bug 23 🟡 MEDIUM — `STALE_DAYS = 3` 硬编码

**位置**: `backend/src/modules/shipment/shipment-monitor.service.ts:10`

**修复方案**: 从 `BonusConfigService.getSystemConfig()` 读 `shipmentStaleDays`，默认 3，管理后台可配。

---

#### Bug 24 🟡 HIGH — 缺商家新订单 webhook 通知

**位置**: 全局缺失，无对应文件

**症状**: 买家付款 → Order 创建为 PAID，**卖家如果没主动登录后台也不会知道**。订单积压 → 买家长时间等待。

**修复方案**:
1. 新增 `backend/src/modules/notification/merchant-notification.service.ts`
2. `Company` 增加字段 `notifyWebhookType`（DINGTALK/WECHAT_WORK/EMAIL/SMS）+ `notifyWebhookUrl` + `notifySecret`
3. 卖家后台「企业信息」页加"接单通知"配置入口
4. checkout 建单成功事件订阅器：
   - 异步调 webhook（钉钉/企微 markdown 格式）
   - 失败重试 3 次（指数退避）+ 入死信队列
5. MVP 优先做钉钉机器人 + 企微机器人（免费、文档简单）

---

#### Bug 25 🟡 HIGH — 买家发货/签收/物流异常没有 Push

**位置**: 全局，App 端没接 expo-notifications/极光/FCM

**症状**: `inboxService.send` 只写 DB 站内信，关 App 完全感知不到。

**修复方案**（按优先级）:
1. **MVP**: 接 expo-notifications + APNs（iOS）/FCM（Android）
2. 设备 token 注册：用户登录时把 expo push token 发给后端
3. `Shipment` 状态变更时：发货 → "您的订单已由顺丰发出"；签收 → "包裹已送达，请确认收货"；异常 → "物流异常，请联系客服"
4. iOS 阶段再处理（参考 app-tofix2 暂缓策略），先做 Android FCM
5. 文档同步 `docs/operations/app-发布与OTA手册.md`

---

#### Bug 26 🟡 HIGH — 管理后台无物流监控面板

**位置**: `admin/src/pages/`

**症状**: 完全没有：
- Shipment 列表 / 状态分布
- SF 推送原始日志
- 卡单告警面板
- 手动重查 / 修改单号 / 强制取消的运营动作
- SF API 健康监控（成功率/平均延迟）

**修复方案**:
1. 新增 `admin/src/pages/shipments/index.tsx`：
   - ProTable 列：订单 / 商家 / 单号 / 状态 / shippedAt / lastEventAt
   - 按状态/商家/卡单天数筛选
   - 行操作：「重查 SF」「修改单号」「强制取消」「查看推送日志」
2. 新增 `admin/src/pages/shipments/sf-callbacks.tsx` — SF 推送原始 payload 列表
3. 新增 `admin/src/pages/shipments/dashboard.tsx` — SF API 健康指标
4. 后端 `admin/shipments` controller + service
5. 给 Shipment 加字段 `lastEventAt DateTime?`（最后一条 trackingEvent 时间），方便监控查询
6. 引入 `Shipment.rawCarrierPayload Json?`（schema 已有此字段但代码从不写入）— 写入 SF 推送原文用于 debug

---

#### Bug 27 🟡 MEDIUM — 管理后台订单详情缺物流运营动作

**位置**: `admin/src/pages/orders/detail.tsx:241-242`

**症状**: 物流卡片只展示快递公司/单号/时间，没有「重查 SF」「编辑 trackingNo」「强制取消面单」等运营按钮。

**修复方案**: 同 Bug 26，把 admin/shipments 的能力下放到 order detail 内嵌。

---

#### Bug 28 🟡 MEDIUM — 没有 SF 配置管理 UI

**位置**: `admin/src/pages/`

**症状**: 切沙箱/生产、看 API 健康、改 templateCode 全靠 SSH 改 .env + 重启 PM2。

**修复方案**:
1. 把 SF_TEMPLATE_CODE / SF_ENV 等可配置项移到 `system_config` 表
2. 管理后台新增「物流配置」页：
   - 沙箱/生产环境切换（带二次确认）
   - 模板代码切换
   - "Ping SF" 按钮（调一个无副作用 API 测试连通性）
3. SF_CLIENT_CODE / SF_CHECK_WORD / SF_MONTHLY_ACCOUNT 仍走 .env（敏感凭据不入库）

---

#### Bug 29 🟡 MEDIUM — 顺丰下单 orderId 拼接接近 64 字符上限

**位置**: `backend/src/modules/seller/shipping/seller-shipping.service.ts:413`

**症状**:
```ts
orderId: `${orderId}_${companyId}`,  // 25+1+25 ≈ 51 字符
```
两个 cuid 拼接 51 字符，紧贴顺丰 `orderId` 64 字符上限。未来如果给 orderId 加 prefix（如 `O_xxx`）或 cuid 升 cuid2 变长会爆。

**修复方案**:
- 用短哈希压缩：`orderId: "AS-" + crypto.createHash('sha1').update(${orderId}_${companyId}).digest('hex').slice(0, 32)` (35 字符)
- 同时建个本地映射表 `SfOrderIdMapping(sfOrderId → orderId+companyId)` 方便后续查
- 售后换货同理（line 834 用 `AS_${id}`，约 28 字符，够用，但要统一格式）

---

#### Bug 30 ❌ 已删除（2026-05-05 沙箱实证后合并到 Bug 71）

**原描述**: `SF_TEMPLATE_CODE` 默认是沙箱模板，生产需切换。

**实证发现**: 默认值 `fm_150_standard_HNGHAfep` **不是沙箱模板代码**，是**别家应用的占位**（`HNGHAfep` 是顺丰文档示例 clientCode 的后缀，跟我们应用无关）。问题更严重，已合并到 **Bug 71**。

---

#### Bug 31 🟡 MEDIUM — 卖家发货地址不结构化时报错但无引导

**位置**: `backend/src/modules/seller/shipping/seller-shipping.service.ts:401-405`

**症状**:
```ts
if (!senderInfo.senderProvince || !senderInfo.senderCity) {
  throw new BadRequestException(
    '企业发货地址不完整，请在「企业信息」页面补充省市区详细地址后再发货',
  );
}
```
报错文案是清楚的，但卖家前端拿到这个错误**只显示 message，不跳转**。卖家要手动点导航到「企业信息」。

**修复方案**:
1. 后端错误增加结构化 code：
   ```ts
   throw new BadRequestException({
     code: 'SENDER_ADDRESS_INCOMPLETE',
     message: '...',
     redirectTo: '/company/profile',
   });
   ```
2. 前端订单详情页捕获 `SENDER_ADDRESS_INCOMPLETE` → 弹"立即去补"按钮 → `navigate('/company/profile')`
3. 卖家入驻流程增加"发货地址必填"前置校验（参见 Bug 32）

---

#### Bug 32 🟡 MEDIUM — 直辖市/自治区地址解析需 e2e 验证

**位置**: `backend/src/common/utils/parse-region.ts` × `seller-shipping.service.ts:88-93`

**症状**: 顺丰对收件人 `province / city / county / address` 都强制要求非空。直辖市（北京/上海/天津/重庆）"市 == 区"，部分用户填"北京市朝阳区"省级是"北京市"还是空？自治区（西藏/新疆/广西/宁夏/内蒙古）格式 "新疆维吾尔自治区乌鲁木齐市天山区" — `parseChineseAddress` 是否能正确切？

**修复方案**:
1. 写单元测试覆盖 31 省 + 主要直辖市/自治区
2. 沙箱真调 SF createOrder 验收件人解析正确（顺丰会返回参数错）
3. 边界格式：「北京 朝阳区 望京街 1 号」（无"市"字）/「新疆乌鲁木齐天山」（无"市/区"字）

---

#### Bug 33 🟡 MEDIUM — `ProductSKU.weightGram` 可空，运费规则按重量永不命中

**位置**: `backend/prisma/schema.prisma:1162` × `checkout.service.ts:402-407`

**症状**:
```ts
const skuWeightMap = new Map<string, number>();
for (const [id, sku] of skuMap.entries()) {
  skuWeightMap.set(id, (sku as any).weightGram ?? 0);
}
```
卖家如果没填 `weightGram`，`totalWeight = 0`，所有"按重量匹配"的运费规则永远不命中（因为 `minWeight > 0` 的规则被跳过）。

**修复方案**:
1. 卖家商品创建表单：`weightGram` 改必填（同时给重量段建议：500g / 1kg / 3kg）
2. 已有商品如果 `weightGram = null`：管理后台批量补 1000g 默认值
3. SF createOrder 时如果重量为 0，传默认 1kg 而不是 undefined（顺丰按 1 公斤计费）
4. 文档化：`docs/architecture/sales.md` 加"商品上架重量必填"

---

#### Bug 34 🟡 MEDIUM — 平台运费规则没有承运商成本核算

**位置**: `backend/src/modules/admin/shipping-rule/shipping-rule.service.ts:121-166`

**症状**: 平台收买家 8 元运费，但顺丰对平台收 12 元（按月结协议价），亏损 4 元/单沉默。

**修复方案**:
1. `ShippingRule` 加字段 `actualCarrierCost Float?`（参考成本，用于核算）
2. 管理后台运费规则表增加列"实际成本/收费/利润率"
3. 顺丰真实运费从月结对账单解析（人工或自动）
4. 月度盈亏报表（关联现有 `analytics`）
5. 这是商业决策项，需先和老板确认要不要做差额管控

---

#### Bug 35 🟡 LOW — 平台运费规则地区匹配粒度粗

**位置**: `backend/src/modules/admin/shipping-rule/shipping-rule.service.ts:138-143`

**症状**:
```ts
const provinceCode = regionCode.slice(0, 2);
const matches = rule.regionCodes.some((rc: string) => rc.slice(0, 2) === provinceCode);
```
仅按省级 2 位前缀匹配。无法表达"省内 vs 省外""偏远地区（西藏/新疆/海南/青海）加价"等常见快递阶梯。

**修复方案**:
1. 升级到完整 6 位行政区划码匹配（精确到区县）
2. 加预设组：`PRESET_REMOTE_REGIONS = ['54', '65', '63', '46']`
3. 管理后台 UI 支持多级地区树选择
4. 兼容旧数据（2 位前缀仍生效）

---

#### Bug 36 🟡 MEDIUM — SF 推送回调返回值格式可能不对

**位置**: `backend/src/modules/shipment/shipment.controller.ts:55,90`

**症状**: 当前回调成功返回 `{apiResultCode: 'A1000', apiErrorMsg: ''}`。这是**请求方**的成功码格式 — 顺丰回调是**它在请求我们**，期望的应答格式可能不同。

**修复方案**: 沙箱联调时确认顺丰要求的回调应答格式。常见方案：
- 仅返回 200 + 空 body
- 或 `{success: true}` JSON

文档 `https://qiao.sf-express.com/pages/developDoc/index.html` 的"路由订阅 → 应答规范"节查实，更新代码 + 注释。

---

#### Bug 37 🟡 MEDIUM — 收件人 tel 字段：手机号 vs 座机区分

**位置**: `backend/src/modules/shipment/sf-express.service.ts:251,261`

**症状**: 收件人 `tel: params.receiver.tel` 直接传，但顺丰对该字段要求严格区分：
- `mobile`（手机号 11 位）
- `tel`（座机带区号）

混传可能被顺丰拒单。

**修复方案**:
1. `SfCreateOrderParams.receiver` 改为 `{mobile?: string; tel?: string}`
2. 校验 11 位数字 → mobile，否则当作 tel
3. 顺丰要求至少有一个，最好两个都传

---

#### Bug 38 ❌ 已删除（2026-05-05 沙箱实证为误判）

**原描述**: callApi 用 form-urlencoded，新版顺丰要求 JSON。

**实证结果**: 用顺丰开放平台「API测试工具」直调沙箱，顺丰**当前接受 form-urlencoded body**（V1 协议）+ `partnerID/requestID/serviceCode/timestamp/msgDigest/msgData` 字段，**响应是 V2 格式 `{apiResultCode, apiResultData}`**。我们当前 form-urlencoded 提交方式是对的，**不需要切 V3 JSON**。误判删除。

---

#### Bug 39 🟡 LOW — schema 字段冗余 / 命名不一致

**位置**: `backend/prisma/schema.prisma:2179-2185, 1604-1616, 1569`

详见 Bug 14 / 17 / 19。再附几条：
1. `Shipment.carrierCode String // SF/JDL/ZTO/...` 注释 — 已只用 SF，注释删掉
2. `ShippingTemplate` 整个 model 已废弃（line 1604）— 加 migration 删除或加 `@@ignore`
3. `Shipment.rawCarrierPayload Json?` 字段从未被代码写入（搜全仓库无 `rawCarrierPayload:` 赋值）— 配合 Bug 26 让 SF 推送写入

**修复方案**: 一次性 schema 整理 PR，跑 `prisma migrate dev`。

---

### 维度 C — 前端三端用户体验（重要 + 体验）

#### Bug 40 🟢 LOW — 注释残留"快递100"

**位置**: `app/orders/track.tsx:185`

**修复**: 改为"主动调用顺丰丰桥查询"

---

#### Bug 41 🟢 LOW — fallback 文案"青禾农场"

**位置**: `app/orders/track.tsx:24-28`

**修复**: 配合 Bug 16 整体删除 fallbackTimeline。

---

#### Bug 42 🟢 LOW — `CARRIER_PHONES` 残留多家快递映射

**位置**: `app/orders/track.tsx:37-39`

**修复**: 删 6 家无关项，只留 SF 一家：`{ SF: '95338' }`

---

#### Bug 43 🟢 LOW — `OrderRepo.getShipment` mock 模式返回随机假单号

**位置**: `src/repos/OrderRepo.ts:680-690`

**修复**: 仅在 `__DEV__` 且明确开启 mock 时返回，加注释"**仅开发联调用**"

---

#### Bug 44 🟢 LOW — 卖家 detail 页文案没有"仅顺丰"全局说明

**位置**: `seller/src/pages/orders/detail.tsx:300-304`

**修复**: 顶部加 Banner "本平台统一使用顺丰速运发货" 一次性提示。

---

#### Bug 45 🟢 LOW — 单订单打印靠 `window.open` 弹窗

**位置**: `seller/src/pages/orders/detail.tsx:316-321`

**修复**: 优先方案：iframe 内嵌 + 一键打印按钮（参见 Bug 10）

---

#### Bug 46 🟢 LOW — 批量生面单 Modal 文案重复

**位置**: `seller/src/pages/orders/index.tsx:651,663`

**修复**: 文案统一"批量生成顺丰电子面单"

---

#### Bug 47 🟢 MEDIUM — 卖家发货后无重打入口

**位置**: `seller/src/pages/orders/detail.tsx:152-154`

**症状**: `canManageShipment` 仅 `INIT` 状态显示打印按钮。`IN_TRANSIT` 后想补打没入口（贴歪了重新打的常见诉求）。

**修复方案**: 物流信息卡（line 466-498）的「打印」按钮改为永远显示（只要 `waybillNo` 存在）— 实际上代码里 line 472-486 已经无条件显示了，但 `canManageShipment` 控制了"取消面单"按钮。**verify 一下打印是否已发货后还能正常工作**（PDF URL 后端只校验 HMAC，与状态无关，应该 OK）。

---

#### Bug 48 🟡 HIGH — 卖家物流信息卡不显示轨迹

**位置**: `seller/src/pages/orders/detail.tsx:457-517`

**症状**: 卡片只有「快递公司 / 快递单号 / 电子面单 / 发货时间 / 物流状态」，没有时间线轨迹。卖家自己的单跑哪去了完全不知道。

**修复方案**:
1. 卡片底部加 `<Timeline>`（Ant Design），数据来自后端 `getOrder` 返回的 `order.shipment.events`
2. 后端 `seller/orders/getOrder` 已有 events 列吗？需 verify — 如果没，扩展返回结构 `events: ShipmentTrackingEvent[]`
3. 加"主动刷新物流"按钮，调一次 `queryRoutes`

---

#### Bug 49 🟢 MEDIUM — 卖家 dashboard 缺物流运营指标

**位置**: `seller/src/pages/dashboard/index.tsx`

**症状**: 没有"未发货 SLA / 卡单数 / 异常包裹"指标。

**修复方案**:
1. dashboard 加 4 张卡片：今日待发 / 超 24h 未发 / 卡单 3 天+ / 物流异常
2. 关联 `analytics` 模块新增 `shipping-metrics` API

---

#### Bug 50 🟢 MEDIUM — 买家订单详情没有"催发货"按钮

**位置**: `app/orders/[id].tsx`

**修复方案**:
1. 订单状态 `PAID` 且无 shipment 行（Bug 15 修后是 `PENDING_LABEL`）+ paidAt 超 24 小时 → 显示"催卖家发货"按钮
2. 后端新增 `POST /orders/:id/urge-shipping`（每订单每天最多 1 次）
3. 触发 Bug 24 的商家 webhook

---

#### Bug 51 🟢 MEDIUM — 没有"发货前修改地址"功能

**位置**: `app/orders/[id].tsx`

**修复方案**:
1. 状态 `PAID` 且无 shipment（`PENDING_LABEL`）→ 显示"修改地址"
2. 后端 `PATCH /orders/:id/address` — 仅修 `addressSnapshot`，不重算运费（或弹"地址改变可能产生差价"提示）
3. 修改后清空已生成的面单（如果有）— 触发 cancelWaybill

---

#### Bug 52 🟡 MEDIUM — 买家地址簿是否强制结构化输入需核实

**位置**: `app/me/addresses/...`

**修复方案**:
1. 验证地址表单是否有 省/市/区 三级 Picker（地区选择器）
2. 如允许自由输入，加正则校验 + 兜底用 `parseChineseAddress`
3. 已存的非结构化历史地址需迁移补全 — admin 后台批量提示用户更新

---

#### Bug 53 🟢 LOW — 买家退货物流单号无格式校验

**位置**: `app/orders/after-sale-detail/[id].tsx:478-492`

**修复方案**: 配合 Bug 18，改为"仅顺丰单号 SF + 12 位数字"正则。

---

#### Bug 54 🟡 MEDIUM — 买家寄回退货后无法在 App 内追踪

**位置**: 全局缺失

**修复方案**: 配合 Bug 18 把退货建立独立 `ReturnShipment`，App 售后详情加"查看退回物流"。

---

#### Bug 55 🟡 MEDIUM — 卖家售后页是否能看买家退货物流轨迹需核实

**位置**: `seller/src/pages/after-sale/detail.tsx`

**修复**: 同 Bug 54。

---

#### Bug 56 🟡 MEDIUM — 平台运费规则缺批量导入 / 冲突检测

**位置**: `admin/src/pages/shipping-rules/index.tsx`

**修复方案**:
1. 加"导入 Excel"按钮（按地区码批量配置）
2. 保存时跑冲突检测：相同 region+amount+weight 区间是否两条规则
3. 现有 preview API 加"批量地址测算"（用真实地址簿测）

---

#### Bug 57 🟢 LOW — 仲裁队列没有快递异常自动升级

**位置**: `admin/src/pages/after-sale/index.tsx`

**修复方案**: Cron 扫描"卡单 7 天 + 售后申请已 OPEN"自动升级到仲裁队列，admin 收到通知。

---

#### Bug 58 🟢 LOW — `SellerShippingController` 整体 `@Public()` 安全说明缺失

**位置**: `backend/src/modules/seller/shipping/seller-shipping.controller.ts:33`

**症状**: `@Public()` 加在整个 controller 上（绕过买家全局 Guard），各方法手动加 `@UseGuards(SellerAuthGuard)`。打印接口 `printWaybill` 没显式加 SellerAuthGuard，**仅靠 HMAC sig 防御**。设计意图：让卖家把签名 URL 发给打印工人也能用，无需登录。

**修复方案**: 在 controller 顶部加 JSDoc 注释说明这一意图，避免后续维护者误改加上 SellerAuthGuard 反而破坏功能。

---

#### Bug 59 🟢 LOW — 打印 URL HMAC 用 `SELLER_JWT_SECRET`

**位置**: `backend/src/modules/seller/shipping/seller-shipping.service.ts:32`

**修复**: 注释说明 — JWT 轮换会让正在打印的链接失效（已签的 URL 失效）。

---

#### Bug 60 🟢 MEDIUM — 打印接口无 rate limit

**位置**: `backend/src/modules/seller/shipping/seller-shipping.controller.ts:140-146`

**症状**: 同一 staff 反复打 1000 个面单 → 大流量泄露收件人信息

**修复方案**:
1. 用 Redis + sliding window：staff per minute 限 60 次
2. 超限返回 429
3. 安全审计日志已存（recordWaybillPrintAccess），加 admin 后台"打印异常告警"

---

#### Bug 61 🟢 LOW — 废弃 `ShippingTemplate` model 仍在 schema

**位置**: `backend/prisma/schema.prisma:1604-1616`

**修复**: migration 删除（确认无历史数据后）。

---

## 维度 D — 部署 / 运维 / 监控（贯穿全链路）

### Bug 62 ❌ 已删除（2026-05-05 实证后撤销）

**原描述**: 缺端到端沙箱联调脚本。

**撤销理由**: 顺丰开放平台自带「沙箱工具」三件套（API测试工具 / 鉴权测试工具 / 沙箱全流程调测）已经覆盖了等价能力，**不需要我们自己写脚本**。
- API测试工具：手动调任意 API + 看真响应
- 鉴权测试工具：交叉验证签名实现
- 沙箱全流程调测：覆盖 22 项联调用例的引导流程

唯一保留的小工程：可以写一个 `buildVerifyCode` 单测对拍顺丰文档示例（参见 Phase 1 的"加单测"动作）。

---

### Bug 63 🟡 MEDIUM — `docs/operations/阿里云部署.md` 没物流配置章节

**位置**: `docs/operations/阿里云部署.md`

**修复**: 加一节《顺丰物流配置》：
1. Nginx location（Bug 11）
2. .env SF_* 真实值填写
3. 丰桥后台回调 URL 配置（Bug 3）
4. SF_TEMPLATE_CODE 切换（Bug 71）
5. SF_ENV 切换灰度方案

---

### Bug 64 🟡 MEDIUM — `seed.ts` 没有物流测试数据

**位置**: `backend/prisma/seed.ts` + 关联 seed 文件

**修复**:
1. 给 `o-001`-`o-004` 测试订单建好 Shipment 行（Bug 15 改了之后会自动有）
2. 加一些 `ShipmentTrackingEvent` 示例数据
3. 加一条卡单测试 shipment（updatedAt = 5 天前），用于测 Bug 22 cron

---

### Bug 65 🟡 MEDIUM — PM2 ecosystem 不强制 NODE_ENV=production

**位置**: 项目根 / 部署侧（`ecosystem.config.js` 或 systemd unit）

**修复**: 检查 PM2 启动配置，确保 `NODE_ENV: 'production'` 显式设置（关联 Bug 7）。

---

### Bug 66 🟡 LOW — `sf-express.service.spec.ts` 全 mock fetch，无真实契约测试

**位置**: `backend/src/modules/shipment/sf-express.service.spec.ts`

**修复**: 加一个 `sf-express.contract.spec.ts`（标记 `@e2e`，CI 跳过），用真实沙箱凭证跑：
1. createOrder → 拿到真单号
2. queryRoutes → 拿到真轨迹
3. cancelOrder → 取消成功
4. 自动断言 SF 响应字段完整

---

### Bug 67 🟢 LOW — `shipping.md` 文档"已完成"误导

**位置**: `docs/features/shipping.md:38, 589-623`

**修复**: 改写为「代码骨架已完成，沙箱/生产联调进行中，已知问题见 `docs/issues/app-tofix3.md`」。

---

## 维度 F — 三端一致性 / 权限边界 / 安全 / 极端时序（2026-05-05 深度审查新增）

### Bug 72 ⚠️ HIGH — `ShipmentStatus.SHIPPED` 在前端 statusMap 漏掉

**位置**: `seller/src/constants/statusMaps.ts:34-39` × `schema.prisma:234-240` × `sf-express.service.ts:107`

**症状**: Schema 定义 `ShipmentStatus` 枚举有 5 个值（`INIT / SHIPPED / IN_TRANSIT / DELIVERED / EXCEPTION`），但卖家前端 `shipmentStatusMap` 只映射了 4 个（漏 `SHIPPED`）。顺丰 opCode `10` (已揽收) → SF 服务映射为 `SHIPPED` → 写入 DB → 卖家页面渲染状态标签时**找不到 mapping**，显示空白或原始字符串 "SHIPPED"。

**修复**:
```ts
// seller/src/constants/statusMaps.ts:34
export const shipmentStatusMap: Record<string, { text: string; color: string }> = {
  INIT: { text: '待发货', color: 'default' },
  SHIPPED: { text: '已揽收', color: 'blue' },   // ← 补
  IN_TRANSIT: { text: '运输中', color: 'processing' },
  DELIVERED: { text: '已送达', color: 'green' },
  EXCEPTION: { text: '异常', color: 'error' },
};
```
Admin 端不存在专门的 shipmentStatusMap（管理员订单详情页用 raw 字符串），同步加一份。

---

### Bug 73 🟡 MEDIUM — 后端 `getByOrderId` 同时返回明文 trackingNo 和脱敏值给买家

> **2026-05-05 复审降级**：原标 HIGH，实际是潜在隐私问题不是即时漏洞（已有几个月，无报告事件）；且必须保留某种"明文获取"路径让买家去顺丰官网查询。改为 MEDIUM，**Phase 1 不做**，Phase 4 做"reveal 接口 + 前端复制按钮"重构时一起改。

**位置**: `backend/src/modules/shipment/shipment.service.ts:111-112, 144`

**症状**:
```ts
const mappedShipments = shipments.map((shipment) => ({
  // ...
  trackingNo: shipment.trackingNo,                              // ❌ 明文
  trackingNoMasked: maskTrackingNo(shipment.trackingNo) ?? null, // ✅ 脱敏
  // ...
}));
```
返回**两个版本** — 任何能截 API 响应的人（开发者工具 / MITM / 抓包）都能拿到完整运单号。

**风险**: 顺丰单号 `SF7444703608745` 是查询路由的唯一索引，**任何陌生人拿到 SF 单号 + 收件人手机号后 4 位**就能在顺丰官网查全部物流信息（含目的地址）。

**矛盾**: 但买家**确实需要明文**才能去顺丰官网查询/给客服报。

**修复方案**:
1. `getByOrderId` 默认只返回 `trackingNoMasked`，删掉 `trackingNo` 字段
2. 新增接口 `GET /shipments/:orderId/tracking-no/reveal`（**单独鉴权**）：
   - 返回明文 trackingNo
   - rate limit: 同一买家同一订单每 60 秒最多 1 次
   - 写买家审计日志（`UserActivityLog` 类型 = `REVEAL_TRACKING`）
3. App `track.tsx:235-244` 改为：
   - 默认显示脱敏 + "查看完整运单号" 按钮
   - 点击调 `/reveal` 接口拿明文
   - 弹 toast "请勿在公开场合分享" + 5 秒后自动隐藏（对话同步：剪贴板维持）
4. 统一前端类型：`Shipment.trackingNo` 删掉，仅留 `trackingNoMasked`

---

### Bug 74 🟡 HIGH — App OrderStatus 用 lowerCamel 自创一套，与 schema 大写下划线不通

**位置**: `src/constants/statuses.ts:3-11` × `schema.prisma:191-198`

**症状**:
- Schema: `PENDING_PAYMENT / PAID / SHIPPED / DELIVERED / RECEIVED / CANCELED / REFUNDED`
- App: `pendingPay / pendingShip / shipping / delivered / afterSale / completed / canceled`

App 自创了 7 个 lowerCamel 状态码，**与 schema 完全不重叠**。意味着 OrderRepo 层有 mapper（schema → App）。这是隐性的双语：
- schema 加新状态 → App 不更新 mapper 会**默默丢失**该状态显示
- App 状态合并：`afterSale` 实际对应 schema 的什么？看不出来
- `completed` 是 schema 的 `RECEIVED` 还是 `DELIVERED`？需要 verify mapper

**问题更深**: 卖家 + 管理后台都用 schema 大写下划线，**唯独 App 是 lowerCamel** —— 三端不一致中最严重的。三端运营协作时，卖家说"已发货"客服说"shipping"开发说"SHIPPED"，沟通成本高。

**修复方案**:
1. App 类型重构：`src/types/domain/Order.ts` 改用 schema 大写枚举（`PENDING_PAYMENT/PAID/...`）
2. App `statuses.ts` 改 mapper：`PENDING_PAYMENT: '待付款'` 等
3. App 各页面用到 status 的地方批量替换（搜 `pendingShip` `shipping` 等关键字）
4. OrderRepo mapper 删除（不再需要翻译）
5. 类型扩展：兼容 `RECEIVED`（之前可能漏了，因为 App 用 `completed` 模糊覆盖）

**工作量**: 1.5-2 天（涉及多文件 grep + 替换 + 测试）

---

### Bug 75 ⚠️ HIGH — OPERATOR 角色能生面单/取消面单，但不能确认发货（流程卡死）

**位置**:
- `backend/src/modules/seller/shipping/seller-shipping.controller.ts:48-58, 180-188`
- `backend/src/modules/seller/orders/seller-orders.controller.ts:55-67`

**症状**:
- `generateWaybill` / `cancelWaybill` 单条接口 **没加** `@SellerRoles('OWNER','MANAGER')` → OPERATOR 可调
- `ship / batchShip` 加了 `@SellerRoles('OWNER','MANAGER')` → OPERATOR 不可调

**业务后果**: OPERATOR 角色员工生成了面单 → 想点"确认发货"被拒 → **必须找 OWNER/MANAGER 来点** → 实际操作中流程卡死，或者干脆用 OWNER 账号操作（违反职责分离）。

**修复方案**:
- **方案 A（推荐）**: 全部统一为 `@SellerRoles('OWNER','MANAGER','OPERATOR')` — 操作员承担全发货链路
- **方案 B**: 全部限 `OWNER/MANAGER` — 严格分级，但 OPERATOR 角色基本无用
- 这是产品决策，需要老板拍板

**关联**: 卖家"批量打印"接口 `printWaybill` 是 `@Public()` + HMAC sig 防御，无角色校验（参见 Bug 58 设计意图）— 这部分保持。

---

### Bug 76 🟡 HIGH — 打印 URL HMAC 签名后任何拿到 URL 的人都能下载面单（无 IP 限制）

**位置**: `backend/src/modules/seller/shipping/seller-shipping.controller.ts:68-149` × `seller-shipping.service.ts:317-326`

**症状**: 打印 URL 形如：
```
/api/v1/seller/orders/<orderId>/waybill/print?companyId=xxx&staffId=yyy&expires=zzz&sig=ssss
```
HMAC 签名验证只看 `companyId+orderId+staffId+expires+sig` 是否对，**不验请求来源**。

**风险场景**:
- 卖家把 URL 发到员工微信群 → 群里其他人（含外人）都能点开下载完整 PDF
- URL 被记录到浏览器历史 / Referer Header / Nginx access log（含查询字符串）→ 这些日志的访问者都能拿到面单
- 收件人**姓名 / 手机号 / 详细地址 / 商品概要**全暴露

**矛盾**: 设计意图是让卖家把 URL 发给打印工人 — 但"打印工人"和"未授权第三方"边界模糊。

**修复方案（按强度阶梯）**:
1. **基础**: URL 失效时间从 15 分钟降到 5 分钟（足够打印一次）
2. **进阶**: HMAC 增加单次使用限制 — 在 Redis 标记 `printed:{sig}=1` TTL=10min，第二次访问拒绝
3. **强化**: HMAC 增加 IP 白名单约束 — 卖家「企业信息」配置允许打印的 IP 段（公司公网 IP），URL 校验时同时验 IP
4. **最严**: 改用一次性 token 流程 — 打印按钮先调 API 生成 token（写 DB + TTL）→ URL 带 token → 服务端验 token 后立即作废
5. **审计**: 已记录 `recordWaybillPrintAccess` ✅，但加 rate limit（同 IP 同公司每分钟最多 10 次打印调用，超限告警）

> **推荐组合（性价比最高）**: 1 + 2 + 5（5 分钟过期 + 一次性 + rate limit）。  
> 3/4 是过度设计，等真出现泄露事件再加。 Phase 1 不做，Phase 4 实施。

---

### Bug 77 🟡 MEDIUM — 顺丰推送轨迹去重精度只到秒，同秒多次推送会 false-dedupe

**位置**: `backend/src/modules/shipment/shipment.service.ts:201-211`

**症状**:
```ts
const existingKeys = new Set(
  existingEvents.map((e) => `${e.occurredAt.toISOString()}|${e.message}`),
);
```
顺丰 `acceptTime` 精度到秒（"yyyy-MM-dd HH:mm:ss"）。同秒内：
- 顺丰对同一事件重发（网络抖动）→ 正确去重 ✅
- 但**同秒发生不同 opCode 但 message 相同**（如顺丰文案模板复用）→ 第二条被错误去重，丢失轨迹节点

**修复**: 加 opCode 因子防 false-dedupe：
```ts
const existingKeys = new Set(
  existingEvents.map((e) => `${e.occurredAt.toISOString()}|${e.message}|${e.statusCode || ''}`),
);
```
新事件 key 同样补 opCode。

---

### Bug 78 🟡 HIGH — 顺丰下单成功但本地 DB 写失败时，rollback 失败会留孤儿 SF 单号

**位置**: `backend/src/modules/seller/shipping/seller-shipping.service.ts:259-262, 561-566`

**症状**:
```ts
async generateWaybill(...) {
  let createdWaybill = null;
  try {
    return await this.prisma.$transaction(async (tx) => {
      // ... createOrder → createdWaybill 赋值 → 本地 DB 写 ...
    }, { isolationLevel: Serializable });
  } catch (error) {
    await this.rollbackCreatedWaybill(createdWaybill);  // ← 这里也可能失败
    throw error;
  }
}
```
链路故障：
1. SF createOrder 成功 → 拿到真单号
2. 本地 Serializable 事务因 P2034 序列化冲突重试 3 次都失败 → 抛错
3. catch → `rollbackCreatedWaybill` → 调 `cancelCarrierWaybill` → 顺丰**也可能失败**（SF 内部 5xx / 网络断）
4. 结果：**顺丰侧分配了单号但本地无记录**，用户无法查询，单号占用月结额度

**修复方案**:
1. 新建 schema `OrphanSfWaybill`：
   ```prisma
   model OrphanSfWaybill {
     id          String   @id @default(cuid())
     waybillNo   String   @unique
     sfOrderId   String?
     companyId   String
     orderId     String
     reason      String   // 'rollback_failed' / 'tx_serialization' / ...
     attemptedAt DateTime @default(now())
     resolvedAt  DateTime?
     resolution  String?  // 'manual_canceled' / 'manual_kept' / ...
   }
   ```
2. `rollbackCreatedWaybill` 失败时写孤儿表 + 告警 admin（站内信 + Sentry）
3. 管理后台「物流监控」加孤儿单列表（参见 Bug 26）+ 一键"再次取消"操作
4. 加 cron 每小时扫孤儿 → 自动重试 cancelOrder（指数退避，最多 24h）

---

### Bug 79 🟡 MEDIUM — Order 软删后 `getByOrderId` 仍可查物流

**位置**: `backend/src/modules/shipment/shipment.service.ts:93`

**症状**:
```ts
const order = await this.prisma.order.findUnique({ where: { id: orderId } });
if (!order || order.userId !== userId) throw new NotFoundException('订单未找到');
```
没 filter `deletedAt` — 软删过的 Order 仍能查物流。

**业务影响小**：用户主动删除订单后理论上不再关心物流，但能继续查也不算严重 bug。

**修复**: 加 `deletedAt: null` filter 或对已删除单显示"该订单已被您删除"提示。

---

### Bug 80 🟡 HIGH — 卖家拒收退货后回寄物流没接 SF

**位置**: `backend/prisma/schema.prisma:2167-2169` × `seller-after-sale.service.ts`

**症状**: schema 有字段：
```prisma
sellerRejectReason    String?
sellerRejectPhotos    String[]
sellerReturnWaybillNo String?           // 卖家退回快递单号（拒收退货时回寄）
```
但**没看到 service 调 SF createOrder 生成回寄面单**。卖家拒收退货时，需要把买家寄来的包裹原路寄回 — 这条链路要：
1. 卖家上传拒收照片 + 理由
2. 调 SF createOrder（发件人=卖家，收件人=买家原地址）→ 拿到 sellerReturnWaybillNo
3. 卖家打印 + 发货
4. 买家在 App 看到"卖家已拒收，包裹回寄中"+ 物流追踪

当前缺步骤 2-4 的 SF 集成，仅有 `sellerReturnWaybillNo` 字段供手填。

**修复**: 新增 `seller-after-sale.service.ts.generateSellerReturnWaybill()`，复用 `SellerShippingService.createCarrierWaybill`。

---

### Bug 81 🟡 MEDIUM — App 物流页复制运单号到剪贴板 — 需配合 Bug 73 整体改造

**位置**: `app/orders/track.tsx:236-241`

**症状**: 当前 `Clipboard.setStringAsync(shipment.trackingNo!)` 复制明文 — 但配合 Bug 73 修复后，前端拿不到明文。

**修复方案**: 复制按钮改为：
1. 调 `/shipments/:orderId/tracking-no/reveal` 拿明文（受 rate limit）
2. 写剪贴板 + toast "运单号已复制，请勿公开分享"
3. 5 秒后**主动清空剪贴板**（部分平台支持），降低意外泄露风险

---

### Bug 82 🟢 LOW — App 多包裹 UI 是死代码（一 Order 永远一 Shipment）

**位置**: `app/orders/track.tsx:138, 273-334`

**症状**:
```tsx
const isMultiPackage = packages.length > 1;
```
多包裹折叠 UI 在代码里实现完整。但 checkout 已按 company 拆 Order（每 Order 1 个 company → 1 个 Shipment），**永远走单包裹分支**。

**修复方案（二选一）**:
- 删除多包裹相关 UI 组件 + 简化 `getByOrderId` 返回结构
- 保留以备未来跨 company 合单场景（需文档说明"未来扩展占位"）

推荐删除（YAGNI），跨 company 合单短期没规划。

---

### Bug 83 🟢 LOW — App 客服电话直接 `tel:` 跳转无降级

**位置**: `app/orders/track.tsx:247`

**症状**: `Linking.openURL('tel:95338')` — iOS 平板 / Android tablet / 部分 ROM 不支持 tel: 协议会报错。

**修复**: 加 `Linking.canOpenURL('tel:...')` 检查，false 时降级"复制号码 + toast"。

---

### Bug 84 🟡 MEDIUM — 时区一致性：`autoReceiveAt` / `returnWindowExpiresAt` 跨服务器时区可能漂移

**位置**: 全局 cron + new Date()

**症状**:
- `OrderAutoConfirmService.handleAutoConfirm` 用 `where: { autoReceiveAt: { lte: now } }`
- `now = new Date()` 返回 UTC ms timestamp
- 写入 PostgreSQL `timestamp without timezone` 列时如果服务器 TZ 不是 UTC，**写入和读取对不齐**
- 服务器在阿里云华南 (Asia/Shanghai)，PostgreSQL `timezone` 默认可能是 'Asia/Shanghai' 也可能是 'UTC'

**验证步骤**:
```bash
# 测试服务器跑
psql -d aimaimai -c "SHOW timezone; SELECT now(), localtimestamp;"
date  # 服务器时区
node -e "console.log(new Date(), new Date().getTimezoneOffset())"
```

**修复**:
1. 全局 PostgreSQL 列改为 `@db.Timestamptz` (timestamptz with TZ)
2. 应用启动 TZ 设为 `Asia/Shanghai`（PM2 `env.TZ=Asia/Shanghai`）
3. cron job 启动前先 SET timezone

**风险**: cron 7 天自动确认收货可能差 8 小时（提前/延后），影响分润触发时机。

---

### Bug 85 🟡 MEDIUM — 取消面单 + 顺丰推送在途竞态丢失推送

**位置**: `backend/src/modules/seller/shipping/seller-shipping.service.ts:496-543` × `shipment.service.ts:174`

**症状**:
- 卖家点取消面单 → SF cancelOrder 成功 → 本地 CAS update `waybillNo: null`
- 此时如果顺丰**之前已推送过一条事件**（在 cancelOrder 之前发出，但还没到达我们）→ 现在 callback 到达 → handleCallback 按 `trackingNo` 查 shipment → trackingNo 已 null → NotFound → **推送丢失**

**实际影响**: 取消面单的同一时刻顺丰推送基本不会有（卖家还没用面单贴货物），实际很少触发。但严格意义存在。

**修复**: 推送找不到 shipment 时**记录到死信表 `OrphanSfPush`** 而不是 throw。运营后台可看孤儿推送，手动判断处理。

---

## 维度 E — 2026-05-05 沙箱实证新增的 Bug

### Bug 68 ⚠️ CRITICAL（新增确证 P0）— 沙箱必须用统一月结号 7551234567

> ✅ **2026-05-05 已修**：构造函数读 `SF_MONTHLY_ACCOUNT_UAT` / `SF_MONTHLY_ACCOUNT_PROD`，按 `SF_ENV === 'PROD'` 三元分流；保留旧 `SF_MONTHLY_ACCOUNT` 作 fallback 兼容。`.env.example` 拆出双变量并附说明。测试服务器 .env 已同步（UAT=7551234567 / PROD=7551253482）。

**位置**: `backend/src/modules/shipment/sf-express.service.ts:122-125` × `.env / .env.example`

**沙箱实证**: 顺丰应用详情页底部明文：
> 账号管理绑定的是生产环境的月结卡号，沙箱环境**统一使用 7551234567 月结卡号**进行测试

我们 `.env` 当前 `SF_MONTHLY_ACCOUNT=7551253482` 是**生产真月结号**。沙箱里用这个会被顺丰拒（沙箱不认识真客户的月结卡）。

**修复方案**:
```env
# .env / .env.example
SF_ENV="UAT"
SF_MONTHLY_ACCOUNT_UAT="7551234567"   # 顺丰统一沙箱测试卡
SF_MONTHLY_ACCOUNT_PROD="7551253482"  # 我们真月结号（22/22 联调通过后再切 SF_ENV=PROD）
# 可选：保留向后兼容 fallback
SF_MONTHLY_ACCOUNT=""                  # 留空，由代码按 SF_ENV 自动切
```
```ts
// sf-express.service.ts constructor
this.monthlyAccount = this.sfEnv === 'PROD'
  ? this.configService.get('SF_MONTHLY_ACCOUNT_PROD', this.configService.get('SF_MONTHLY_ACCOUNT', ''))
  : this.configService.get('SF_MONTHLY_ACCOUNT_UAT', '7551234567');
```
启动日志打印当前生效月结号（脱敏前 4 后 2），方便部署排查：
```
[SfExpressService] env=UAT, monthlyAccount=7551****67
```

---

### Bug 70 ⚠️ CRITICAL（新增确证 P0）— `callApi` 响应字段名错 + 缺业务级双层判断

> ✅ **2026-05-05 已修**：响应改读 `result.apiResultData ?? result.msgData`（兼容旧字段）→ JSON.parse → 校验 `success === false` 抛业务错误（`errorCode` / `errorMsg` 进日志）→ 返回完整 V2 解析对象（含 `msgData` / `obj`）。下游 `createOrder` / `queryRoutes` / `printWaybill` 同步适配 `data.msgData.xxx` 路径。

**位置**: `backend/src/modules/shipment/sf-express.service.ts:165-211`

**沙箱实证响应** (2026-05-05 用 API 测试工具调 `EXP_RECE_CREATE_ORDER` 抓到):
```json
{
  "apiErrorMsg": "",
  "apiResponseID": "00019DF65324853FD6FDB3F1502CE23F",
  "apiResultCode": "A1000",
  "apiResultData": "{\"success\":true,\"errorCode\":\"S0000\",\"errorMsg\":null,\"msgData\":{\"orderId\":\"...\",\"waybillNoInfoList\":[{\"waybillNo\":\"SF7444703608745\"}],\"routeLabelInfo\":[...]}}"
}
```

**真实响应结构**:
- 第 1 层：`{apiResultCode, apiErrorMsg, apiResultData(JSON 字符串)}`
- 第 2 层（解析 apiResultData 后）：`{success: true/false, errorCode, errorMsg, msgData / obj}`
- 第 3 层（msgData/obj 内）：真业务数据

**根因**:
```ts
const result = await response.json();
if (result.apiResultCode !== 'A1000') {
  throw new BadRequestException(`顺丰API错误: ${result.apiErrorMsg || result.apiResultCode}`);
}
try {
  return JSON.parse(result.msgData);   // ❌ 字段名错，顺丰返回字段是 apiResultData
} catch {
  return result.msgData;
}
```

**问题双重叠加**:
1. **字段名错** — `result.msgData` 永远 undefined（顺丰返回 `apiResultData`）
2. **缺业务级判断** — 即使 `apiResultCode == A1000`（协议层成功），`apiResultData.success` 可能是 false（业务层失败，例如 Bug 71 的 templateCode 不匹配错误）。当前代码完全不看业务级 success，把业务错误吞掉。

**修复方案**:
```ts
private async callApi(serviceCode: string, msgData: any): Promise<any> {
  // ... 签名 + 发请求保持不变 ...
  const response = await fetch(this.getEndpoint(), { /* ... */ });
  if (!response.ok) {
    throw new BadRequestException(`顺丰API请求失败: HTTP ${response.status}`);
  }
  const result = await response.json();

  // 第 1 层：协议级判断
  if (result.apiResultCode !== 'A1000') {
    this.logger.error(`顺丰协议错误: code=${result.apiResultCode}, msg=${result.apiErrorMsg}, serviceCode=${serviceCode}`);
    throw new BadRequestException(`顺丰协议错误: ${result.apiErrorMsg || result.apiResultCode}`);
  }

  // 第 2 层：业务级判断（apiResultData 是 JSON 字符串，必须解析）
  let parsed: any;
  try { parsed = JSON.parse(result.apiResultData); }
  catch {
    this.logger.error(`顺丰响应 apiResultData 解析失败: serviceCode=${serviceCode}`);
    throw new BadRequestException('顺丰响应格式异常');
  }
  if (parsed?.success === false || (parsed?.errorCode && parsed.errorCode !== 'S0000')) {
    this.logger.error(`顺丰业务错误: code=${parsed.errorCode}, msg=${parsed.errorMsg || parsed.errorMessage}, serviceCode=${serviceCode}`);
    throw new BadRequestException(`顺丰业务错误: ${parsed.errorMsg || parsed.errorMessage || parsed.errorCode}`);
  }

  // 返回最里层业务数据（msgData 或 obj，由调用方决定取哪个）
  // 注意：不同 API 返回数据放在 msgData (createOrder/queryRoutes) 还是 obj (printWaybill) 里
  return parsed;
}
```

**调用方相应调整**:
- `createOrder`: `data.msgData.waybillNoInfoList[0].waybillNo`
- `printWaybill`: `data.obj.files[0].url`
- `queryRoutes`: `data.msgData.routeResps`
- `parsePushPayload`: 推送 body 结构与请求响应**不一样**，单独处理（见 Bug 70-补丁）

---

### Bug 70-补丁 ⚠️ CRITICAL（2026-05-05 沙箱实推已确认，升级阻塞级）— `parsePushPayload` 真实结构与代码假设不符

**位置**: `backend/src/modules/shipment/sf-express.service.ts:410-453`

**沙箱实证 body 结构**（2026-05-05 21:00 用户从顺丰沙箱「测试」按钮抓取）:
```json
{
  "Body": {
    "WaybillRoute": [
      {
        "mailno": "SF7444703608745",
        "acceptAddress": "test",
        "reasonName": "",
        "orderid": "OrderNum20200612223",
        "acceptTime": "2026-05-05 12:08:57",
        "remark": "test",
        "opCode": "50",
        "id": "177795413787871",
        "reasonCode": ""
      },
      { "...第二条路由...", "opCode": "80" }
    ]
  }
}
```

**关键差异**（当前代码全部不兼容）:

| 项 | 代码假设 | 真实推送 | 影响 |
|---|---|---|---|
| 顶层包裹 | `body.msgData` | `body.Body` | 解析空 |
| 路由数组 | `msgData.routeList` / `routes` | `Body.WaybillRoute` | 找不到 |
| 单号字段 | `waybillNo` / `mailNo` | `mailno`（小写）| 取不到 |
| 时间字段 | `time` | `acceptTime` | 取不到 |
| 批量上限 | 单条 | 数组最多 10 条不同 mailno | 漏处理 |
| 签名包裹 | `msgData` + `timestamp` + `msgDigest` | **完全没有** | 强制 401 |

**修复方案**:
1. `parsePushPayload` 重写：返回 `SfPushPayload[]`（按 mailno 分组的多个 payload）
2. 路径改为 `body.Body.WaybillRoute` → 字段名 `mailno` / `acceptTime` / `acceptAddress` / `remark` / `opCode`
3. 控制器迭代每个 mailno 调 `handleSfCallback`
4. **配合 Bug 87 弱化签名校验**（SF 推送本身没签名）
5. 沙箱沙箱推送返回值确认 — 见 Bug 36

---

### Bug 86 ⚠️ HIGH（2026-05-05 真机测试盘点新增）— 管理后台 VIP_PACKAGE 订单不能调 SF 自动取号发货

**位置**:
- `admin/src/pages/orders/index.tsx:270` — 前端过滤 VIP_PACKAGE 不显示发货按钮
- `backend/src/modules/admin/orders/admin-orders.service.ts:245-303` — `ship()` 走"手填运单号"链路，不调顺丰 API

**症状**:
- VIP 礼包订单（含真实物理商品如鱼/茶/虾）只能由商家中心发货
- 管理员代理平台公司「爱买买app」给 VIP 礼包发货时只能手填运单号，无法自动生成顺丰电子面单 + OSS PDF

**用户决策（2026-05-05）**: 选项 B — 让管理后台也能调顺丰自动取号，跟商家中心同链路

**修复方案**:
1. `admin/src/pages/orders/index.tsx:270` 删除 `record.bizType !== 'VIP_PACKAGE'` 条件
2. `admin-orders.service.ts:ship` 重构：当 `dto.useCarrierAuto === true` 时调 `SfExpressService.createOrder` + `UploadService.uploadBuffer`，跟 `seller-shipping.service.ts:generateWaybill` 同链路
3. 管理后台发货弹窗加 toggle：「自动取号（顺丰电子面单）」/「手填运单号」
4. 自动取号路径下：与 seller-shipping 共享 `generateWaybill` 方法（提取到 shipping 公共服务），避免重复逻辑

**预计工作量**: 中（2-4 小时，含单测）

**Phase 2 阻塞**: 是 — 不修则 VIP 礼包发货链路不能在管理后台真机测试

---

### Bug 87 ⚠️ CRITICAL（2026-05-05 沙箱实证后新增；2026-05-06 外审后修订方案）— SF 路由推送无签名机制，需用 URL secret token 替代

**位置**: `backend/src/modules/shipment/shipment.controller.ts` + `shipment.service.ts:336-345` + `sf-express.service.ts:579-595` + 顺丰后台推送 URL 配置

**症状**:
Phase 1 第二轮加固后 `handleSfCallback` 改成「缺任一签名要素一律 401」。但沙箱实证 SF 推送 body 形如 `{"Body":{"WaybillRoute":[...]}}`，**没有 `msgData` / `timestamp` / `msgDigest` 字段**（HTTP header 也没看到 `Service-Timestamp` / `X-Sf-Digest`），所以**所有真实 SF 推送都会被我们 401 拒绝**。

**根本原因**:
- SF V1 文档说明请求签名（我们调 SF 时用）走 MD5 + Base64
- SF V2 路由推送（SF 推我们时）**完全没有签名机制**

**❌ 弃用方案**: "传 digest 才校验，不传一律放行" — 等于公开 webhook，任何知道 URL 的人都能伪造路由更新（外审 2026-05-06 否决）

**✅ 采纳方案**: URL Secret Token（webhook 标准实践）

1. 生成 32 位随机 secret 写入 `.env`：
   ```
   SF_PUSH_SECRET=<32位随机十六进制>
   ```

2. 顺丰后台推送 URL 改为带 token 路径：
   ```
   https://test-api.ai-maimai.com/api/v1/shipments/sf/callback/<SF_PUSH_SECRET>
   ```

3. 后端路由改为 `/sf/callback/:token`，用 `crypto.timingSafeEqual` 校验：
   ```ts
   @Post('sf/callback/:token')
   async handleSfCallback(@Param('token') token: string, ...) {
     const expected = Buffer.from(this.pushSecret, 'utf8');
     const actual = Buffer.from(token, 'utf8');
     if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
       throw new UnauthorizedException();
     }
     // ... 处理推送
   }
   ```

4. 推送处理弱化：不再要求 msgData/timestamp/msgDigest（SF 不发），但 trackingNo 不存在 DB 时返 200 OK + warn log（防 SF 重推风暴）

**安全模型**:
- Secret 同时存在于 SF 后台 + 测试服 .env，**双源独立泄露**才能被伪造
- HTTPS 防中间人
- timingSafeEqual 防时序攻击
- DB 验证 trackingNo 存在（次级防御）
- IP rate limit 防 DoS（Phase 3+）

**Phase 2 阻塞**: 是 — 不修则 SF 推送一律失败，物流状态永远不更新

**密码本同步**: 改完后 `SF_PUSH_SECRET` 写入 `docs/operations/密码本.md` §七

---

---

### Bug 71 ⚠️ CRITICAL（新增确证 P0）— `SF_TEMPLATE_CODE` 默认值是别家应用的占位

> ✅ **2026-05-05 已修**：构造函数加启动期校验 `templateCode.endsWith('_' + clientCode)`，拼错直接 throw 阻止启动；默认值改空串；`printWaybill` 运行时再做一次空值守卫。`.env.example` 留空带说明。测试服务器 .env 已同步 `fm_150_standard_HHNYKCL5OWXM`。

**位置**: `backend/.env.example:68` × `backend/src/modules/shipment/sf-express.service.ts:127-130`

**沙箱实证（2026-05-05）**: 用 `.env.example` 默认的 `fm_150_standard_HNGHAfep` 调云打印接口直接被拒：
```
"errorMessage": "templateCode:fm_150_standard_HNGHAfep is not matched the clientCode:HHNYKCL5OWXM"
```

**真因**: `HNGHAfep` 是顺丰文档示例中**别家应用的 clientCode 后缀**，跟我们应用 `HHNYKCL5OWXM` 完全无关。模板代码是顺丰按 `<格式>_<clientCode>` 自动生成的。

**实证我们应用真模板**（在丰桥后台「云打印面单转PDF接口详情」页确认）:
- 100×150 标准: `fm_150_standard_HHNYKCL5OWXM`
- 76×130 标准: `fm_76130_standard_HHNYKCL5OWXM`

**修复方案**:
```env
# backend/.env.example 第 68 行
SF_TEMPLATE_CODE="fm_150_standard_HHNYKCL5OWXM"

# 测试服务器 backend/.env 同步改
```

**额外加固**: `SfExpressService` 启动时校验 `SF_TEMPLATE_CODE` 必须以 `_${clientCode}` 结尾（防止误配别家模板）：
```ts
if (this.templateCode && this.clientCode && !this.templateCode.endsWith(`_${this.clientCode}`)) {
  this.logger.warn(`⚠️ SF_TEMPLATE_CODE (${this.templateCode}) 末尾未匹配 clientCode (${this.clientCode})，可能配错`);
}
```

---

## 修复执行顺序（推荐 Phase 计划）

### Phase 1: P0 阻断级（沙箱实证后已收敛）— 估时 1.5-2 天

> 目标：让我们的代码用真凭证跑通顺丰沙箱（createOrder + printWaybill + 推送回调）。沙箱已用顺丰自带工具实证可达，剩下的是把代码改对。

**实施顺序很重要**（互相依赖）：

```
Bug 70（callApi 解析）─┬─→ Bug 1（printWaybill 路径，依赖 70 吐回正确的 data）
                       └─→ Bug 71（templateCode 启动校验，依赖 70 业务级 success 判断生效）
Bug 2A（请求签名 URL 编码）─→ Bug 2B（推送验签复用同函数）
Bug 68（月结号分流）─ 独立
Bug 7（test mock 双保险）─ 独立
Bug 3（删 routeLabelForUpdate + 丰桥后台配置）─ 独立
Bug 4（删 WebhookIpGuard）─ 独立
Bug 5（PDF URL → OSS）─→ 依赖 Bug 1（要 pdfUrl 字段）+ Bug 10（前端打印逻辑改）
Bug 10（前端 iframe 替 img）─ 独立 OTA
```

**改动列表**:
- [ ] Bug 70 — `callApi` 改读 `result.apiResultData`，加业务级 `success/errorCode` 判断 ⭐ **先改**
- [ ] Bug 2A — `buildVerifyCode` 加 Java 风格 URL 编码（含 6 字符兼容补丁）
- [ ] Bug 2B — `verifyPushSignature` 复用同算法 + 从 Header 取 `Service-Timestamp` ❓沙箱实推验
- [ ] Bug 1 — `printWaybill` 解析改读 `apiResultData.obj.files[0].url`，返回 `{pdfUrl}` 取代 `{pdfBase64}`
- [ ] Bug 71 — `.env.example` `SF_TEMPLATE_CODE="fm_150_standard_HHNYKCL5OWXM"` + 启动 endsWith 校验
- [ ] Bug 68 — 沙箱/生产月结号按 `SF_ENV` 分流：UAT `7551234567` / PROD `7551253482`
- [ ] Bug 3 — 删除 `routeLabelForUpdate` 字段（用户在丰桥后台「云打印面单沙箱推送地址」配置回调 URL — 这是部署侧动作）
- [ ] Bug 4 — `shipment.controller.ts:53` 删除 `@UseGuards(WebhookIpGuard)`
- [ ] Bug 7 — `NODE_ENV=test` mock 加 `SF_ALLOW_E2E_MOCK==='1'` 双重保险
- [ ] Bug 5 — `printWaybill` 拿到 PDF URL 后立即下载存 OSS（不再 base64 入库）+ `seller-shipping.controller.ts:99-112` 打印代理重写为 OSS fetch + pipe
- [ ] Bug 10 — 卖家批量打印 `<img>` 改 `<iframe>` 内嵌
- [ ] **新动作**: 跑 `tsc -b` 确认无类型错误
- [ ] **新动作**: 单测覆盖 `buildVerifyCode` 与顺丰文档示例对比
- [ ] **删除**: ~~Bug 38（V1 vs V3 协议误判）~~ + ~~Bug 62（沙箱脚本，顺丰自带工具够）~~

### Phase 2: ✅ 已完成 — 凭证 + 部署侧准备
> 2026-05-04 发现：凭证已于 2026-04-17 备齐，本 Phase 大幅缩短

- [x] Bug 6 — 月结账号 + 丰桥应用申请（已完成 2026-04-17，凭证见密码本.md:176-191）
- [x] **新动作（已完成）**：verify `SF_TEMPLATE_CODE` 真值 = `fm_150_standard_HHNYKCL5OWXM`（2026-05-05 在丰桥「云打印面单转PDF接口详情」页确认）
- [ ] Bug 11 — Nginx 配置 `/api/v1/shipments/sf/callback` location（生产 + 测试两个站点都要 ssh 实测）
- [ ] **新动作**：丰桥后台配 UAT 推送回调 URL → `https://test-api.ai-maimai.com/api/v1/shipments/sf/callback`
- [ ] **新动作**：联调进度 22 项（详见下方章节）

---

## 顺丰联调进度 22/22 说明

**当前状态**: `0/22`，应用状态「API测试中」

**含义**: 顺丰要求每个新应用在切到生产环境前，必须用沙箱环境**完成 22 个标准联调测试用例**，并由顺丰运营审核测试记录通过，才会把应用从「API测试中」切到「已上线」状态、开放生产环境调用权限。

**22 项的范围**: 顺丰为兼容所有客户场景设计的全集，涵盖国内/港澳台/国际、冷链/常温、子母单、增值服务（保价/签收返单）、报价、时效、路由订阅推送、面单打印/取消等场景。

**我们实际只用其中约 5-7 项**：
- ✅ 标准件下单（`EXP_RECE_CREATE_ORDER`）
- ✅ 取消订单（`EXP_RECE_UPDATE_ORDER` dealType=2）
- ✅ 路由查询（`EXP_RECE_SEARCH_ROUTES`）
- ✅ 路由订阅推送（顺丰主动推到我方 callback）
- ✅ 云打印面单 PDF（`COM_RECE_CLOUD_PRINT_WAYBILLS`）
- ⏸️ 子母单 / 港澳台 / 冷链 / 国际件 / 报价等：**我们业务不用，可与顺丰运营协商豁免**

**怎么测**: 顺丰提供两条等价路径：
- **路径 A — 沙箱工具 → API测试工具**（手工逐个调）：每次成功调用都会被「测试记录查询」记下来，顺丰运营按测试记录核对
- **路径 B — 沙箱工具 → 沙箱全流程调测(速运)**（引导式）：顺丰预设的 step-by-step 流程，覆盖大部分用例，按提示填参数点下一步

**推荐操作顺序**:
1. **先用代码改完后的真后端调一次完整下单 → 打印 → 取消 → 查询 → 推送回调**（5 项）— 我方代码自测通过
2. **登录丰桥后台 → 沙箱全流程调测(速运) → 跟随引导**填表跑一遍 — 让顺丰记录测试痕迹，把 0/22 涨上去
3. **22 项里我们不用的部分**（冷链/国际/子母单/报价）联系顺丰技术对接人或客服**申请豁免**：
   > "我们是国内常温农产品电商，业务上只用顺丰标快国内单 + 云打印面单 + 路由订阅。请豁免冷链/国际/子母单/报价等场景的联调要求，仅核我方实际使用的 5 项即可。"
4. 顺丰审核通过 → 应用状态切「已上线」 → 切 `SF_ENV=PROD` + PROD checkWord + 真月结号 → 灰度 10 单 → 全量

**时间预估**: 沙箱全流程调测自调 1-2 天 + 顺丰审核 1-3 个工作日 + 豁免协商 1-3 个工作日 = **3-7 个工作日完成 0/22 → 22/22**。

**关键提醒**:
- 不要等 22/22 才开始改代码 — 联调审核期间代码可以继续改
- 22/22 通过 ≠ 立刻能切生产，还要顺丰运营点「同意上生产」按钮
- PROD checkWord（`mO1AN9899aAJJlzO3ilCJPlEbRjScE8n`）在 22/22 之前**不要写到任何 .env**，避免误用

### Phase 3: 基础设施补齐 — 估时 4-5 天
> 修完 P0 后顺丰沙箱通了，但还差关键基础设施

- [ ] Bug 5 — 面单 PDF OSS 持久化
- [ ] Bug 10 — 卖家批量打印改 iframe / PDF 合并
- [ ] Bug 14 — Shipment 单字段化迁移
- [ ] Bug 15 — checkout 建单时同步建 Shipment
- [ ] Bug 16 — 删 fallback 假数据 + 三态 UI
- [ ] Bug 22 — 卡单监控真主动刷 SF + 三方告警
- [ ] Bug 24 — 商家新订单 webhook（钉钉/企微）
- [ ] Bug 26 — 管理后台物流监控页

### Phase 4: 业务完整性 — 估时 3-5 天

- [ ] Bug 17 / 19 — 售后换货 schema 整理
- [ ] Bug 18 — 买家退货顺丰单号验证
- [ ] Bug 33 — SKU 重量必填 + 默认 1kg
- [ ] Bug 48 — 卖家物流轨迹卡片
- [ ] Bug 50 / 51 — 催发货 / 改地址
- [ ] Bug 23 / 27 / 28 — 配置项化 + admin 运营动作

### Phase 5: 体验 / Push / 灰度 — 上线后再做

- [ ] Bug 25 — Push 通知（FCM 先 Android）
- [ ] Bug 21 — queryTracking 节流 + BullMQ 异步
- [ ] Bug 34 / 35 / 56 — 运费规则进阶
- [ ] Bug 49 — 卖家 dashboard 物流指标
- [ ] Bug 60 — 打印 rate limit
- [ ] Bug 65-67 — 文档 / CI / 部署 checklist

### Phase 6: 文案 / 注释清理 — 估时 0.5 天

- [ ] Bug 40-46（注释 / 文案 / 残留代码）
- [ ] Bug 39 / 61（schema 整理）
- [ ] Bug 67（shipping.md 状态修订）

---

## 附录 A — SF 丰桥 API 对照清单

| 业务 | 接口 | 当前代码状态 | Bug 号 |
|------|------|-------------|--------|
| 下单 | `EXP_RECE_CREATE_ORDER` | 实现，缺 declaredValue / cargoDetails / mobile-tel 区分 / 协议版本可能错 | 8, 37, 38 |
| 取消 | `EXP_RECE_UPDATE_ORDER (dealType=2)` | 实现，幂等已处理 | — |
| 路由查询 | `EXP_RECE_SEARCH_ROUTES` | 实现，缺节流 | 21 |
| 云打印 | `COM_RECE_CLOUD_PRINT_WAYBILLS` | 响应路径错 + 缺 customerCode | 1, 9 |
| 推送回调 | （后台配置 URL） | 字段塞错位置 + 签名缺 timestamp | 2, 3 |
| 路由订阅 | （丰桥后台配置） | 没在丰桥配 | 3 |

---

## 附录 B — 涉及的代码文件全名单

```
backend/src/modules/shipment/
├── sf-express.service.ts          # Bug 1, 2, 3, 7, 8, 9, 30, 36, 37, 38
├── sf-express.service.spec.ts     # Bug 66
├── shipment.service.ts            # Bug 12, 13, 21
├── shipment.controller.ts         # Bug 4, 36
├── shipment.module.ts             # Bug 26 (rawCarrierPayload)
└── shipment-monitor.service.ts    # Bug 22, 23

backend/src/modules/seller/shipping/
├── seller-shipping.service.ts     # Bug 5, 8, 14, 20, 29, 31, 59
└── seller-shipping.controller.ts  # Bug 58, 60

backend/src/modules/seller/orders/
└── seller-orders.service.ts       # Bug 14 (trackingNo 拷贝)

backend/src/modules/seller/after-sale/
├── seller-after-sale.service.ts   # Bug 17, 19
└── seller-after-sale.controller.ts# Bug 19

backend/src/modules/order/
├── checkout.service.ts            # Bug 15, 33
├── order.service.ts               # （取消订单与物流交互，未发现 bug）
└── order-auto-confirm.service.ts  # （cron 已注册，逻辑 OK）

backend/src/modules/after-sale/
├── after-sale.service.ts          # Bug 18
└── after-sale.controller.ts       # —

backend/src/modules/admin/shipping-rule/
└── shipping-rule.service.ts       # Bug 34, 35, 56

backend/src/common/guards/
└── webhook-ip.guard.ts            # Bug 4

backend/prisma/
└── schema.prisma                  # Bug 14, 17, 19, 33, 39, 61

app/
├── orders/track.tsx               # Bug 16, 40, 41, 42
├── orders/[id].tsx                # Bug 50, 51
├── orders/after-sale-detail/[id].tsx # Bug 18, 53, 54
├── checkout.tsx                   # （依赖 Bug 33 修复）
└── me/addresses/...               # Bug 52

src/repos/
└── OrderRepo.ts                   # Bug 43

seller/src/pages/
├── orders/index.tsx               # Bug 10, 46
├── orders/detail.tsx              # Bug 44, 45, 47, 48
├── dashboard/index.tsx            # Bug 49
├── after-sale/detail.tsx          # Bug 55
└── after-sale/index.tsx           # —

admin/src/pages/
├── orders/detail.tsx              # Bug 27
├── after-sale/index.tsx           # Bug 57
├── shipping-rules/index.tsx       # Bug 56
└── （新增）shipments/             # Bug 26, 28

docs/
├── features/shipping.md           # Bug 67
└── operations/阿里云部署.md        # Bug 63

backend/scripts/
└── （新增）sf-sandbox-e2e.ts      # Bug 62 → ❌ 已删除（顺丰自带沙箱工具够用）

backend/prisma/
└── seed.ts                        # Bug 64

ecosystem.config.js (PM2)          # Bug 65
```

---

## 附录 C — 与 `docs/features/shipping.md` 的差异

| `shipping.md` 声称 | 实际状态 | Bug 号 |
|------------------|---------|--------|
| 顺丰直连完成（2026-04-12） | 代码骨架完成，**未真单跑通** | 1-67 |
| `SfExpressService` 5 个方法实现完成 | createOrder/queryRoutes 协议错；printWaybill 响应错；cancelOrder OK；parsePushPayload 签名错 | 1, 2, 3, 8, 9 |
| 测试覆盖 105 个测试通过 | 全 mock fetch，无真实 SF 响应契约测试 | 66 |
| 商家新订单通知（TODO #5） | 未实现 | 24 |
| 买家 Push（TODO #6） | 未实现 | 25 |
| 物流异常监控（TODO #7） | 实现但**静音不告警** | 22 |
| 面单图片持久化 OSS（TODO #4） | 未实现，base64 直入 DB | 5 |
| 真打印对接（TODO #8） | 浏览器 PDF 打印（批量打印破损） | 10, 45 |
| 催发货（TODO #9） | 未实现 | 50 |
| 改地址（TODO #10） | 未实现 | 51 |
| 退货物流（TODO #11） | 后端字段在，前端纯文本输入，无 SF 接入 | 18, 53, 54 |

**结论**: `shipping.md` 第 7 章宣称"全部任务已完成（2026-04-12）"是**严重不实**。代码骨架完成 ≠ 链路打通。本文档（app-tofix3.md）汇总的 67 个 bug 必须分阶段逐个修完，配合外部审批 + 沙箱联调，才能宣告"顺丰直连真上线"。

---

> **下一步**: 看用户决定从哪个 Phase 开始。建议先做 **Phase 1**（P0 阻断级 11 项）+ 同时启动 **Phase 2**（用户去申请顺丰凭证，10-14 天外部审批）。等凭证下来直接进沙箱真调验证，验证通过才能继续 Phase 3-5。
