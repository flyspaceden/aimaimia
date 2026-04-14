# 快递100电子面单统一集成 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 7 个占位快递 Provider 替换为快递100电子面单 V2 API 统一集成，实现真实面单下单和取消。

**Architecture:** 新增 `Kuaidi100WaybillService` 封装快递100电子面单 API（下单+取消），`SellerShippingService` 改为注入该服务而非 7 个独立 Provider。电子面单下单时自动订阅物流推送（`needSubscribe: true`），无需额外订阅步骤。

**Tech Stack:** NestJS, Prisma, 快递100电子面单 V2 API, MD5 签名

---

### Task 1: Schema 变更 — Shipment 新增 kuaidi100TaskId

**Files:**
- Modify: `backend/prisma/schema.prisma:1554-1578`

- [ ] **Step 1: 添加 kuaidi100TaskId 字段**

在 `backend/prisma/schema.prisma` 的 Shipment 模型中，在 `rawCarrierPayload` 字段后新增：

```prisma
  kuaidi100TaskId  String?   // 快递100任务ID（用于取消/复打）
```

- [ ] **Step 2: 生成并应用迁移**

Run: `cd backend && npx prisma migrate dev --name add-shipment-kuaidi100-task-id`
Expected: Migration applied successfully

- [ ] **Step 3: 验证 Schema**

Run: `cd backend && npx prisma validate`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/
git commit -m "feat(schema): add kuaidi100TaskId to Shipment model"
```

---

### Task 2: 新增 Kuaidi100WaybillService

**Files:**
- Create: `backend/src/modules/shipment/kuaidi100-waybill.service.ts`
- Modify: `backend/src/modules/shipment/kuaidi100.service.ts:54` (导出 CARRIER_MAP)

- [ ] **Step 1: 导出 Kuaidi100Service 的 CARRIER_MAP**

在 `backend/src/modules/shipment/kuaidi100.service.ts` 中，将 `CARRIER_MAP` 从 `private static` 改为 `public static readonly`：

```typescript
  /** 系统快递编码 → 快递100快递编码映射 */
  public static readonly CARRIER_MAP: Record<string, string> = {
```

同时新增快递公司中文名映射（在 `CARRIER_MAP` 后面）：

```typescript
  /** 系统快递编码 → 中文名称 */
  public static readonly CARRIER_NAME_MAP: Record<string, string> = {
    SF: '顺丰速运',
    YTO: '圆通快递',
    ZTO: '中通快递',
    STO: '申通快递',
    YUNDA: '韵达快递',
    JD: '京东物流',
    EMS: 'EMS',
  };
```

- [ ] **Step 2: 创建 Kuaidi100WaybillService**

创建 `backend/src/modules/shipment/kuaidi100-waybill.service.ts`：

```typescript
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Kuaidi100Service } from './kuaidi100.service';

export interface CreateWaybillParams {
  carrierCode: string;
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  cargo: string;
  weight?: number;
  count?: number;
}

export interface CreateWaybillResult {
  waybillNo: string;
  waybillImageUrl: string;
  taskId: string;
}

@Injectable()
export class Kuaidi100WaybillService {
  private readonly logger = new Logger(Kuaidi100WaybillService.name);

  private readonly key: string;
  private readonly secret: string;
  private readonly partnerId: string;
  private readonly partnerKey: string;
  private readonly callbackUrl: string;
  private readonly callbackToken: string;

  constructor(private configService: ConfigService) {
    this.key = this.configService.get<string>('KUAIDI100_KEY', '');
    this.secret = this.configService.get<string>('KUAIDI100_SECRET', '');
    this.partnerId = this.configService.get<string>('KUAIDI100_PARTNER_ID', '');
    this.partnerKey = this.configService.get<string>('KUAIDI100_PARTNER_KEY', '');
    this.callbackUrl = this.configService.get<string>('KUAIDI100_CALLBACK_URL', '');
    this.callbackToken = this.configService.get<string>('KUAIDI100_CALLBACK_TOKEN', '');

    if (!this.key || !this.secret || !this.partnerId) {
      this.logger.warn(
        '快递100电子面单配置不完整（KUAIDI100_KEY / KUAIDI100_SECRET / KUAIDI100_PARTNER_ID），面单功能不可用',
      );
    }
  }

