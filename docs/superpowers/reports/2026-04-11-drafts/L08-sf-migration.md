# L08 — 快递100 → 顺丰丰桥直连迁移计划

**档位**: C 档（基建迁移）
**范围**: 移除 `Kuaidi100Service` / `Kuaidi100WaybillService`，新建 `SfExpressService`，切换卖家发货、物流查询、回调全链路。
**日期**: 2026-04-11
**权威来源**: `docs/features/shipping.md` 第 0 节 / 第 7 节 / 第 8 节

---

## 🎯 目标

1. 彻底移除快递100中间层，直接对接顺丰丰桥（https://qiao.sf-express.com/）
2. 保持 `ShipmentService` / `SellerShippingService` / `Shipment` 表结构对外接口不变
3. 零数据迁移（Shipment.carrierCode 已是 `SF`，沿用即可）
4. 迁移过程中不影响买家 App 物流追踪和卖家后台发货操作

---

## 🧱 前置条件（硬阻断，不做不能迁移）

### PC-1 卖家 Company 发货地址结构化（⚠️ L16 审查发现的阻断点）

**现状**：
- `backend/prisma/schema.prisma:905` `Company.address Json?` 只存 `{lng, lat, text}`
- `seller-shipping.service.ts:100` `getSenderInfo()` 直接 `address?.text` 作为 senderAddress

**问题**：顺丰丰桥 `EXP_RECE_CREATE_ORDER` 需要发件人结构化字段（省/市/区/详细地址）。单字符串 `text` 传进丰桥会被拒或被错误解析。快递100可以吃单字符串是因为它们有地址解析服务；顺丰没有。

**改造要求**（必须先完成）：
1. Schema：`Company.address` 扩展为 `{province, city, district, detail, lng?, lat?}`
2. 卖家后台「企业信息」页：拆分省市区（建议用 Ant Design `Cascader` + 省市区级联数据）
3. 数据迁移：对现有 `text` 进行一次性结构化（可以用高德/腾讯地图逆地理编码 API 拆解；或标记为"未结构化"强制卖家补齐后再发货）
4. `getSenderInfo()` 返回 `{senderProvince, senderCity, senderDistrict, senderAddress, senderName, senderPhone}`

**责任人**: AI 实现 + 用户补数据
**工时**: 0.5 天代码 + 数据迁移视库存而定（建议强制所有已入驻企业在迁移切换前补齐）

### PC-2 修复 addressSnapshot 字段名错位（⚠️ L16 P0 bug，必须先修）

**现状**：
- `backend/src/modules/order/checkout.service.ts:363 / 778` 写入 `{recipientName, recipientPhone, province, city, district, detail}`
- `backend/src/modules/seller/shipping/seller-shipping.service.ts:73-77` `parseAddressSnapshot()` 读取 `addr.name / addr.phone` 并做 fallback 到 `addr.receiverName / addr.receiverPhone`
- **`recipientName`/`recipientPhone` 两个都不命中** → 返回空字符串
- 快递100之所以没爆是因为测试路径没跑通真实 checkout → 发货全链路，或是快递100能吃空字段

**问题**：顺丰丰桥 `EXP_RECE_CREATE_ORDER` 对 `j_contact`/`j_tel`/`d_contact`/`d_tel` 是强制字段，**空字符串会被直接拒绝**。迁移顺丰前必须修掉。

**修复**：
- `parseAddressSnapshot()` 改为读取 `recipientName / recipientPhone`（checkout 写入的真实字段）
- 额外解析 `addr.province / city / district / detail` 而不是拼接进 `address` 字符串（顺丰需要结构化字段）
- 返回签名改为 `{name, phone, province, city, district, detail}`
- 同步补充单测

**责任人**: AI
**工时**: 0.25 天
**依赖**: 无（这个可以立刻做，并且是 SF 迁移的真前置）

---

## 📋 实施步骤清单（22 步）

### 阶段 0：前置修复（代码可立即开工，0.75 天）

#### S0.1 修复 addressSnapshot 字段名错位（PC-2）
- **责任人**: AI
- **工时**: 0.25 天
- **依赖**: 无
- **动作**:
  - 编辑 `seller-shipping.service.ts:52-78` 的 `parseAddressSnapshot`，字段名从 `name/phone` 改为 `recipientName/recipientPhone`
  - 返回对象扩展为 `{name, phone, province, city, district, detail}`
  - `generateWaybill()` 里 `recipientInfo` 的下游消费者同步改签名
  - 改 `seller-shipping.service.spec.ts` 里 mock 数据的字段名
  - `pnpm --filter backend test seller-shipping.service` 通过

