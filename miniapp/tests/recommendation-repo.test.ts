import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecommendationRepo } from '@/repos/recommendation';

const getMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ ApiClient: { get: getMock } }));

const recommendation = {
  id: 'rec-1',
  reason: '应季好物推荐',
  product: {
    id: 'product-1', type: 'SIMPLE', title: '蓝莓', price: 29.9, unit: '盒', origin: '丹东',
    image: 'https://example.com/blueberry.jpg', tags: ['应季'], companyId: 'company-1', companyName: '产地企业',
  },
};

describe('RecommendationRepo', () => {
  beforeEach(() => getMock.mockReset());

  it('preserves the App recommendation product and reason contract', async () => {
    getMock.mockResolvedValue({ ok: true, data: [recommendation] });
    await expect(RecommendationRepo.listForMe()).resolves.toEqual({ ok: true, data: [recommendation] });
    expect(getMock).toHaveBeenCalledWith('/recommendations/me');
  });

  it('fails closed when a recommendation cannot render as a product card', async () => {
    getMock.mockResolvedValue({ ok: true, data: [{ ...recommendation, product: { ...recommendation.product, type: undefined } }] });
    await expect(RecommendationRepo.listForMe()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONTRACT' },
    });
  });
});
