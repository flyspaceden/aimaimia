import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreateProductDto,
  CreateSkuDto,
  CreateDraftDto,
  UpdateDraftDto,
  DraftSkuDto,
  SkuItemDto,
} from './seller-products.dto';

/**
 * CreateSkuDto.maxPerOrder 字段的 class-validator 校验测试
 *
 * maxPerOrder 规则（来自 seller-products.dto.ts）：
 *   @IsOptional()
 *   @IsInt()
 *   @Min(1)
 *   maxPerOrder?: number;
 *
 * 合法值：正整数（≥1）或 undefined（不传）
 * 非法值：0、负数、小数
 */

// 构造最小合法基础字段（排除 maxPerOrder 干扰）
function basePayload(extra: Record<string, unknown> = {}) {
  return {
    specName: '5斤装',
    cost: 10,
    stock: 100,
    weightGram: 1000,
    ...extra,
  };
}

function baseCreateProductPayload(extra: Record<string, unknown> = {}) {
  return {
    title: '烟台苹果礼盒',
    description: '这是一段足够长的商品描述，用于通过正式商品校验。',
    categoryId: 'category_1',
    origin: { text: '山东烟台' },
    skus: [basePayload()],
    ...extra,
  };
}

describe('正式 SKU weightGram 字段校验', () => {
  it('CreateSkuDto 缺少 weightGram → 应有校验错误', async () => {
    const { weightGram: _weightGram, ...payload } = basePayload();
    const dto = plainToInstance(CreateSkuDto, payload);
    const errors = await validate(dto);
    const weightErrors = errors.filter((e) => e.property === 'weightGram');
    expect(weightErrors.length).toBeGreaterThan(0);
  });

  it('CreateSkuDto weightGram=0 → 应有校验错误', async () => {
    const dto = plainToInstance(CreateSkuDto, basePayload({ weightGram: 0 }));
    const errors = await validate(dto);
    const weightErrors = errors.filter((e) => e.property === 'weightGram');
    expect(weightErrors.length).toBeGreaterThan(0);
  });

  it('SkuItemDto 缺少 weightGram → DTO 校验通过（由服务层按商品类型决定是否必填）', async () => {
    const { weightGram: _weightGram, ...payload } = basePayload();
    const dto = plainToInstance(SkuItemDto, payload);
    const errors = await validate(dto);
    const weightErrors = errors.filter((e) => e.property === 'weightGram');
    expect(weightErrors).toHaveLength(0);
  });

  it('SkuItemDto weightGram=1.5 → 应有校验错误', async () => {
    const dto = plainToInstance(SkuItemDto, basePayload({ weightGram: 1.5 }));
    const errors = await validate(dto);
    const weightErrors = errors.filter((e) => e.property === 'weightGram');
    expect(weightErrors.length).toBeGreaterThan(0);
  });
});