  /** 检查电子面单服务是否已配置 */
  isConfigured(): boolean {
    return !!(this.key && this.secret && this.partnerId);
  }

  /**
   * 创建电子面单
   * 调用快递100电子面单 V2 接口
   */
  async createWaybill(params: CreateWaybillParams): Promise<CreateWaybillResult> {
    if (!this.isConfigured()) {
      throw new BadRequestException('快递100电子面单服务未配置，无法生成面单');
    }

    const kuaidicom = Kuaidi100Service.CARRIER_MAP[params.carrierCode.toUpperCase()];
    if (!kuaidicom) {
      throw new BadRequestException(
        `不支持的快递公司编码: ${params.carrierCode}，支持: ${Object.keys(Kuaidi100Service.CARRIER_MAP).join(', ')}`,
      );
    }

    const paramObj: Record<string, any> = {
      printType: 'IMAGE',
      kuaidicom,
      partnerId: this.partnerId,
      partnerKey: this.partnerKey || undefined,
      recMan: {
        name: params.recipientName,
        mobile: params.recipientPhone,
        printAddr: params.recipientAddress,
      },
      sendMan: {
        name: params.senderName,
        mobile: params.senderPhone,
        printAddr: params.senderAddress,
      },
      cargo: params.cargo,
      weight: params.weight ? String(params.weight) : undefined,
      count: String(params.count || 1),
      payType: 'MONTHLY',
      needSubscribe: true,
    };

    // 如果配置了回调地址，设置物流推送回调
    const pollCallBackUrl = this.buildCallbackUrl();
    if (pollCallBackUrl) {
      paramObj.pollCallBackUrl = pollCallBackUrl;
    }

    const param = JSON.stringify(paramObj);
    const t = String(Date.now());
    const sign = crypto
      .createHash('md5')
      .update(param + t + this.key + this.secret)
      .digest('hex')
      .toUpperCase();

    try {
      const response = await fetch('https://api.kuaidi100.com/label/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          key: this.key,
          sign,
          t,
          method: 'order',
          param,
        }).toString(),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        this.logger.error(`快递100面单API HTTP错误: ${response.status} ${response.statusText}`);
        throw new BadRequestException('快递100面单服务请求失败');
      }

      const data = await response.json();

      if (!data.success && data.code !== 200) {
        this.logger.error(
          `快递100面单下单失败: code=${data.code}, message=${data.message || '未知错误'}`,
        );
        throw new BadRequestException(
          `面单生成失败: ${data.message || '快递100返回错误'}`,
        );
      }

      const waybillNo = data.data?.kuaidinum;
      const taskId = data.data?.taskId;
      const label = data.data?.label;

      if (!waybillNo) {
        this.logger.error('快递100面单返回缺少 kuaidinum');
        throw new BadRequestException('面单生成失败: 未获取到快递单号');
      }

      this.logger.log(
        `面单生成成功: carrier=${kuaidicom}, waybillNo=${waybillNo.slice(0, 4)}****`,
      );

