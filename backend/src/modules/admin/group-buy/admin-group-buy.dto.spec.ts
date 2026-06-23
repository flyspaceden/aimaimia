import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { GroupBuyTierConfigDto } from './admin-group-buy.dto';

describe('GroupBuyTierConfigDto', () => {
  it('allows a single return tier above 100 percent', async () => {
    const dto = plainToInstance(GroupBuyTierConfigDto, {
      sequence: 1,
      basisPoints: 12000,
      label: '第一位好友',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });
});