#### S0.2 扩展 Company.address 为结构化字段（PC-1）
- **责任人**: AI
- **工时**: 0.5 天
- **依赖**: 无
- **动作**:
  - `schema.prisma:905` 注释改为 `{province, city, district, detail, lng?, lat?, text?}`（`text` 保留做向后兼容）
  - `getSenderInfo()` 返回扩展：`{senderName, senderPhone, senderProvince, senderCity, senderDistrict, senderAddress}`
  - 卖家后台「企业信息」表单加省市区级联（`seller/src/pages/company/settings.tsx` 或类似路径，后续 /ui-ux-pro-max 确认）
  - 管理后台「商户审核」页同步展示/编辑
  - 数据迁移脚本 `backend/prisma/migrations-data/fill-company-address-structured.ts`：对现有 Company 记录做 best-effort 结构化；无法解析的打 `isAddressStructured=false` 标记或通知卖家补齐
  - `npx prisma validate` + `npx prisma migrate dev` 通过

---

### 阶段 1：用户线下申请（并行进行，6-14 天墙钟时间）

#### S1.1 申请顺丰企业月结账号
- **责任人**: 用户
- **工时**: 线下 3-7 天（等顺丰销售联系）
- **依赖**: 无
- **动作**:
  - 访问 https://v.sf-express.com/ 用企业手机号登录/注册
  - 点「申请新的月结账号」，按 `shipping.md` §8.3 第 4 步填表
  - 上传资料：营业执照彩扫 + 法人身份证正反 + 授权书（非法人时） + 经办人身份证
  - 等顺丰初审（1-2 天）→ 当地销售经理联系
  - 和销售经理谈：协议价目表、预存保证金（5k-20k 元）、账期、**必须明确要"开通丰桥电子面单 API 权限 + 云打印面单审核"**
  - 签约、转账预存、拿到：月结账号（12 位）、月结密码、电子账单邮箱、顺丰技术对接人联系方式

#### S1.2 丰桥企业认证 + 创建应用 + API 权限申请
- **责任人**: 用户
- **工时**: 线下 3-6 天
- **依赖**: S1.1 拿到月结账号
- **动作**:
  - 访问 https://qiao.sf-express.com/ 用同一手机号登录
  - 「账号管理」→「企业认证」上传资料（1-3 天审核）
  - 「应用管理」→「创建应用」，名称"爱买买电商平台"，类型"自用型"，语言 Node.js
  - 勾选必选 API：
    - ✅ EXP_RECE_CREATE_ORDER（下订单）
    - ✅ EXP_RECE_SEARCH_ORDER_RESP（订单结果查询）
    - ✅ EXP_RECE_UPDATE_ORDER（确认/取消订单）
    - ✅ EXP_RECE_SEARCH_ROUTES（路由查询）
    - ✅ COM_RECE_CLOUD_PRINT_WAYBILLS（云打印面单）⚠️ 必选
  - 绑定月结账号
  - 提交审核（1-3 天）
  - **把以下凭证发给 AI**：`clientCode` / `checkWord` / `月结账号` / `UAT_URL` / `PROD_URL`

---

### 阶段 2：SfExpressService 开发（AI，不依赖凭证可开工，3 天）

#### S2.1 新建 SfExpressService 骨架
- **责任人**: AI
- **工时**: 0.5 天
- **依赖**: S0.1、S0.2
- **动作**:
  - 新建 `backend/src/modules/shipment/sf-express.service.ts`
  - `@Injectable()` 类骨架，构造函数注入 `ConfigService` 和 `HttpService`（或 `axios`）
  - 读取环境变量：`SF_API_URL` / `SF_API_URL_UAT` / `SF_ENV` / `SF_CLIENT_CODE` / `SF_CHECK_WORD` / `SF_MONTHLY_ACCOUNT` / `SF_CALLBACK_URL`
  - `isConfigured()` 检查 `clientCode && checkWord && monthlyAccount`
  - `private getEndpoint()`：根据 `SF_ENV` 返回 UAT 或 PROD URL
  - 类型定义：`SfCreateOrderParams / SfCreateOrderResult / SfRouteResult / SfPushPayload / SfMappedStatus`