      return {
        waybillNo,
        waybillImageUrl: label || '',
        taskId: taskId || '',
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`快递100面单API异常: ${error.message || error}`);
      throw new BadRequestException('快递100面单服务异常，请稍后重试');
    }
  }

  /**
   * 取消面单
   * 调用快递100面单取消接口
   */
  async cancelWaybill(taskId: string): Promise<{ success: boolean }> {
    if (!this.isConfigured() || !taskId) {
      this.logger.warn('面单取消跳过: 服务未配置或缺少 taskId');
      return { success: false };
    }

    const param = JSON.stringify({ taskId });
    const t = String(Date.now());
    const sign = crypto
      .createHash('md5')
      .update(param + t + this.key + this.secret)
      .digest('hex')
      .toUpperCase();

    try {
      const response = await fetch('https://api.kuaidi100.com/label/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          key: this.key,
          sign,
          t,
          method: 'cancel',
          param,
        }).toString(),
        signal: AbortSignal.timeout(10000),
      });

      const data = await response.json();
      const success = data.success === true || data.code === 200;

      if (!success) {
        this.logger.warn(`快递100面单取消失败: code=${data.code}, message=${data.message}`);
      } else {
        this.logger.log(`面单取消成功: taskId=${taskId}`);
      }

      return { success };
    } catch (error: any) {
      this.logger.error(`快递100面单取消异常: ${error.message || error}`);
      return { success: false };
    }
  }

  private buildCallbackUrl(): string {
    if (!this.callbackUrl) return '';
    try {
      const url = new URL(this.callbackUrl);
      if (this.callbackToken && !url.searchParams.has('token')) {
        url.searchParams.set('token', this.callbackToken);
      }
      return url.toString();
    } catch {
      return this.callbackUrl;
    }
  }
}
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无与 kuaidi100-waybill.service.ts 相关的错误

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/shipment/kuaidi100.service.ts backend/src/modules/shipment/kuaidi100-waybill.service.ts
git commit -m "feat(shipment): add Kuaidi100WaybillService for electronic waybill API"
```

---

### Task 3: 编写 Kuaidi100WaybillService 单元测试

**Files:**
- Create: `backend/src/modules/shipment/kuaidi100-waybill.service.spec.ts`

- [ ] **Step 1: 编写测试**

创建 `backend/src/modules/shipment/kuaidi100-waybill.service.spec.ts`：

```typescript
import { BadRequestException } from '@nestjs/common';
import { Kuaidi100WaybillService } from './kuaidi100-waybill.service';

// mock fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function createService(overrides: Record<string, string> = {}) {
  const config: Record<string, string> = {
    KUAIDI100_KEY: 'test-key',
    KUAIDI100_SECRET: 'test-secret',
    KUAIDI100_PARTNER_ID: 'test-partner',
    KUAIDI100_PARTNER_KEY: '',
    KUAIDI100_CALLBACK_URL: 'https://api.example.com/shipments/kuaidi100/callback',
    KUAIDI100_CALLBACK_TOKEN: 'cb-token',
    ...overrides,
  };

  const configService = {
    get: jest.fn((key: string, defaultVal?: string) => config[key] ?? defaultVal ?? ''),
  };

  return new Kuaidi100WaybillService(configService as any);
}

const validParams = {
  carrierCode: 'SF',
  senderName: '张三',
  senderPhone: '13800000001',
  senderAddress: '浙江省杭州市西湖区xxx路1号',
  recipientName: '李四',
  recipientPhone: '13900000002',
  recipientAddress: '广东省深圳市南山区xxx路2号',
  cargo: '农产品',
  weight: 1.5,
  count: 1,
};

