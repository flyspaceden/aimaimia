# VIP 多档位礼包设计方案

## 1. 需求概述

将 VIP 礼包从单一价格（399）扩展为多个价格档位（399 / 899 / 1599），每个档位：
- 有独立的价格
- 有独立的推荐奖励比例（推荐人收益 = 档位价格 × 比例）
- 下挂多个赠品方案供买家选择

所有档位购买后的 VIP 身份和权益完全一致（95折、分润、包邮等），区别仅在于入会赠品和推荐人获得的奖励。

**不在范围内：**
- 档位升级/降级
- 不同档位享受不同 VIP 权益
- 买家端显示推荐奖励金额（奖励只给推荐人）

## 2. 数据模型

### 2.1 新增 VipPackage 模型

```prisma
model VipPackage {
  id                String              @id @default(cuid())
  price             Float               // 档位价格（元），如 399 / 899 / 1599
  referralBonusRate Float               @default(0.15) // 推荐奖励比例，0.15 = 15%
  sortOrder         Int                 @default(0)
  status            VipGiftOptionStatus @default(ACTIVE) // 复用已有枚举 ACTIVE/INACTIVE
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt
  giftOptions       VipGiftOption[]     // 该档位下的赠品方案

  @@index([status, sortOrder])
}
```

### 2.2 VipGiftOption 增加外键

```prisma
model VipGiftOption {
  // ... 现有字段不变
  packageId   String
  package     VipPackage @relation(fields: [packageId], references: [id], onDelete: Restrict)

  @@index([packageId, status, sortOrder])  // 新增复合索引
}
```

`onDelete: Restrict` — 删除档位前必须先移除或转移其下所有赠品方案。

### 2.3 VipPurchase 增加快照字段

```prisma
model VipPurchase {
  // ... 现有字段不变
  packageId         String?      // 购买的档位 ID
  referralBonusRate Float?       // 快照：购买时的推荐奖励比例
}
```

- `amount` 已有字段，记录实际支付金额（不变）
- `referralBonusRate` 在购买时从 VipPackage 快照，确保后续管理员改比例不影响已完成的订单

### 2.4 删除的全局配置

从 `RuleConfig` 中移除（不再需要）：
- `VIP_PRICE` → 改为 `VipPackage.price`
- `VIP_REFERRAL_BONUS` → 改为 `VipPackage.referralBonusRate`

对应删除 `BonusConfigService` 中的 `vipPrice` 和 `vipReferralBonus` 字段，以及 `config-validation.ts` 中的验证规则。

### 2.5 数据迁移

1. 创建一个默认 VipPackage（price=399, referralBonusRate=0.15）
2. 将所有现有 VipGiftOption 的 `packageId` 设为该默认档位
3. 将所有现有 VipPurchase 的 `packageId` 设为该默认档位，`referralBonusRate` 回填为旧配置值
4. 管理员手动创建 899 和 1599 档位并配置赠品

## 3. 后端改动

### 3.1 VipPackage CRUD（管理端）

新增 Controller + Service：`admin/vip-packages`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/vip/packages` | 列表（含关联赠品数量统计） |
| POST | `/admin/vip/packages` | 创建档位 |
| PATCH | `/admin/vip/packages/:id` | 更新（price / referralBonusRate / sortOrder / status） |
| DELETE | `/admin/vip/packages/:id` | 删除（需无关联赠品） |

### 3.2 VipGiftOption 改造

- 创建/更新 DTO 增加必填字段 `packageId`
- `findAll` 支持 `packageId` 过滤参数
- 验证：创建赠品时 `packageId` 对应的 VipPackage 必须存在且 ACTIVE

### 3.3 买家端 VIP 礼包查询 API

现有 API 返回结构调整：

```
GET /bonus/vip-gift-options
```

**现有返回：**
```json
{
  "vipPrice": 399,
  "options": [...]
}
```

**改为：**
```json
{
  "packages": [
    {
      "id": "pkg-001",
      "price": 399,
      "sortOrder": 0,
      "giftOptions": [
        { "id": "vgo-001", "title": "...", "items": [...], ... },
        { "id": "vgo-002", ... }
      ]
    },
    {
      "id": "pkg-002",
      "price": 899,
      "sortOrder": 1,
      "giftOptions": [...]
    },
    {
      "id": "pkg-003",
      "price": 1599,
      "sortOrder": 2,
      "giftOptions": [...]
    }
  ]
}
```

只返回 ACTIVE 的 Package 和 ACTIVE 的 GiftOption。`referralBonusRate` 不返回给买家端（买家无需知道推荐奖励）。

### 3.4 结账流程改造 (`checkout.service.ts`)

`VipCheckoutDto` 变更：

```typescript
export class VipCheckoutDto {
  @IsString()
  packageId: string;        // 新增：选择的档位