describe('CreateSkuDto — maxPerOrder 字段校验', () => {
  it('合法正整数 maxPerOrder=5 → 无校验错误', async () => {
    const dto = plainToInstance(CreateSkuDto, basePayload({ maxPerOrder: 5 }));
    const errors = await validate(dto);
    const maxPerOrderErrors = errors.filter((e) => e.property === 'maxPerOrder');
    expect(maxPerOrderErrors).toHaveLength(0);
  });

  it('合法正整数 maxPerOrder=1（最小值边界）→ 无校验错误', async () => {
    const dto = plainToInstance(CreateSkuDto, basePayload({ maxPerOrder: 1 }));
    const errors = await validate(dto);
    const maxPerOrderErrors = errors.filter((e) => e.property === 'maxPerOrder');
    expect(maxPerOrderErrors).toHaveLength(0);
  });

  it('合法正整数 maxPerOrder=999 → 无校验错误', async () => {
    const dto = plainToInstance(CreateSkuDto, basePayload({ maxPerOrder: 999 }));
    const errors = await validate(dto);
    const maxPerOrderErrors = errors.filter((e) => e.property === 'maxPerOrder');
    expect(maxPerOrderErrors).toHaveLength(0);
  });

  it('不传 maxPerOrder（undefined，表示不限购）→ 无校验错误', async () => {
    const dto = plainToInstance(CreateSkuDto, basePayload());
    const errors = await validate(dto);
    const maxPerOrderErrors = errors.filter((e) => e.property === 'maxPerOrder');
    expect(maxPerOrderErrors).toHaveLength(0);
  });

  it('maxPerOrder=0 → 应有校验错误（@Min(1) 规则）', async () => {
    const dto = plainToInstance(CreateSkuDto, basePayload({ maxPerOrder: 0 }));
    const errors = await validate(dto);
    const maxPerOrderErrors = errors.filter((e) => e.property === 'maxPerOrder');
    expect(maxPerOrderErrors.length).toBeGreaterThan(0);
  });

  it('maxPerOrder=-1 → 应有校验错误（负数不满足 @Min(1)）', async () => {
    const dto = plainToInstance(CreateSkuDto, basePayload({ maxPerOrder: -1 }));
    const errors = await validate(dto);
    const maxPerOrderErrors = errors.filter((e) => e.property === 'maxPerOrder');
    expect(maxPerOrderErrors.length).toBeGreaterThan(0);
  });

  it('maxPerOrder=1.5（非整数）→ 应有校验错误（@IsInt 规则）', async () => {
    const dto = plainToInstance(CreateSkuDto, basePayload({ maxPerOrder: 1.5 }));
    const errors = await validate(dto);
    const maxPerOrderErrors = errors.filter((e) => e.property === 'maxPerOrder');
    expect(maxPerOrderErrors.length).toBeGreaterThan(0);
  });

  it('maxPerOrder="abc"（非数字字符串）→ 应有校验错误', async () => {
    const dto = plainToInstance(CreateSkuDto, basePayload({ maxPerOrder: 'abc' }));
    const errors = await validate(dto);
    const maxPerOrderErrors = errors.filter((e) => e.property === 'maxPerOrder');
    expect(maxPerOrderErrors.length).toBeGreaterThan(0);
  });

  it('maxPerOrder=-100 → 应有校验错误', async () => {
    const dto = plainToInstance(CreateSkuDto, basePayload({ maxPerOrder: -100 }));
    const errors = await validate(dto);
    const maxPerOrderErrors = errors.filter((e) => e.property === 'maxPerOrder');
    expect(maxPerOrderErrors.length).toBeGreaterThan(0);
  });
});