describe('Kuaidi100WaybillService', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('isConfigured', () => {
    it('全部配置时返回 true', () => {
      const service = createService();
      expect(service.isConfigured()).toBe(true);
    });

    it('缺少 SECRET 时返回 false', () => {
      const service = createService({ KUAIDI100_SECRET: '' });
      expect(service.isConfigured()).toBe(false);
    });

    it('缺少 PARTNER_ID 时返回 false', () => {
      const service = createService({ KUAIDI100_PARTNER_ID: '' });
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('createWaybill', () => {
    it('未配置时抛出 BadRequestException', async () => {
      const service = createService({ KUAIDI100_SECRET: '' });
      await expect(service.createWaybill(validParams)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('不支持的快递编码抛出 BadRequestException', async () => {
      const service = createService();
      await expect(
        service.createWaybill({ ...validParams, carrierCode: 'UNKNOWN' }),
      ).rejects.toThrow('不支持的快递公司编码');
    });

    it('成功下单返回 waybillNo + waybillImageUrl + taskId', async () => {
      const service = createService();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          code: 200,
          data: {
            kuaidinum: 'SF1234567890',
            taskId: 'TASK001',
            label: 'https://label.kuaidi100.com/xxx.png',
          },
        }),
      });

      const result = await service.createWaybill(validParams);

      expect(result.waybillNo).toBe('SF1234567890');
      expect(result.waybillImageUrl).toBe('https://label.kuaidi100.com/xxx.png');
      expect(result.taskId).toBe('TASK001');

      // 验证 fetch 调用参数
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.kuaidi100.com/label/order',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('快递100返回错误时抛出 BadRequestException', async () => {
      const service = createService();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          code: 30001,
          message: '参数错误',
        }),
      });

      await expect(service.createWaybill(validParams)).rejects.toThrow('参数错误');
    });

    it('HTTP 错误时抛出 BadRequestException', async () => {
      const service = createService();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(service.createWaybill(validParams)).rejects.toThrow(
        '快递100面单服务请求失败',
      );
    });

    it('网络异常时抛出 BadRequestException', async () => {
      const service = createService();
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(service.createWaybill(validParams)).rejects.toThrow(
        '快递100面单服务异常',
      );
    });
  });

  describe('cancelWaybill', () => {
    it('未配置时跳过并返回 success: false', async () => {
      const service = createService({ KUAIDI100_SECRET: '' });
      const result = await service.cancelWaybill('TASK001');
      expect(result.success).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('空 taskId 时跳过', async () => {
      const service = createService();
      const result = await service.cancelWaybill('');
      expect(result.success).toBe(false);
    });

    it('成功取消', async () => {
      const service = createService();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, code: 200 }),
      });

      const result = await service.cancelWaybill('TASK001');
      expect(result.success).toBe(true);
    });

    it('取消失败不抛异常', async () => {
      const service = createService();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false, code: 30005, message: '取消失败' }),
      });

      const result = await service.cancelWaybill('TASK001');
      expect(result.success).toBe(false);
    });
  });
});
```

- [ ] **Step 2: 运行测试确认全部通过**

Run: `cd backend && npx jest kuaidi100-waybill.service.spec --no-coverage`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/shipment/kuaidi100-waybill.service.spec.ts
git commit -m "test(shipment): add unit tests for Kuaidi100WaybillService"
```

---

### Task 4: 改造 SellerShippingService — 替换 Provider 为 Kuaidi100WaybillService

**Files:**
- Modify: `backend/src/modules/seller/shipping/seller-shipping.service.ts`

- [ ] **Step 1: 替换导入**

在 `backend/src/modules/seller/shipping/seller-shipping.service.ts` 中：

移除所有 Provider 和 ShippingProvider 接口的导入（第 7-19 行）：
```typescript
// 删除以下导入
import { ShippingProvider } from './shipping-provider.interface';
import { SfProvider } from './providers/sf.provider';
import { YtoProvider } from './providers/yto.provider';
import { ZtoProvider } from './providers/zto.provider';
import { StoProvider } from './providers/sto.provider';
import { YundaProvider } from './providers/yunda.provider';
import { JdProvider } from './providers/jd.provider';
import { EmsProvider } from './providers/ems.provider';
```

新增导入：
```typescript
import { Kuaidi100WaybillService } from '../../shipment/kuaidi100-waybill.service';
import { Kuaidi100Service } from '../../shipment/kuaidi100.service';
```

- [ ] **Step 2: 替换构造函数**

将构造函数中的 7 个 Provider 注入替换为 `Kuaidi100WaybillService`。移除 `providerRegistry` 和 `getProvider()`。

替换后的构造函数及类属性：