  @IsString()
  giftOptionId: string;     // 不变：选择的赠品方案

  @IsString()
  addressId: string;

  // ... 其余字段不变
}
```

`checkoutVipPackage` 方法改造：

1. **价格来源变更**：
   ```
   旧：const vipPrice = vipConfig.vipPrice;
   新：const pkg = await prisma.vipPackage.findUnique({ where: { id: dto.packageId } });
       const vipPrice = pkg.price;
   ```

2. **增加校验**：
   - `packageId` 对应的 VipPackage 必须存在且 ACTIVE
   - `giftOptionId` 对应的 VipGiftOption 必须属于该 `packageId`

3. **bizMeta 增加字段**：
   ```typescript
   const bizMeta = {
     // ... 现有字段
     vipPackageId: pkg.id,
     referralBonusRate: pkg.referralBonusRate,  // 快照比例
   };
   ```

### 3.5 VIP 激活与推荐奖励 (`bonus.service.ts`)

`activateVipAfterPayment` 改造：

```
旧：const referralBonus = config.vipReferralBonus;  // 固定金额
新：const referralBonus = vipPurchase.amount * vipPurchase.referralBonusRate;  // 按比例计算
```

VipPurchase 创建时写入快照：
```typescript
await tx.vipPurchase.create({
  data: {
    userId,
    amount: vipPrice,
    packageId: pkg.id,
    referralBonusRate: pkg.referralBonusRate,
    giftOptionId,
    giftSnapshot,
    source: 'APP_VIP_PACKAGE',
  },
});
```

### 3.6 BonusConfigService 清理

- `VipBonusConfig` 接口：移除 `vipPrice` 和 `vipReferralBonus`
- `KEY_MAP`：移除 `VIP_PRICE` 和 `VIP_REFERRAL_BONUS`
- `DEFAULTS`：移除对应默认值
- `getVipConfig()` 返回值：移除这两个字段
- `config-validation.ts`：移除 `VIP_PRICE` 和 `VIP_REFERRAL_BONUS` 的验证规则

## 4. 管理后台改动

### 4.1 VIP 系统配置页 (`vip-config.tsx`)

从 `CONFIG_SCHEMA` 中删除：
- `VIP_PRICE`（VIP 礼包价格）
- `VIP_REFERRAL_BONUS`（推荐奖励金额）

更新 `GROUP_DESCRIPTIONS.vip` 文案，移除价格和推荐奖励相关描述。

其余配置（六分比例、最多层数、分叉数、冻结天数、奖励有效期）保持不变。

### 4.2 购买VIP赠品页 (`vip-gifts/index.tsx`)

**a) 顶部新增「VIP 档位管理」区域**

在赠品方案列表上方增加一个 Card，展示所有 VipPackage：

```
┌─────────────────────────────────────────────────┐
│  VIP 档位管理                        [+ 新增档位] │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  ¥399    │  │  ¥899    │  │  ¥1599   │       │
│  │ 奖励 15% │  │ 奖励 15% │  │ 奖励 15% │       │
│  │ 3个赠品  │  │ 2个赠品  │  │ 2个赠品  │       │
│  │ [编辑]   │  │ [编辑]   │  │ [编辑]   │       │
│  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────┘
```

编辑弹窗字段：
- 价格（InputNumber，单位：元）
- 推荐奖励比例（InputNumber，单位：%，如输入 15 存储 0.15）
- 状态（上架/下架）

**b) 赠品列表改造**

- 增加档位筛选 Tab 或下拉（显示所有 / ¥399 / ¥899 / ¥1599）
- ProTable 增加「所属档位」列，显示价格标签
- 新建/编辑赠品方案 Drawer 增加「所属档位」下拉选择（必填）
- 移除旧的「当前 VIP 统一价格 ¥399」提示

**c) API 层新增**

`admin/src/api/vip-gifts.ts` 新增：
```typescript
// VipPackage 类型定义
export interface VipPackage {
  id: string;
  price: number;
  referralBonusRate: number;
  sortOrder: number;
  status: VipGiftOptionStatus;
  _count?: { giftOptions: number };
}

