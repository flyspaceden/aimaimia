# 快递100电子面单统一集成设计方案

## 背景

当前系统物流链路中，物流查询和推送订阅已通过快递100打通，但电子面单（下单取号+打印）走的是 7 个独立的快递公司 Provider（SF/YTO/ZTO/STO/YUNDA/JD/EMS），全部是占位实现返回假数据。

快递100电子面单 V2 API 一个接口即可覆盖 50+ 快递公司的下单和面单生成，无需分别对接各家。本方案将 7 个占位 Provider 替换为统一的快递100电子面单服务。

## 业务决策

- **月结账号**：平台统一账号，所有商家的包裹走平台的快递100电子面单账号
- **运费承担**：平台支付，商家不需要自己的月结号
- **打印模式**：IMAGE（返回面单图片短链），兼容现有打印代理流程

## 架构变更

### 变更前

```
SellerShippingService
  └→ providerRegistry (Map<string, ShippingProvider>)
       ├→ SfProvider     [占位mock]
       ├→ YtoProvider    [占位mock]
       ├→ ZtoProvider    [占位mock]
       ├→ StoProvider    [占位mock]
       ├→ YundaProvider  [占位mock]
       ├→ JdProvider     [占位mock]
       └→ EmsProvider    [占位mock]
```

### 变更后

```
SellerShippingService
  └→ Kuaidi100WaybillService
       └→ 快递100电子面单V2 API (https://api.kuaidi100.com/label/order)
            └→ 覆盖所有快递公司
```

## 新增：Kuaidi100WaybillService

文件：`backend/src/modules/shipment/kuaidi100-waybill.service.ts`

### 职责

封装快递100电子面单 V2 API，提供面单创建和取消能力。

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `KUAIDI100_KEY` | 是 | 快递100授权码（已有） |
| `KUAIDI100_SECRET` | 是 | 电子面单签名密钥（新增） |
| `KUAIDI100_PARTNER_ID` | 是 | 平台统一电子面单月结账号（新增） |
| `KUAIDI100_PARTNER_KEY` | 否 | 月结密码，部分快递公司需要（新增） |

### 签名算法

```
sign = MD5(param + t + key + secret).toUpperCase()
```

其中 `param` 是业务参数 JSON 字符串，`t` 是毫秒级时间戳，`key` 和 `secret` 来自环境变量。

### 方法定义

#### `createWaybill()`

调用快递100电子面单 V2 下单接口。

```typescript
async createWaybill(params: {
  carrierCode: string;       // 系统编码 SF/YTO/ZTO 等
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  cargo: string;             // 物品名称
  weight?: number;           // 重量(kg)
  count?: number;            // 包裹数量，默认1
}): Promise<{
  waybillNo: string;         // 快递单号
  waybillImageUrl: string;   // 面单图片短链
  taskId: string;            // 快递100任务ID（用于复打/取消）
}>
```

快递100 API 调用参数：
- `printType`: `"IMAGE"` — 返回面单图片短链
- `kuaidicom`: 快递公司编码（快递100格式，如 `shunfeng`、`zhongtong`）
- `partnerId`: 环境变量 `KUAIDI100_PARTNER_ID`
- `partnerKey`: 环境变量 `KUAIDI100_PARTNER_KEY`（可选）
- `recMan`: 收件人信息对象
- `sendMan`: 寄件人信息对象
- `cargo`: 物品名称
- `weight`: 重量
- `count`: 包裹数量
- `payType`: `"MONTHLY"` — 月结支付
- `needSubscribe`: `true` — 下单时自动订阅物流推送
- `pollCallBackUrl`: 快递100回调地址（复用 `KUAIDI100_CALLBACK_URL` + token）

#### `cancelWaybill()`

调用快递100面单取消接口。

```typescript
async cancelWaybill(taskId: string): Promise<{ success: boolean }>
```

#### `isConfigured()`

检查电子面单必要配置是否就绪。

```typescript
isConfigured(): boolean
// 检查 KUAIDI100_KEY + KUAIDI100_SECRET + KUAIDI100_PARTNER_ID 是否都已配置
```

### 快递公司编码映射

复用 `Kuaidi100Service` 已有的 `CARRIER_MAP`，将其改为 `static` 导出：

