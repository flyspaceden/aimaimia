import { BadRequestException } from '@nestjs/common';
import { GroupBuyService } from './group-buy.service';

describe('GroupBuyService', () => {
  describe('assertTierBasisPointsTotal', () => {
    it('accepts tiers whose basis points total exactly 10000', () => {
      expect(() => GroupBuyService.assertTierBasisPointsTotal([1000, 2000, 7000])).not.toThrow();
    });

    it('rejects tiers whose basis points total is not exactly 10000', () => {
      expect(() => GroupBuyService.assertTierBasisPointsTotal([1000, 2000, 8000])).toThrow(
        BadRequestException,
      );
    });
  });
});
