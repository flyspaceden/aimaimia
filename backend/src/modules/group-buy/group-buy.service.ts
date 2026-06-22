import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class GroupBuyService {
  static assertTierBasisPointsTotal(basisPoints: number[]): void {
    const total = basisPoints.reduce((sum, value) => sum + value, 0);
    if (total !== 10000) {
      throw new BadRequestException('团购返还档位总和必须等于100%');
    }
  }
}
