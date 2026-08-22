import { NotFoundException } from '@nestjs/common';

jest.mock('./asr.service', () => ({
  AsrService: class AsrService {},
}));

import { AiService } from './ai.service';

describe('AiService trace product visibility', () => {
  it('only resolves a buyer-visible product name', async () => {
    const prisma = {
      product: { findFirst: jest.fn().mockResolvedValue({ title: '有机苹果' }) },
    };
    const service = new AiService(prisma as any, {} as any, {} as any, {} as any);

    await expect(service.getTraceOverview('product-1')).resolves.toMatchObject({
      productId: 'product-1',
      productName: '有机苹果',
    });
    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'product-1',
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        company: { status: 'ACTIVE', isPlatform: false },
      },
      select: { title: true },
    });
  });

  it('does not substitute placeholder data for a hidden product id', async () => {
    const prisma = { product: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new AiService(prisma as any, {} as any, {} as any, {} as any);

    await expect(service.getTraceOverview('product-hidden')).rejects.toBeInstanceOf(NotFoundException);
  });
});
