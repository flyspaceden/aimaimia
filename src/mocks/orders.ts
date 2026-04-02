import { Order } from '../types';

export const mockOrders: Order[] = [
  {
    id: 'o-001',
    status: 'pendingPay',
    totalPrice: 79.6,
    createdAt: '2024-12-02 11:20',
    paymentMethod: 'wechat',
    items: [
      {
        id: 'oi-001',
        productId: 'p-001',
        title: '高山有机小番茄',
        image: 'https://placehold.co/600x600/png',
        price: 19.8,
        quantity: 2,
      },
      {
        id: 'oi-002',
        productId: 'p-002',
        title: '山泉水培生菜',
        image: 'https://placehold.co/600x600/png',
        price: 12.5,
        quantity: 2,
      },
    ],
  },
  {
    id: 'o-002',
    status: 'pendingShip',
    totalPrice: 128,
    createdAt: '2024-11-25 09:40',
    items: [
      {
        id: 'oi-003',
        productId: 'p-005',
        title: '有机绿茶礼盒',
        image: 'https://placehold.co/600x600/png',
        price: 128,
        quantity: 1,
      },
    ],
  },
  {
    id: 'o-003',
    status: 'shipping',
    totalPrice: 56.8,
    createdAt: '2024-11-28 15:10',
    logisticsStatus: '广州转运中心 → 上海分拨',
    tracePreview: '预计 12-06 送达',
    items: [
      {
        id: 'oi-004',
        productId: 'p-004',
        title: '有机蓝莓一箱',
        image: 'https://placehold.co/600x600/png',
        price: 56.8,
        quantity: 1,
      },
    ],
  },
  {
    id: 'o-004',
    status: 'afterSale',
    issueFlag: true,
    afterSaleStatus: 'reviewing',
    afterSaleReason: '商品破损',
    afterSaleNote: '收到后包装有明显破损，鸡蛋有裂痕',
    afterSaleTimeline: [
      { status: 'applying', title: '提交申请', time: '2024-11-20 10:00' },
      { status: 'reviewing', title: '平台审核', time: '2024-11-21 09:30' },
    ],
    totalPrice: 36,
    createdAt: '2024-11-20 09:20',
    items: [
      {
        id: 'oi-005',
        productId: 'p-003',
        title: '农场鸡蛋 30 枚',
        image: 'https://placehold.co/600x600/png',
        price: 36,
        quantity: 1,
      },
    ],
  },
];