```typescript
// 系统编码 → 快递100编码
SF    → shunfeng
YTO   → yuantong
ZTO   → zhongtong
STO   → shentong
YUNDA → yunda
JD    → jd
EMS   → ems
```

## 改造：SellerShippingService

### 移除

- `providerRegistry` (Map<string, ShippingProvider>)
- 构造函数中 7 个 Provider 的注入
- `getProvider()` 方法

### 注入

- `Kuaidi100WaybillService`

### 方法变更

#### `createCarrierWaybill()`

改为调用 `Kuaidi100WaybillService.createWaybill()`。返回结构不变（waybillNo, waybillUrl, senderInfoSnapshot, receiverInfoSnapshot），新增 `taskId` 存入 Shipment 以支持取消和复打。

#### `cancelCarrierWaybill()`

改为调用 `Kuaidi100WaybillService.cancelWaybill(taskId)`。需要从 Shipment 记录获取 `taskId`。

## 改造：SellerShippingModule

- 移除 7 个 Provider 的 providers 注册
- 导入 `ShipmentModule`（获取 `Kuaidi100WaybillService`）

## 改造：ShipmentModule

- 导出 `Kuaidi100WaybillService` 和 `Kuaidi100Service`

## 改造：Kuaidi100Service

- 将 `CARRIER_MAP` 从 `private static` 改为 `public static`，供 `Kuaidi100WaybillService` 复用

## 改造：发货自动订阅物流推送

当前 `SellerOrdersService.ship()` 确认发货后没有订阅快递100推送。

由于电子面单下单时设置 `needSubscribe: true`，快递100会在下单时自动订阅物流推送，无需在发货确认时额外调用订阅接口。

## Schema 变更

`Shipment` 模型新增字段：

```prisma
model Shipment {
  // ... 现有字段
  kuaidi100TaskId  String?   // 快递100任务ID（用于取消/复打）
}
```

## 环境变量变更

`.env.example` 新增：

```env
# 快递100电子面单
KUAIDI100_SECRET="your-kuaidi100-secret"
KUAIDI100_PARTNER_ID="your-platform-partner-id"
KUAIDI100_PARTNER_KEY=""
```

## 删除文件

| 文件 | 原因 |
|------|------|
| `backend/src/modules/seller/shipping/providers/sf.provider.ts` | 被 Kuaidi100WaybillService 替代 |
| `backend/src/modules/seller/shipping/providers/yto.provider.ts` | 同上 |
| `backend/src/modules/seller/shipping/providers/zto.provider.ts` | 同上 |
| `backend/src/modules/seller/shipping/providers/sto.provider.ts` | 同上 |
| `backend/src/modules/seller/shipping/providers/yunda.provider.ts` | 同上 |
| `backend/src/modules/seller/shipping/providers/jd.provider.ts` | 同上 |
| `backend/src/modules/seller/shipping/providers/ems.provider.ts` | 同上 |
| `backend/src/modules/seller/shipping/shipping-provider.interface.ts` | 接口不再需要 |

## 不变的部分

| 模块 | 说明 |
|------|------|
| `ShipmentService` | 物流回调处理逻辑不变 |
| `Kuaidi100Service`（查询+订阅） | 仅导出 CARRIER_MAP，其他不变 |
| `ShipmentController` | 回调端点不变 |
| `SellerShippingController` | API 接口不变，前端无感 |
| 买家 App 物流追踪页 | 不变 |
| 卖家后台前端 | 不变 |
| 管理后台运费规则 | 不变 |

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 新增 | `backend/src/modules/shipment/kuaidi100-waybill.service.ts` |
| 修改 | `backend/src/modules/seller/shipping/seller-shipping.service.ts` |
| 修改 | `backend/src/modules/seller/shipping/seller-shipping.module.ts` |
| 修改 | `backend/src/modules/shipment/shipment.module.ts` |
| 修改 | `backend/src/modules/shipment/kuaidi100.service.ts` |
| 修改 | `backend/prisma/schema.prisma`（Shipment 新增 kuaidi100TaskId） |
| 修改 | `backend/.env.example` |
| 删除 | 7 个 `providers/*.provider.ts` |
| 删除 | `shipping-provider.interface.ts` |
