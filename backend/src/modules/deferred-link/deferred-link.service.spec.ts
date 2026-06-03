import { BadRequestException } from '@nestjs/common';
import { DeferredLinkService } from './deferred-link.service';

describe('DeferredLinkService.create — 推荐码有效性', () => {
  it('拒绝普通用户的 referralCode，只有 VIP 码才能生成延迟深链', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'normal-user',
          referralCode: 'NORMAL01',
          tier: 'NORMAL',
        }),
      },
      deferredDeepLink: {
        create: jest.fn(),
      },
    };
    const service = new DeferredLinkService(prismaMock);

    await expect(
      service.create(
        {
          referralCode: 'NORMAL01',
          userAgent: 'Mozilla/5.0 iPhone',
          screenWidth: 390,
          screenHeight: 844,
          language: 'zh-CN',
        },
        '127.0.0.1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaMock.deferredDeepLink.create).not.toHaveBeenCalled();
  });
});