#### S2.2 实现签名算法
- **责任人**: AI
- **工时**: 0.25 天
- **依赖**: S2.1
- **动作**:
  - `private buildVerifyCode(msgData: string, timestamp: string): string` = `Base64(MD5(msgData + timestamp + checkWord))`（丰桥规范：二进制 MD5 → Base64，**非 hex string**）
  - 单测 2 条：固定 msgData + timestamp + checkWord 比对官方文档样例签名（顺丰文档里有 sample）

#### S2.3 实现 createOrder（下单取号）
- **责任人**: AI
- **工时**: 0.5 天
- **依赖**: S2.2
- **动作**:
  - 调用 `EXP_RECE_CREATE_ORDER`，body 结构按丰桥规范构造 `contactInfoList`（2 条：寄件+收件，`contactType=1/2`）
  - 入参字段（对齐 PC-1 / PC-2 的结构化地址）：
    ```ts
    {
      orderId: string;                    // 我方业务订单号（Shipment.id 或唯一键）
      sender: { name, tel, province, city, district, detail };
      receiver: { name, tel, province, city, district, detail };
      cargo: string;                      // 商品描述
      totalWeight?: number;               // kg
      packageCount?: number;
      monthlyCard?: string;               // 月结账号，默认用 SF_MONTHLY_ACCOUNT
      payMethod?: number;                 // 1=寄方付
      expressTypeId?: number;             // 1=顺丰标快，2=顺丰特惠
      isReturnRoutelabel?: number;        // 1=返回电子面单
    }
    ```
  - 返回 `{waybillNo, originCode, destCode, filter?, labelBase64?}`
  - 错误分类：签名错（抛 `UnauthorizedException`）、参数错（抛 `BadRequestException`）、瞬态网络错（原样抛出重试）
  - 脱敏日志：waybillNo 用 `maskTrackingNo`

#### S2.4 实现 printWaybill（云打印面单）
- **责任人**: AI
- **工时**: 0.5 天
- **依赖**: S2.3
- **动作**:
  - 调用 `COM_RECE_CLOUD_PRINT_WAYBILLS`，传 `waybillNoInfoList=[{waybillNo, templateCode}]`
  - `templateCode` 从环境变量 `SF_TEMPLATE_CODE` 读，默认用顺丰官方模板（文档有默认值）
  - 返回 `{waybillImageUrl?, pdfBase64?}`
  - 注意：顺丰返回可能是 BASE64 PDF，需要上传到 OSS 得到 URL 给卖家打印（与 shipping.md §3 Phase1 的"面单图片持久化到 OSS"合并）
  - 若 `SF_TEMPLATE_CODE` 未配置，走 `createOrder` 已返回的 `labelBase64` 路径（避免两次 API 调用）

#### S2.5 实现 cancelOrder
- **责任人**: AI
- **工时**: 0.25 天
- **依赖**: S2.3
- **动作**:
  - 调用 `EXP_RECE_UPDATE_ORDER`，`dealType=2`（取消）
  - 传入 `orderId` 和 `waybillNoInfoList`
  - 幂等：顺丰取消已取消单会返回特定错误码，代码里做 idempotent 处理（把"已取消"视为成功）

#### S2.6 实现 queryRoute（路由查询）
- **责任人**: AI
- **工时**: 0.25 天
- **依赖**: S2.2
- **动作**:
  - 调用 `EXP_RECE_SEARCH_ROUTES`，`trackingType=1`（按顺丰运单号）
  - 入参：`trackingNumber[]`（一次最多 N 条，先做单条）
  - 顺丰不需要手机号后4位（与快递100不同），可简化
  - 返回标准化的 `{status, rawState, events: [{time, message, location?}]}`
  - 建立 `SF_STATE_MAP`：顺丰 `opCode` → 系统 `SHIPPED/IN_TRANSIT/DELIVERED/EXCEPTION`（参考 §7.2，常见 opCode：50=签收、30=派送中、36=派件异常、54=退回、80=退签 等）

