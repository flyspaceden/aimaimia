import { AdminOrdersService } from './admin-orders.service';

describe('AdminOrdersService order detail bundle snapshot mapping', () => {
  let prisma: any;
  let service: AdminOrdersService;

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: jest.fn(),
      },
    };
    service = new AdminOrdersService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('returns productType and bundleItems from order item productSnapshot with defaults', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      totalAmount: 108,
      discountAmount: 0,
      addressSnapshot: {
        recipientName: '张三',
        phone: '13800138000',
        province: '浙江省',
        city: '杭州市',
        district: '西湖区',
        detail: '文一路 1 号',
      },
      user: {
        id: 'buyer-1',
        buyerNo: 'AIMM00000000000001',
        profile: { nickname: '买家A', avatarUrl: null },
        authIdentities: [{ identifier: '13800138000' }],
      },
      items: [
        {
          id: 'item-bundle',
          productSnapshot: {
            title: '精品水果礼盒',
            image: 'http://localhost/bundle.jpg',
            productType: 'BUNDLE',
            bundleItems: [
              { productId: 'p1', productTitle: '苹果', skuId: 'sku-1', skuName: '红富士', quantity: 2 },
              { productId: 'p2', productTitle: '梨', skuId: 'sku-2', skuName: '皇冠梨', quantity: 1 },
            ],
          },
          sku: {
            title: '默认规格',
            product: {
              id: 'product-bundle',
              company: { id: 'company-1', name: '商家A' },
              media: [{ url: 'http://localhost/live-bundle.jpg' }],
            },
          },
        },
        {
          id: 'item-simple',
          productSnapshot: null,
          sku: {
            title: '单品规格',
            product: {
              id: 'product-simple',
              company: { id: 'company-1', name: '商家A' },
              title: '香蕉',
              media: [{ url: 'http://localhost/banana.jpg' }],
            },
          },
        },
      ],
      checkoutSession: { paymentChannel: 'ALIPAY', providerTxnId: 'txn-1' },
      statusHistory: [],
      payments: [],
      refunds: [],
      shipments: [],
    });

    const out = await service.findById('order-1');

    expect(out.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'item-bundle',
          productType: 'BUNDLE',
          bundleItems: [
            { productId: 'p1', productTitle: '苹果', skuId: 'sku-1', skuName: '红富士', quantity: 2 },
            { productId: 'p2', productTitle: '梨', skuId: 'sku-2', skuName: '皇冠梨', quantity: 1 },
          ],
        }),
        expect.objectContaining({
          id: 'item-simple',
          productType: 'SIMPLE',
          bundleItems: [],
        }),
      ]),
    );
  });
});