// CRUD
export const getVipPackages = (): Promise<VipPackage[]> => ...
export const createVipPackage = (data): Promise<VipPackage> => ...
export const updateVipPackage = (id, data): Promise<VipPackage> => ...
export const deleteVipPackage = (id): Promise<void> => ...
```

`VipGiftOption` 接口增加 `packageId` 字段。
`CreateVipGiftOptionInput` / `UpdateVipGiftOptionInput` 增加 `packageId` 字段。

## 5. 买家 App 改动

### 5.1 数据层

`BonusRepo.getVipGiftOptions()` 返回类型调整为包含 `packages` 数组。

`VipGiftOption` 类型增加 `packageId`。

新增类型：
```typescript
export interface VipPackage {
  id: string;
  price: number;
  sortOrder: number;
  giftOptions: VipGiftOption[];
}
```

### 5.2 购买页 UI (`app/vip/gifts.tsx`)

**整体布局（从上到下）：**

1. 标题区（不变）
2. **价格档位 Tab**（新增）— 3 个横排卡片，显示 ¥399 / ¥899 / ¥1599
3. 推荐人提示条（不变）
4. 赠品卡片轮播（不变，数据按选中档位过滤）
5. VIP 权益横排（不变）
6. 底部固定栏 — 价格跟随选中档位变化

**状态管理：**
```
新增状态：selectedPackageIndex（当前选中的档位索引，默认 0）
```

切换档位时：
- 重置 `selectedIndex`（赠品选择清空）
- 轮播列表替换为新档位下的赠品
- 底部价格更新

**结账 store 更新：**
```typescript
setVipPackageSelection({
  packageId: selectedPackage.id,      // 新增
  giftOptionId: selected.id,
  price: selectedPackage.price,       // 改为从 package 取
  // ... 其余不变
});
```

**Mockup 参考：** `docs/mockup-vip-packages.html`

## 6. 影响范围总结

| 模块 | 文件 | 改动类型 |
|------|------|----------|
| Schema | `prisma/schema.prisma` | 新增 VipPackage 模型，VipGiftOption 加 packageId，VipPurchase 加 packageId + referralBonusRate |
| Migration | `prisma/migrations/` | 新增迁移 + 数据回填 |
| Seed | `prisma/seed.ts` | 新增 3 个 VipPackage 种子数据，现有赠品关联到 ¥399 档位 |
| 后端-管理端 | `admin/vip-packages/` | 新增 VipPackage CRUD（Controller + Service + DTO + Module） |
| 后端-管理端 | `admin/vip-gift/` | GiftOption CRUD 增加 packageId 字段 |
| 后端-买家端 | `bonus.controller.ts` | 礼包查询 API 返回结构调整 |
| 后端-买家端 | `bonus.service.ts` | 推荐奖励计算从固定金额改为按比例 |
| 后端-结账 | `checkout.service.ts` | 价格从 VipPackage 读取，DTO 增加 packageId |
| 后端-配置 | `bonus-config.service.ts` | 移除 vipPrice / vipReferralBonus |
| 后端-配置 | `config-validation.ts` | 移除 VIP_PRICE / VIP_REFERRAL_BONUS 验证规则 |
| 管理前端 | `vip-config.tsx` | 删除价格和推荐奖励两个配置字段 |
| 管理前端 | `vip-gifts/index.tsx` | 增加档位管理区域，赠品列表按档位筛选 |
| 管理前端 | `api/vip-gifts.ts` | 新增 VipPackage API 调用 + 类型定义 |
| 买家 App | `types/domain/Bonus.ts` | 新增 VipPackage 类型 |
| 买家 App | `repos/BonusRepo.ts` | 返回类型调整 |
| 买家 App | `app/vip/gifts.tsx` | 增加档位选择 Tab，价格动态跟随 |
| 买家 App | `store/useCheckoutStore.ts` | 增加 packageId 字段 |