#### S2.7 实现 parsePushCallback
- **责任人**: AI
- **工时**: 0.25 天
- **依赖**: S2.6（复用 state map）
- **动作**:
  - 顺丰推送格式：`{msgType: 'ROUTE_PUSH', msgData: {waybillNo, routeList: [{acceptTime, acceptAddress, remark, opCode}]}}`
  - 与快递100 parseCallbackPayload 相似的函数签名，返回 `{trackingNo, status, events}`
  - 丰桥推送签名校验：`Header: verifyCode` = `Base64(MD5(body + checkWord))`（注意与请求签名的区别：推送里没有 timestamp）
  - 返回 null 代表解析失败，由 controller 决定是否吞

#### S2.8 编写 sf-express.service.spec.ts 单测
- **责任人**: AI
- **工时**: 1 天
- **依赖**: S2.1 ~ S2.7
- **动作**:
  - 测试用例（至少 12 条）：
    - 签名算法（2 条）：官方样例 + 边界空字符
    - createOrder 成功返回 waybillNo、createOrder 参数校验、createOrder 401 签名错
    - printWaybill BASE64 模式 + URL 模式
    - cancelOrder 幂等（重复取消视为成功）
    - queryRoute opCode 映射（至少 4 条：50/30/36/54）
    - parsePushCallback 正常解析 + 签名校验失败 + malformed body
  - Mock `axios` 或 `HttpService`
  - `pnpm --filter backend test sf-express.service` 通过

---

### 阶段 3：改造上游模块（AI，约 1.5 天）

#### S3.1 改造 SellerShippingService
- **责任人**: AI
- **工时**: 0.5 天
- **依赖**: S2.1 ~ S2.7、S0.1、S0.2
- **动作**:
  - 构造函数：`Kuaidi100WaybillService` → `SfExpressService`
  - `createCarrierWaybill()`：调 `sfExpress.createOrder()`，参数使用结构化 sender/recipient（PC-1/PC-2 产出）
  - `cancelCarrierWaybill()`：调 `sfExpress.cancelOrder()`
  - `generateWaybill()` 内如果 `carrierCode !== 'SF'` 抛 `BadRequestException('仅支持顺丰快递')`
  - 移除 `Kuaidi100Service.CARRIER_NAME_MAP` 依赖：硬编码 `carrierName = '顺丰速运'`（或在 `SfExpressService` 里暴露一个常量）
  - 打印面单时若 createOrder 已返回 labelBase64，跳过 printWaybill 调用；否则调 `printWaybill` 并上传 OSS

#### S3.2 改造 ShipmentService 和 ShipmentController
- **责任人**: AI
- **工时**: 0.5 天
- **依赖**: S2.1 ~ S2.7
- **动作**:
  - `shipment.service.ts`:
    - 构造函数 `Kuaidi100Service` → `SfExpressService`
    - `handleKuaidi100Callback()` → `handleSfPush()`，内部仍调 `handleCallback()`
    - `verifyKuaidi100CallbackToken()` → `verifySfCallbackSignature()`（用 `Base64(MD5(body + checkWord))`）
    - `queryTrackingFromKuaidi100()` → `queryTrackingFromSf()`，手机号参数可移除（顺丰不需要）
  - `shipment.controller.ts`:
    - `@Post('kuaidi100/callback')` → `@Post('sf/push')`
    - 请求体类型 `Kuaidi100CallbackPayload` → `SfPushPayload`
    - 成功返回格式改为顺丰要求：丰桥文档没有硬性要求响应格式，返回 HTTP 200 即可；但要在 body 里返回 `{apiResultCode: 'A1000'}` 以表示成功（避免重试风暴）
    - 失败返回 503 让顺丰重试
    - `@Get(':orderId/track')` 方法名 `queryTrackingFromKuaidi100` → `queryTrackingFromSf`，路由路径不变（对买家 App 无感）

#### S3.3 更新 ShipmentModule
- **责任人**: AI
- **工时**: 0.1 天
- **依赖**: S3.1、S3.2
- **动作**:
  - `shipment.module.ts` providers/exports 里 `Kuaidi100Service/Kuaidi100WaybillService` → `SfExpressService`
  - 检查所有 `import ... from './kuaidi100*'` 的地方全部替换

#### S3.4 更新 .env.example + 配置文档
- **责任人**: AI
- **工时**: 0.25 天
- **依赖**: S3.3
- **动作**:
  - 删除 `.env.example` 里 `KUAIDI100_*` 所有 7 项
  - 新增 `SF_*` 8 项（见 shipping.md §7.5，外加 `SF_TEMPLATE_CODE`）
  - 更新 `docs/features/shipping.md` 第 2 节改为「当前：顺丰丰桥方案」
  - 更新 `CLAUDE.md` 技术栈段的快递描述