describe('CreateDraftDto — 草稿创建校验', () => {
  it('仅标题 → 校验通过（其他字段允许为空）', async () => {
    const dto = plainToInstance(CreateDraftDto, { title: '测试草稿商品' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('允许保存计量单位 unit（匹配全局白名单校验）', async () => {
    const dto = plainToInstance(CreateDraftDto, { title: '测试草稿商品', unit: '斤' });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
  });

  it('标题为空字符串 → 校验失败（@IsNotEmpty）', async () => {
    const dto = plainToInstance(CreateDraftDto, { title: '' });
    const errors = await validate(dto);
    const titleErrors = errors.filter((e) => e.property === 'title');
    expect(titleErrors.length).toBeGreaterThan(0);
  });

  it('缺失标题 → 校验失败', async () => {
    const dto = plainToInstance(CreateDraftDto, { subtitle: '副标题' });
    const errors = await validate(dto);
    const titleErrors = errors.filter((e) => e.property === 'title');
    expect(titleErrors.length).toBeGreaterThan(0);
  });

  it('标题超过 100 字符 → 校验失败', async () => {
    const dto = plainToInstance(CreateDraftDto, { title: 'a'.repeat(101) });
    const errors = await validate(dto);
    const titleErrors = errors.filter((e) => e.property === 'title');
    expect(titleErrors.length).toBeGreaterThan(0);
  });

  it('标题 + 部分字段（含不完整 SKU） → 校验通过', async () => {
    const dto = plainToInstance(CreateDraftDto, {
      title: '测试商品',
      description: '一段简单描述',
      skus: [{ specName: '规格A' }, { cost: 10 }], // 第二个 SKU 只有 cost 没 specName
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('SKU cost < 0.01 → 草稿仍拒绝（防脏数据写库）', async () => {
    const dto = plainToInstance(CreateDraftDto, {
      title: '测试商品',
      skus: [{ specName: '规格', cost: 0 }],
    });
    const errors = await validate(dto);
    // CreateDraftDto 嵌套 DraftSkuDto 仍保留 @Min(0.01)
    expect(errors.length).toBeGreaterThan(0);
  });

  it('allow 空 skus 数组 → 草稿通过', async () => {
    const dto = plainToInstance(CreateDraftDto, { title: 'X', skus: [] });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

describe('CreateProductDto — bundle 字段校验', () => {
  it('BUNDLE create 缺少 bundleItems → 校验失败', async () => {
    const dto = plainToInstance(CreateProductDto, baseCreateProductPayload({
      productType: 'BUNDLE',
    }));
    const errors = await validate(dto);
    const bundleErrors = errors.filter((e) => e.property === 'bundleItems');
    expect(bundleErrors.length).toBeGreaterThan(0);
  });

  it('bundle item quantity <= 0 → 校验失败', async () => {
    const dto = plainToInstance(CreateProductDto, baseCreateProductPayload({
      productType: 'BUNDLE',
      bundleItems: [{ skuId: 'sku_1', quantity: 0 }],
    }));
    const errors = await validate(dto);
    const bundleErrors = errors.find((e) => e.property === 'bundleItems');
    expect(bundleErrors?.children?.length ?? 0).toBeGreaterThan(0);
  });

  it('SIMPLE create 不传 bundleItems → 校验通过', async () => {
    const dto = plainToInstance(CreateProductDto, baseCreateProductPayload({
      productType: 'SIMPLE',
    }));
    const errors = await validate(dto);
    const bundleErrors = errors.filter((e) => e.property === 'bundleItems');
    expect(bundleErrors).toHaveLength(0);
  });
});

describe('UpdateDraftDto — 草稿更新校验', () => {
  it('全空对象 → 校验通过（所有字段可选）', async () => {
    const dto = plainToInstance(UpdateDraftDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('允许更新计量单位 unit（匹配全局白名单校验）', async () => {
    const dto = plainToInstance(UpdateDraftDto, { unit: '盒' });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
  });

  it('只更新 title → 通过', async () => {
    const dto = plainToInstance(UpdateDraftDto, { title: '新标题' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('title 传空字符串 → 拒绝（IsNotEmpty）', async () => {
    const dto = plainToInstance(UpdateDraftDto, { title: '' });
    const errors = await validate(dto);
    const titleErrors = errors.filter((e) => e.property === 'title');
    expect(titleErrors.length).toBeGreaterThan(0);
  });

  it('部分字段 + 不完整 SKU → 通过', async () => {
    const dto = plainToInstance(UpdateDraftDto, {
      description: '描述',
      skus: [{ stock: 10 }],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

describe('DraftSkuDto — 草稿 SKU 字段校验', () => {
  it('完全空的 SKU → 通过', async () => {
    const dto = plainToInstance(DraftSkuDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('cost=0 → 拒绝（@Min 0.01）', async () => {
    const dto = plainToInstance(DraftSkuDto, { cost: 0 });
    const errors = await validate(dto);
    const costErrors = errors.filter((e) => e.property === 'cost');
    expect(costErrors.length).toBeGreaterThan(0);
  });

  it('stock=-1 → 拒绝（@Min 0）', async () => {
    const dto = plainToInstance(DraftSkuDto, { stock: -1 });
    const errors = await validate(dto);
    const stockErrors = errors.filter((e) => e.property === 'stock');
    expect(stockErrors.length).toBeGreaterThan(0);
  });
});