```typescript
@Injectable()
export class SellerShippingService {
  private readonly logger = new Logger(SellerShippingService.name);
  private readonly apiPrefix: string;
  private readonly hmacSecret: string;
  private static readonly WAYBILL_LOCK_NAMESPACE = 'seller-waybill-order';

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private sellerRiskControl: SellerRiskControlService,
    private kuaidi100Waybill: Kuaidi100WaybillService,
  ) {
    this.apiPrefix = this.configService.get<string>('API_PREFIX', '/api/v1');
    this.hmacSecret = this.configService.getOrThrow<string>('SELLER_JWT_SECRET');
  }
```

- [ ] **Step 3: 替换 createCarrierWaybill()**

将 `createCarrierWaybill()` 方法替换为：

```typescript
  async createCarrierWaybill(
    companyId: string,
    carrierCode: string,
    addressSnapshot: unknown,
    items: Array<{ name: string; quantity: number; weight?: number }>,
  ) {
    const senderInfo = await this.getSenderInfo(companyId);
    const recipientInfo = this.parseAddressSnapshot(addressSnapshot);
    const cargo = items.map((i) => i.name).join(', ');
    const totalWeight = items.reduce((sum, i) => sum + (i.weight || 0), 0);

    const waybillResult = await this.kuaidi100Waybill.createWaybill({
      carrierCode,
      senderName: senderInfo.senderName,
      senderPhone: senderInfo.senderPhone,
      senderAddress: senderInfo.senderAddress,
      recipientName: recipientInfo.name,
      recipientPhone: recipientInfo.phone,
      recipientAddress: recipientInfo.address,
      cargo,
      weight: totalWeight > 0 ? totalWeight : undefined,
      count: 1,
    });

    const carrierName =
      Kuaidi100Service.CARRIER_NAME_MAP[carrierCode.toUpperCase()] || carrierCode;

    return {
      carrierCode: carrierCode.toUpperCase(),
      carrierName,
      waybillNo: waybillResult.waybillNo,
      waybillUrl: waybillResult.waybillImageUrl,
      taskId: waybillResult.taskId,
      senderInfoSnapshot: senderInfo,
      receiverInfoSnapshot: recipientInfo,
    };
  }
```

- [ ] **Step 4: 替换 cancelCarrierWaybill()**

将 `cancelCarrierWaybill()` 方法替换为：

```typescript
  async cancelCarrierWaybill(taskId: string) {
    if (!taskId) {
      this.logger.warn('取消面单跳过: 缺少 kuaidi100TaskId');
      return;
    }
    try {
      await this.kuaidi100Waybill.cancelWaybill(taskId);
    } catch (err: any) {
      this.logger.warn(`取消面单调用快递100失败（不阻塞本地清除）: ${err.message}`);
    }
  }
```

- [ ] **Step 5: 更新 generateWaybill() 中存储 taskId**

在 `generateWaybill()` 方法中，`createCarrierWaybill` 返回结果现在包含 `taskId`。更新 Shipment 创建/更新逻辑以存储它。

在 `existingShipment` 的 `updateMany` data 中添加 `kuaidi100TaskId`：
```typescript
          if (existingShipment) {
            const cas = await tx.shipment.updateMany({
              where: {
                id: existingShipment.id,
                waybillNo: null,
              },
              data: {
                waybillNo: waybillResult.waybillNo,
                waybillUrl: waybillResult.waybillUrl,
                carrierCode: waybillResult.carrierCode,
                carrierName: waybillResult.carrierName,
                kuaidi100TaskId: waybillResult.taskId,
              },
            });
```

在 `shipment.create` data 中添加 `kuaidi100TaskId`：
```typescript
          } else {
            await tx.shipment.create({
              data: {
                orderId,
                companyId,
                carrierCode: waybillResult.carrierCode,
                carrierName: waybillResult.carrierName,
                waybillNo: waybillResult.waybillNo,
                waybillUrl: waybillResult.waybillUrl,
                kuaidi100TaskId: waybillResult.taskId,
                status: 'INIT',
                senderInfoSnapshot: waybillResult.senderInfoSnapshot as Prisma.InputJsonValue,
                receiverInfoSnapshot: waybillResult.receiverInfoSnapshot as Prisma.InputJsonValue,
              },
            });
          }
```