#### S3.5 更新上下游单测和集成测试
- **责任人**: AI
- **工时**: 0.5 天
- **依赖**: S3.1、S3.2
- **动作**:
  - `seller-shipping.service.spec.ts`：mock `SfExpressService` 替代 `Kuaidi100WaybillService`
  - `shipment.controller.spec.ts`：把 `/kuaidi100/callback` 测试改为 `/sf/push`
  - `shipment.service.spec.ts`：`handleKuaidi100Callback` 的测试搬到 `handleSfPush`
  - `pnpm --filter backend test` 全绿

---

### 阶段 4：沙箱联调（用户主导 + AI 支持，1-2 天）

#### S4.1 配置 UAT 环境变量 + 部署到测试环境
- **责任人**: AI + 用户
- **工时**: 0.25 天
- **依赖**: S1.2、S3.5
- **动作**:
  - 填 `.env.uat` 或测试环境配置：`SF_ENV=UAT` + `SF_API_URL_UAT` + sandbox 凭证
  - 部署到测试服务器
  - 在丰桥后台配置推送回调 URL = `https://api-test.爱买买.com/api/v1/shipments/sf/push`（需 HTTPS + 公网可达）

#### S4.2 沙箱发单测试
- **责任人**: 用户
- **工时**: 0.5 天
- **依赖**: S4.1
- **动作**:
  - 卖家后台手工创建一个测试订单 → 点「生成面单」
  - 验证：`Shipment.waybillNo` 有值、`waybillUrl` 有值（OSS 图片可访问）
  - 查日志确认 `EXP_RECE_CREATE_ORDER` 请求/响应完整
  - 重复操作同订单 → 应走幂等路径（CAS where waybillNo: null 保护）

#### S4.3 沙箱物流查询测试
- **责任人**: 用户
- **工时**: 0.25 天
- **依赖**: S4.2
- **动作**:
  - 买家 App 打开订单详情页 → 「刷新物流」
  - 验证 `GET /shipments/:orderId/track` 拉到顺丰 sandbox 假数据
  - `ShipmentTrackingEvent` 表写入事件
  - 重复刷新验证去重（`occurredAt|message` key）

#### S4.4 沙箱推送回调测试
- **责任人**: 用户
- **工时**: 0.25 天
- **依赖**: S4.2
- **动作**:
  - 丰桥 sandbox 有"模拟推送"功能或手工 curl 构造 `SfPushPayload` + 正确签名 POST 到回调端点
  - 验证：`Shipment.status` 更新、`ShipmentTrackingEvent` 写入、全部 shipment DELIVERED 时 `Order: SHIPPED → DELIVERED` CAS 成功
  - 验证签名校验：故意用错的 `checkWord` → 401/403

#### S4.5 沙箱取消面单测试
- **责任人**: 用户
- **工时**: 0.25 天
- **依赖**: S4.2
- **动作**:
  - 卖家后台点「取消面单」
  - 验证先调远端成功再 CAS 清本地 waybillNo
  - 取消已取消单 → 返回幂等成功

#### S4.6 云打印面单审核（顺丰强制）
- **责任人**: 用户 + 顺丰
- **工时**: 1-3 天墙钟时间
- **依赖**: S4.2 真实生成过面单
- **动作**:
  - 在丰桥后台提交「云打印面单审核」，附带沙箱面单截图
  - 顺丰审核面单字段是否齐全、是否符合菜鸟面单规范
  - 审核通过后才能开通生产环境

---

### 阶段 5：生产切换 + 清理（AI + 用户，0.5 天）

#### S5.1 生产凭证配置
- **责任人**: AI + 用户
- **工时**: 0.1 天
- **依赖**: S4.6 审核通过
- **动作**:
  - 生产服务器 `.env`:`SF_ENV=PROD` + `SF_API_URL` 生产地址 + 生产 clientCode/checkWord/monthlyAccount
  - 丰桥后台配置生产回调 URL = `https://api.爱买买.com/api/v1/shipments/sf/push`
  - 重启 backend

