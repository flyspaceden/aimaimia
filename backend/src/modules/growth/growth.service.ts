import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthLevelService } from './growth-level.service';

@Injectable()
export class GrowthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly levelService: GrowthLevelService = new GrowthLevelService(),
  ) {}

  async getMe(userId: string) {
    const [account, levels] = await Promise.all([
      this.prisma.growthAccount.findUnique({
        where: { userId },
      }),
      this.prisma.growthLevel.findMany({
        where: { enabled: true },
        orderBy: { threshold: 'asc' },
      }),
    ]);

    const pointsBalance = account?.pointsBalance ?? 0;
    const pointsTotalEarned = account?.pointsTotalEarned ?? 0;
    const pointsTotalSpent = account?.pointsTotalSpent ?? 0;
    const growthValue = account?.growthValue ?? 0;
    const levelState = this.levelService.resolveLevel(growthValue, levels);

    return {
      pointsBalance,
      pointsTotalEarned,
      pointsTotalSpent,
      growthValue,
      ...levelState,
      updatedAt: account?.updatedAt ?? null,
    };
  }
}
