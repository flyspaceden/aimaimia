import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateRewardProductSkuForUpdateDto,
  RewardProductSkuDto,
  UpdateRewardProductSkuDto,
} from './reward-product.dto';

describe('Reward product SKU weight DTO validation', () => {
  it('requires weightGram when creating reward product SKUs', async () => {
    const dto = plainToInstance(RewardProductSkuDto, {
      title: '默认 SKU',
      price: 20,
      cost: 10,
      stock: 5,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'weightGram')).toBe(true);
  });

  it('requires weightGram when adding reward product SKUs', async () => {
    const dto = plainToInstance(CreateRewardProductSkuForUpdateDto, {
      title: '新增 SKU',
      price: 20,
      cost: 10,
      stock: 5,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'weightGram')).toBe(true);
  });

  it('rejects non-positive reward SKU weight when provided for partial updates', async () => {
    const dto = plainToInstance(UpdateRewardProductSkuDto, {
      weightGram: 0,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'weightGram')).toBe(true);
  });

  it('allows partial reward SKU updates without weightGram', async () => {
    const dto = plainToInstance(UpdateRewardProductSkuDto, {
      stock: 8,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'weightGram')).toBe(false);
  });
});