#### S5.2 生产 smoke test（灰度）
- **责任人**: 用户
- **工时**: 0.25 天
- **依赖**: S5.1
- **动作**:
  - 真实发 3-5 单低价订单（内部员工测试）
  - 验证：面单生成、真实打印、顺丰小哥取件、买家 App 能看物流更新、签收后自动确认收货
  - 确认后放量

#### S5.3 删除快递100文件
- **责任人**: AI
- **工时**: 0.1 天
- **依赖**: S5.2 通过
- **动作**:
  - `git rm backend/src/modules/shipment/kuaidi100.service.ts`
  - `git rm backend/src/modules/shipment/kuaidi100-waybill.service.ts`
  - `git rm backend/src/modules/shipment/kuaidi100-waybill.service.spec.ts`
  - `git rm backend/src/modules/shipment/shipment.service.kuaidi100-callback.spec.ts`
  - 全仓 grep `Kuaidi100` / `kuaidi100` 确认零引用
  - `pnpm --filter backend build` 通过
  - `pnpm --filter backend test` 全绿
  - `pnpm --filter backend exec tsc --noEmit` 通过

#### S5.4 文档最终更新
- **责任人**: AI
- **工时**: 0.1 天
- **依赖**: S5.3
- **动作**:
  - `docs/features/shipping.md`：将 §0 的"即将废弃"改为"已废弃"，§1 数据流图更新，§7 标记为"已完成"
  - `plan.md` 更新迁移进度为 DONE
  - `docs/architecture/data-system.md` 若有 `Company.address` 的描述同步结构化字段

---

## 🔧 用户线下完成事项汇总

| 事项 | 平台 | 周期 | 交付物 |
|------|------|------|--------|
| 顺丰月结账号申请 | https://v.sf-express.com/ | 3-7 天 | 12 位月结号 + 密码 + 销售/技术对接人 |
| 丰桥企业认证 | https://qiao.sf-express.com/ | 1-3 天 | 企业认证通过 |
| 丰桥应用创建 + API 审批 | 丰桥 | 1-3 天 | clientCode / checkWord / 沙箱 URL |
| 云打印面单审核 | 丰桥 | 1-3 天 | 审核通过 → 可切生产 |
| 生产环境开通 | 丰桥 | 1-2 天 | 生产 URL |
| 预存保证金 | 对公转账 | - | 5000-20000 元（可退） |
| 沙箱发单/查询/回调/取消联调 | 本地开发环境 | 1-2 天 | 流程跑通 |
| 生产 smoke test | 生产环境 | 0.25 天 | 3-5 单真实订单 OK |
| **总墙钟时间** | | **8-21 天（中位 10-14 天）** | |

**必须让用户明确的事项**：
- 测试账号：沙箱 UAT 是丰桥统一的共享沙箱，不需要单独申请，但**生产凭证只能在月结+丰桥应用审批通过后才拿到**
- 正式账号：丰桥应用审核通过后返回的 clientCode/checkWord 就是生产凭证，UAT 可以一起用

---

## ⚠️ 迁移风险与应对

### 风险矩阵

| # | 风险 | 影响 | 应对 |
|---|------|------|------|
| R1 | 沙箱审核不通过（面单字段不合规） | 无法切生产 | 先在 S4.6 预审核，留 3 天缓冲 |
| R2 | 顺丰推送签名格式理解错误 → 回调全挂 | 物流状态停滞 | S2.7 严格按丰桥文档实现 + 保留兜底轮询 (`queryRoute`) |
| R3 | 切生产后发现地址字段不结构化 → 下单批量失败 | 发货瘫痪 | PC-1 前置硬阻断，切换前确认所有活跃商户的地址已结构化 |
| R4 | 删除 Kuaidi100 文件后才发现 shipment.service 还有隐性引用 | 编译失败 | S3.3 做完后 grep 整仓 + tsc --noEmit |
| R5 | checkWord 泄露 | 攻击者伪造回调 | `.env` 加 `.gitignore`，生产 secret 走 K8s/Docker Secret |
| R6 | 生产切换后顺丰 opCode 新编码未覆盖 → 状态停在 IN_TRANSIT | 自动确认收货延迟 | `SF_STATE_MAP` 支持 fallback（未知 opCode 记事件但不改 status），加监控告警 |
| R7 | L16 发现的 addressSnapshot 字段错位修复后，历史订单解析不出来 | 已有订单发货失败 | `parseAddressSnapshot` 保留旧字段 fallback（`addr.name || addr.recipientName`），双读单写 |
| R8 | Company.address 迁移过程中部分商户没补结构化 | 这些商户无法发货 | 卖家后台「生成面单」前置校验，未补齐的商户弹窗提示补齐企业信息 |