- [ ] **Step 6: 更新 cancelWaybill() 使用 taskId**

在 `cancelWaybill()` 方法中（约第 470 行），事务内从 shipment 读取 `kuaidi100TaskId`，事务后用它取消：

将事务返回值改为包含 `kuaidi100TaskId`：
```typescript
      return {
        carrierCode: shipment.carrierCode,
        waybillNo: shipment.waybillNo,
        kuaidi100TaskId: shipment.kuaidi100TaskId,
      };
```

事务内 CAS 更新添加清除 `kuaidi100TaskId`：
```typescript
        data: {
          waybillNo: null,
          waybillUrl: null,
          trackingNo: null,
          kuaidi100TaskId: null,
        },
```

事务后调用取消改为：
```typescript
    await this.cancelCarrierWaybill(cancellation.kuaidi100TaskId ?? '');
```

- [ ] **Step 7: 更新 rollbackCreatedWaybill()**

将 `rollbackCreatedWaybill` 参数和实现改为使用 taskId：

```typescript
  private async rollbackCreatedWaybill(
    waybill: { carrierCode: string; waybillNo: string; taskId?: string } | null,
  ) {
    if (!waybill) return;
    await this.cancelCarrierWaybill(waybill.taskId ?? '');
  }
```

更新 `generateWaybill()` 中设置 `createdWaybill` 的位置，添加 `taskId`：
```typescript
        createdWaybill = {
          carrierCode: waybillResult.carrierCode,
          waybillNo: waybillResult.waybillNo,
          taskId: waybillResult.taskId,
        };
```

同时更新 `createdWaybill` 的类型声明：
```typescript
    let createdWaybill: { carrierCode: string; waybillNo: string; taskId?: string } | null = null;
```

- [ ] **Step 8: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无与 seller-shipping.service.ts 相关的错误

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/seller/shipping/seller-shipping.service.ts
git commit -m "refactor(seller-shipping): replace 7 carrier providers with Kuaidi100WaybillService"
```

---

### Task 5: 更新模块注册和删除占位 Provider 文件

**Files:**
- Modify: `backend/src/modules/seller/shipping/seller-shipping.module.ts`
- Modify: `backend/src/modules/shipment/shipment.module.ts`
- Delete: `backend/src/modules/seller/shipping/providers/sf.provider.ts`
- Delete: `backend/src/modules/seller/shipping/providers/yto.provider.ts`
- Delete: `backend/src/modules/seller/shipping/providers/zto.provider.ts`
- Delete: `backend/src/modules/seller/shipping/providers/sto.provider.ts`
- Delete: `backend/src/modules/seller/shipping/providers/yunda.provider.ts`
- Delete: `backend/src/modules/seller/shipping/providers/jd.provider.ts`
- Delete: `backend/src/modules/seller/shipping/providers/ems.provider.ts`
- Delete: `backend/src/modules/seller/shipping/shipping-provider.interface.ts`

- [ ] **Step 1: 更新 ShipmentModule 导出**

修改 `backend/src/modules/shipment/shipment.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { ShipmentController } from './shipment.controller';
import { ShipmentService } from './shipment.service';
import { Kuaidi100Service } from './kuaidi100.service';
import { Kuaidi100WaybillService } from './kuaidi100-waybill.service';
import { WebhookIpGuard } from '../../common/guards/webhook-ip.guard';

@Module({
  controllers: [ShipmentController],
  providers: [ShipmentService, Kuaidi100Service, Kuaidi100WaybillService, WebhookIpGuard],
  exports: [Kuaidi100Service, Kuaidi100WaybillService],
})
export class ShipmentModule {}
```

- [ ] **Step 2: 更新 SellerShippingModule**

修改 `backend/src/modules/seller/shipping/seller-shipping.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { SellerShippingController } from './seller-shipping.controller';
import { SellerShippingService } from './seller-shipping.service';
import { SellerRiskControlModule } from '../risk-control/seller-risk-control.module';
import { ShipmentModule } from '../../shipment/shipment.module';

