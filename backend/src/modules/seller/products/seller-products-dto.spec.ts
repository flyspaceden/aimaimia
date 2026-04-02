import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateSkuDto } from './seller-products.dto';

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
    ...extra,
  };
}

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