### 回滚方案

**金丝雀回滚窗口：S5.2 ~ S5.3 之间（生产切换后、删除文件前）**

- 保留 `Kuaidi100*` 文件和 `shipment-provider.factory.ts`（如需）一个灰度开关 `SHIPPING_PROVIDER=sf|kuaidi100`
- `ShipmentModule` 根据环境变量动态 provider：
  ```ts
  {
    provide: 'SHIPPING_PROVIDER',
    useFactory: (cfg: ConfigService) =>
      cfg.get('SHIPPING_PROVIDER') === 'sf' ? SfExpressService : Kuaidi100WaybillService,
    inject: [ConfigService],
  }
  ```
- 生产出问题时改 env `SHIPPING_PROVIDER=kuaidi100` 并重启（需保留快递100账号至少 7 天不注销）
- S5.3 删除文件条件：**生产稳定运行满 7 天无 incident**

**不可回滚的部分**：
- PC-1（结构化地址 schema 迁移）是单向的，回滚到 kuaidi100 不需要反迁移
- PC-2（addressSnapshot 字段修复）兼容双读，无需回滚

### 保留文件（不动）

```
backend/src/modules/shipment/shipment.service.ts         (核心业务逻辑)
backend/src/modules/shipment/shipment.controller.ts      (仅改路由名)
backend/src/modules/shipment/dto/                        (不动)
backend/src/modules/seller/shipping/seller-shipping.service.ts  (构造函数替换，逻辑不动)
backend/src/modules/seller/orders/seller-orders.service.ts      (不动)
backend/src/modules/order/order-auto-confirm.service.ts         (不动)
backend/prisma/schema.prisma Shipment 表字段             (不动)
买家 App 物流追踪页 app/order/tracking/[id].tsx          (不动)
卖家后台发货管理页                                        (不动)
```

### 删除文件（S5.3 阶段）

```
backend/src/modules/shipment/kuaidi100.service.ts
backend/src/modules/shipment/kuaidi100-waybill.service.ts
backend/src/modules/shipment/kuaidi100-waybill.service.spec.ts
backend/src/modules/shipment/shipment.service.kuaidi100-callback.spec.ts
```

### 替换/新增文件

```
+ backend/src/modules/shipment/sf-express.service.ts           (新增)
+ backend/src/modules/shipment/sf-express.service.spec.ts      (新增)
~ backend/src/modules/shipment/shipment.module.ts              (provider 替换)
~ backend/src/modules/shipment/shipment.controller.ts          (方法 + 路由名)
~ backend/src/modules/shipment/shipment.service.ts             (私有方法名 + provider)
~ backend/src/modules/shipment/shipment.service.spec.ts        (方法名对齐)
~ backend/src/modules/shipment/shipment.controller.spec.ts     (路由对齐)
~ backend/src/modules/seller/shipping/seller-shipping.service.ts        (构造函数 + 地址解析)
~ backend/src/modules/seller/shipping/seller-shipping.service.spec.ts   (mock 对齐)
~ backend/src/modules/seller/after-sale/seller-after-sale.service.ts    (Kuaidi100 引用替换)
~ backend/src/modules/order/checkout.service.ts                (addressSnapshot 字段检查)
~ backend/prisma/schema.prisma                                 (Company.address 结构化注释 / 字段)
~ .env.example                                                 (KUAIDI100_* → SF_*)
~ docs/features/shipping.md                                    (节次状态更新)
~ CLAUDE.md                                                    (快递描述同步)
```

### Shipment.carrierCode 新旧对照

| 字段 | 快递100时代 | 顺丰直连时代 |
|------|------------|--------------|
| `carrierCode` | `SF/YTO/ZTO/STO/YUNDA/JD/EMS` | **只有 `SF`**，其他值视为非法 |
| `carrierName` | 从 `CARRIER_NAME_MAP` 查 | 硬编码 `顺丰速运` |
| `trackingNo` | 快递100分配的单号 | 顺丰分配的单号（SFXXXXXXXXXXXX） |
| `waybillUrl` | 快递100返回的短链 | OSS 上传后的 URL |
| `receiverInfoSnapshot` | `{name, phone, address}` | `{name, phone, province, city, district, detail}`（PC-2 后） |