@Module({
  imports: [SellerRiskControlModule, ShipmentModule],
  controllers: [SellerShippingController],
  providers: [SellerShippingService],
  exports: [SellerShippingService],
})
export class SellerShippingModule {}
```

- [ ] **Step 3: 删除占位 Provider 文件和接口定义**

```bash
rm backend/src/modules/seller/shipping/providers/sf.provider.ts
rm backend/src/modules/seller/shipping/providers/yto.provider.ts
rm backend/src/modules/seller/shipping/providers/zto.provider.ts
rm backend/src/modules/seller/shipping/providers/sto.provider.ts
rm backend/src/modules/seller/shipping/providers/yunda.provider.ts
rm backend/src/modules/seller/shipping/providers/jd.provider.ts
rm backend/src/modules/seller/shipping/providers/ems.provider.ts
rm backend/src/modules/seller/shipping/shipping-provider.interface.ts
rmdir backend/src/modules/seller/shipping/providers
```

- [ ] **Step 4: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无错误

- [ ] **Step 5: 运行全部 shipment 相关测试**

Run: `cd backend && npx jest --testPathPattern="shipment|seller-shipping" --no-coverage`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add -A backend/src/modules/seller/shipping/ backend/src/modules/shipment/shipment.module.ts
git commit -m "refactor(shipping): remove 7 placeholder providers, wire Kuaidi100WaybillService via ShipmentModule"
```

---

### Task 6: 更新环境变量配置

**Files:**
- Modify: `backend/.env.example`

- [ ] **Step 1: 添加电子面单环境变量**

在 `backend/.env.example` 中，找到现有的快递100配置段（约第 33-35 行）：

```env
# 快递100（物流查询）
KUAIDI100_CUSTOMER="your-kuaidi100-customer-id"
KUAIDI100_KEY="your-kuaidi100-key"
```

替换为完整配置：

```env
# 快递100（物流查询 + 电子面单）
KUAIDI100_CUSTOMER="your-kuaidi100-customer-id"
KUAIDI100_KEY="your-kuaidi100-key"
KUAIDI100_SECRET="your-kuaidi100-secret"
KUAIDI100_PARTNER_ID="your-platform-partner-id"
KUAIDI100_PARTNER_KEY=""
KUAIDI100_CALLBACK_URL="https://api.爱买买.com/api/v1/shipments/kuaidi100/callback"
KUAIDI100_CALLBACK_TOKEN="your-callback-token"
```

- [ ] **Step 2: Commit**

```bash
git add backend/.env.example
git commit -m "chore: add kuaidi100 electronic waybill env vars to .env.example"
```

---

### Task 7: Prisma validate + 全量编译验证

**Files:** 无新变更，纯验证

- [ ] **Step 1: Prisma validate**

Run: `cd backend && npx prisma validate`
Expected: 无错误

- [ ] **Step 2: TypeScript 全量编译**

Run: `cd backend && npx tsc --noEmit --pretty`
Expected: 无错误

- [ ] **Step 3: 运行全部测试**

Run: `cd backend && npx jest --no-coverage 2>&1 | tail -20`
Expected: 全部 PASS（或仅有与本次改动无关的既有失败）

- [ ] **Step 4: 确认无残留引用**

Run: `cd backend && grep -r "ShippingProvider\|SfProvider\|YtoProvider\|ZtoProvider\|StoProvider\|YundaProvider\|JdProvider\|EmsProvider\|shipping-provider.interface" src/ --include="*.ts" | grep -v node_modules | grep -v ".spec.ts"`
Expected: 无匹配结果（所有对旧 Provider 的引用已清除）
