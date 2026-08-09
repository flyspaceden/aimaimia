export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/products/index',
    'pages/me/index',
  ],
  subPackages: [
    {
      root: 'packages/commerce',
      pages: [
        'catalog-search/index',
        'company-search/index',
        'catalog-product/index',
        'catalog-company/index',
        'cart/index',
        'checkout/index',
        'checkout-address/index',
        'checkout-coupon/index',
        'checkout-pending/index',
      ],
    },
    {
      root: 'packages/orders',
      pages: [
        'order-list/index',
        'order-detail/index',
        'order-track/index',
        'receiver-info/index',
        'payment-success/index',
      ],
    },
    {
      root: 'packages/account',
      pages: [
        'account-login/index',
        'account-profile/index',
        'account-bind-phone/index',
        'account-appearance/index',
        'account-addresses/index',
        'account-address-form/index',
        'account-forgot-password/index',
        'account-legal/index',
        'account-deletion/index',
        'account-security/index',
      ],
    },
    {
      root: 'packages/member',
      pages: [
        'wallet/index',
        'wechat-withdraw/index',
        'consumption-records/index',
        'coupons/index',
        'digital-assets/index',
      ],
    },
    {
      root: 'packages/after-sales',
      pages: [
        'after-sale-list/index',
        'after-sale-apply/index',
        'after-sale-detail/index',
      ],
    },
    {
      root: 'packages/invoices',
      pages: [
        'invoice-list/index',
        'invoice-request/index',
        'invoice-detail/index',
        'profile-list/index',
        'profile-edit/index',
      ],
    },
    {
      root: 'packages/benefits',
      pages: [
        'vip-center/index',
        'vip-gifts/index',
        'member-agreement/index',
        'lottery/index',
        'growth/index',
        'vip-tree/index',
        'normal-tree/index',
        'queue-reward/index',
      ],
    },
    {
      root: 'packages/group-buy',
      pages: [
        'activity-list/index',
        'activity-detail/index',
        'checkout/index',
        'checkout-pending/index',
        'current/index',
        'rebate-ledgers/index',
      ],
    },
    {
      root: 'packages/ai',
      pages: ['recommend/index'],
    },
    {
      root: 'packages/customer-service',
      pages: ['session-list/index', 'chat/index'],
    },
    {
      root: 'packages/messages',
      pages: ['inbox/index', 'detail/index'],
    },
    {
      root: 'packages/referral',
      pages: ['center/index', 'landing/index', 'records/index'],
    },
    {
      root: 'packages/community',
      pages: [
        'captain-center/index',
        'captain-application/index',
        'captain-landing/index',
        'following/index',
        'author-detail/index',
        'scanner/index',
        'scene/index',
      ],
    },
    {
      root: 'packages/settings',
      pages: ['index/index', 'about/index'],
    },
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#FAFCFA',
    navigationBarTitleText: '爱买买',
    navigationBarTextStyle: 'black',
    backgroundColor: '#FAFCFA',
  },
  tabBar: {
    color: '#8A9B8A',
    selectedColor: '#2E7D32',
    backgroundColor: '#FFFFFF',
    borderStyle: 'white',
    list: [
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/products/index', text: '商品' },
      { pagePath: 'pages/me/index', text: '我的' },
    ],
  },
  lazyCodeLoading: 'requiredComponents',
});