**数据层面不需要迁移**：历史 Shipment 记录 `carrierCode=SF` 本来就成立；卖家后台的「运输方式」选项可以简化为只有"顺丰速运"。

---

## 🎯 完成判定（Done Checklist）

### 代码完成
- [ ] S0.1 addressSnapshot 字段名错位修复 + 单测通过
- [ ] S0.2 Company.address 结构化 schema + 迁移脚本 + 卖家端表单更新
- [ ] S2.1-S2.7 SfExpressService 全部方法实现
- [ ] S2.8 sf-express.service.spec.ts 至少 12 条单测全绿
- [ ] S3.1 SellerShippingService 构造函数 + createCarrierWaybill/cancelCarrierWaybill 切换
- [ ] S3.2 ShipmentService/Controller 回调端点改名 + 签名校验切换
- [ ] S3.3 ShipmentModule providers 更新
- [ ] S3.4 .env.example + shipping.md + CLAUDE.md 同步
- [ ] S3.5 所有相关 spec 测试全绿
- [ ] `pnpm --filter backend build` 零错误
- [ ] `pnpm --filter backend exec tsc --noEmit` 零错误
- [ ] 全仓 grep `Kuaidi100` / `kuaidi100` 仅剩历史文档引用

### 外部凭证
- [ ] 顺丰月结账号激活（12 位数字）
- [ ] 丰桥企业认证通过
- [ ] 丰桥应用创建 + API 权限审批通过（5 个 API 勾选）
- [ ] 云打印面单审核通过
- [ ] 生产环境开通
- [ ] 凭证已填入生产 `.env`（secret 存储合规）

### 联调完成
- [ ] S4.2 沙箱发单成功，waybillNo 和面单图片可用
- [ ] S4.3 沙箱物流查询正常，事件去重生效
- [ ] S4.4 沙箱推送回调走通，签名校验 OK，订单状态联动 PAID→SHIPPED→DELIVERED
- [ ] S4.5 沙箱取消面单幂等
- [ ] S4.6 云打印面单审核通过

### 生产切换
- [ ] S5.1 生产凭证配置完毕 + 回调 URL 在丰桥后台生效
- [ ] S5.2 生产灰度 3-5 单 smoke test 无异常
- [ ] 监控告警：顺丰 API 错误率 / 回调签名失败率 / 未知 opCode 埋点上线
- [ ] 生产稳定运行 7 天无 incident
- [ ] S5.3 快递100 4 个文件删除 + 构建测试全绿
- [ ] S5.4 文档最终更新

### 灰度 / 回滚准备
- [ ] 可选：`SHIPPING_PROVIDER` 灰度开关就位（或明确跳过理由）
- [ ] 快递100账号保留至少 7 天备用
- [ ] 已通知卖家"快递方式仅顺丰"（短信 / 站内信）

---

## 🔗 交叉依赖

- **L16（address）**: PC-1 和 PC-2 依赖 L16 的审查结论。PC-2 的字段名修复是这次迁移的**硬依赖**，不能被 L16 合入延后
- **L10（seller-product）**: 卖家后台企业信息表单改造，如果 L10 同时在改卖家设置页要做好文件冲突协调
- **L07（after-sale）**: `seller-after-sale.service.ts` 里的换货面单生成也会被替换，跟 L07 的售后改造并行时需要合并改动
- **L17（trace）**: 监控埋点（SF API 错误率、回调失败率、未知 opCode）应与 L17 的可观测性方案对齐

---

## 📊 工时合计

| 阶段 | 工时 | 责任人 |
|------|------|--------|
| 阶段 0 前置修复 | 0.75 天 | AI |
| 阶段 1 外部申请 | 0 代码工时（墙钟 6-14 天） | 用户 |
| 阶段 2 SfExpressService 开发 | 3.5 天 | AI |
| 阶段 3 改造上游 | 1.85 天 | AI |
| 阶段 4 沙箱联调 | 1.5 天 | 用户 + AI |
| 阶段 5 生产切换 + 清理 | 0.55 天 | AI + 用户 |
| **总计** | **≈ 8.15 天 AI 工时 + 2 天用户工时** | |
| **墙钟时间**（含外部审批） | **10-16 天** | |
