export type PageParityStatus = 'equivalent' | 'merged' | 'hidden' | 'platform-adapted';

export type PageParityGroup = {
  group: string;
  status: PageParityStatus;
  appFiles: readonly string[];
  miniPages: readonly string[];
  note: string;
};

/**
 * 当前 App 路由到微信小程序页面的权威映射。
 * - equivalent: 独立页面对标
 * - merged: 同义/选择页合并到列出的小程序页面，但能力不得缺失
 * - hidden: App 当前隐藏、重定向或仅保留历史文件，小程序不得注册
 * - platform-adapted: 使用微信启动、scene、权限或订阅消息机制替代
 */
export const PAGE_PARITY: readonly PageParityGroup[] = [
  {
    group: '启动与主导航', status: 'platform-adapted',
    appFiles: ['app/index.tsx', 'app/(tabs)/home.tsx', 'app/(tabs)/museum.tsx', 'app/(tabs)/me.tsx'],
    miniPages: ['pages/home/index', 'pages/products/index', 'pages/me/index'],
    note: '微信负责启动页；三个主 Tab 的信息架构、模块顺序和品牌视觉对齐 App。',
  },
  {
    group: '账号与资料', status: 'equivalent',
    appFiles: ['app/bind-phone.tsx', 'app/account-security.tsx', 'app/me/profile.tsx', 'app/me/deletion.tsx'],
    miniPages: [
      'packages/account/account-bind-phone/index', 'packages/account/account-security/index',
      'packages/account/account-profile/index', 'packages/account/account-deletion/index',
    ],
    note: '登录入口另由小程序登录页承接；资料、绑定、安全和注销均使用共享后端。',
  },
  {
    group: '地址', status: 'equivalent',
    appFiles: ['app/me/addresses.tsx', 'app/checkout-address.tsx'],
    miniPages: ['packages/account/account-addresses/index', 'packages/account/account-address-form/index', 'packages/commerce/checkout-address/index'],
    note: '地址管理和结算地址选择拆分，与 App 保持同样返回路径。',
  },
  {
    group: '设置与法律', status: 'merged',
    appFiles: [
      'app/settings.tsx', 'app/notification-settings.tsx', 'app/me/appearance.tsx',
      'app/about.tsx', 'app/privacy.tsx', 'app/terms.tsx', 'app/member-service-agreement.tsx',
    ],
    miniPages: [
      'packages/settings/index/index', 'packages/settings/about/index',
      'packages/account/account-appearance/index', 'packages/account/account-legal/index',
      'packages/benefits/member-agreement/index',
    ],
    note: '通知授权合并到设置页并改用微信订阅消息；法律源文本保持一致。',
  },
  {
    group: '搜索与分类', status: 'merged',
    appFiles: ['app/search.tsx', 'app/category/[id].tsx'],
    miniPages: ['packages/commerce/catalog-search/index', 'pages/products/index'],
    note: '搜索页独立对标；分类页能力在商品 Tab 的分类筛选中承接。',
  },
  {
    group: '商品与企业', status: 'equivalent',
    appFiles: ['app/product/[id].tsx', 'app/company/[id].tsx', 'app/company/search.tsx'],
    miniPages: [
      'packages/commerce/catalog-product/index', 'packages/commerce/catalog-company/index',
      'packages/commerce/company-search/index',
    ],
    note: '商品、企业档案和结构化企业搜索均为独立页面。',
  },
  {
    group: '用户与关注', status: 'equivalent',
    appFiles: ['app/user/[id].tsx', 'app/me/following.tsx'],
    miniPages: ['packages/community/author-detail/index', 'packages/community/following/index'],
    note: '用户作者资料、企业/用户关注列表共用服务端关系。',
  },
  {
    group: '考察团历史页', status: 'hidden',
    appFiles: ['app/group/[id].tsx'], miniPages: [],
    note: 'App 企业详情中的组团 Tab 当前注释隐藏，不因历史文件存在而在小程序恢复。',
  },
  {
    group: '购物车与结算', status: 'equivalent',
    appFiles: ['app/cart.tsx', 'app/checkout.tsx', 'app/checkout-coupon.tsx', 'app/checkout-pending.tsx', 'app/payment-success.tsx'],
    miniPages: [
      'packages/commerce/cart/index', 'packages/commerce/checkout/index',
      'packages/commerce/checkout-coupon/index', 'packages/commerce/checkout-pending/index',
      'packages/orders/payment-success/index',
    ],
    note: '独立红包选择、跨端待支付和微信支付结果页对齐 App；不展示支付宝。',
  },
  {
    group: '订单', status: 'equivalent',
    appFiles: ['app/orders/index.tsx', 'app/orders/[id].tsx', 'app/orders/receiver-info/[id].tsx', 'app/orders/track.tsx'],
    miniPages: [
      'packages/orders/order-list/index', 'packages/orders/order-detail/index',
      'packages/orders/receiver-info/index', 'packages/orders/order-track/index',
    ],
    note: '列表、状态操作、收货信息、复购和物流均为共享订单数据。',
  },
  {
    group: '售后', status: 'equivalent',
    appFiles: ['app/orders/after-sale/index.tsx', 'app/orders/after-sale/[id].tsx', 'app/orders/after-sale-detail/[id].tsx'],
    miniPages: [
      'packages/after-sales/after-sale-list/index', 'packages/after-sales/after-sale-apply/index',
      'packages/after-sales/after-sale-detail/index',
    ],
    note: '退款、退货、换货和退货运费微信支付按原订单规则处理。',
  },
  {
    group: '发票', status: 'equivalent',
    appFiles: [
      'app/invoices/index.tsx', 'app/invoices/[id].tsx', 'app/invoices/request.tsx',
      'app/invoices/profiles.tsx', 'app/invoices/profiles/edit.tsx',
    ],
    miniPages: [
      'packages/invoices/invoice-list/index', 'packages/invoices/invoice-detail/index',
      'packages/invoices/invoice-request/index', 'packages/invoices/profile-list/index',
      'packages/invoices/profile-edit/index',
    ],
    note: '抬头、申请、详情、取消和状态历史完整拆页。',
  },
  {
    group: '团购', status: 'equivalent',
    appFiles: ['app/group-buy/index.tsx', 'app/group-buy/[activityId].tsx', 'app/group-buy/checkout.tsx', 'app/gb/[code].tsx'],
    miniPages: [
      'packages/group-buy/activity-list/index', 'packages/group-buy/activity-detail/index',
      'packages/group-buy/checkout/index', 'packages/community/scene/index',
    ],
    note: '活动、详情、结算和分享码入口改用小程序卡片/scene。',
  },
  {
    group: '优惠券', status: 'merged',
    appFiles: ['app/coupon-center.tsx', 'app/me/coupons.tsx'],
    miniPages: ['packages/member/coupons/index'],
    note: 'App 领券中心本身重定向到我的优惠券；小程序在同页提供双 Tab。',
  },
  {
    group: 'VIP 与礼包', status: 'equivalent',
    appFiles: ['app/me/vip.tsx', 'app/vip/gifts.tsx'],
    miniPages: ['packages/benefits/vip-center/index', 'packages/benefits/vip-gifts/index'],
    note: '会员身份、礼包、多商品赠品与推荐权益对标，只使用微信支付。',
  },
  {
    group: '抽奖', status: 'equivalent',
    appFiles: ['app/lottery.tsx'], miniPages: ['packages/benefits/lottery/index'],
    note: '公开抽奖、次数、中奖记录和奖品入购物车规则一致。',
  },
  {
    group: '钱包与提现', status: 'equivalent',
    appFiles: ['app/me/wallet.tsx', 'app/me/withdraw.tsx', 'app/me/consumption-records.tsx'],
    miniPages: ['packages/member/wallet/index', 'packages/member/wechat-withdraw/index', 'packages/member/consumption-records/index'],
    note: '统一余额和流水对标；小程序提现通道替换为微信零钱。',
  },
  {
    group: '奖励与成长', status: 'equivalent',
    appFiles: ['app/me/bonus-tree.tsx', 'app/me/bonus-queue.tsx', 'app/me/growth.tsx'],
    miniPages: ['packages/benefits/vip-tree/index', 'packages/benefits/normal-tree/index', 'packages/benefits/queue-reward/index', 'packages/benefits/growth/index'],
    note: 'VIP/普通树、队列奖励和耕耘值均使用真实服务端数据。',
  },
  {
    group: '任务中心', status: 'hidden',
    appFiles: ['app/me/tasks.tsx'], miniPages: [],
    note: 'App 入口当前隐藏；服务端行为凭证未收口前小程序保持 fail-closed。',
  },
  {
    group: '数字资产', status: 'equivalent',
    appFiles: ['app/me/digital-assets.tsx'], miniPages: ['packages/member/digital-assets/index'],
    note: '累计消费资产保持独立于钱包积分和优惠券。',
  },
  {
    group: '推荐中心', status: 'merged',
    appFiles: ['app/me/referral.tsx', 'app/me/referral-users.tsx'],
    miniPages: ['packages/referral/center/index', 'packages/referral/records/index'],
    note: '分享、关系、统计和推荐用户记录按职责拆分。',
  },
  {
    group: '推荐历史重定向页', status: 'hidden',
    appFiles: ['app/referral.tsx', 'app/me/recommend.tsx'], miniPages: [],
    note: '当前 App 为首页重定向或占位页，小程序不重复注册同义入口。',
  },
  {
    group: '团长', status: 'equivalent',
    appFiles: ['app/me/captain.tsx', 'app/me/captain-application.tsx', 'app/c/[code].tsx'],
    miniPages: [
      'packages/community/captain-center/index', 'packages/community/captain-application/index',
      'packages/community/captain-landing/index',
    ],
    note: '团长经营、申请和关系落地与推荐关系隔离。',
  },
  {
    group: '推荐落地', status: 'platform-adapted',
    appFiles: ['app/r/[code].tsx', 'app/s/[code].tsx'],
    miniPages: ['packages/referral/landing/index', 'packages/community/scene/index'],
    note: 'App 深链改为小程序启动参数和服务端随机 scene。',
  },
  {
    group: '扫码', status: 'platform-adapted',
    appFiles: ['app/me/scanner.tsx'], miniPages: ['packages/community/scanner/index'],
    note: '使用微信 Taro.scanCode 识别推荐、团购和团长业务码。',
  },
  {
    group: 'AI 推荐', status: 'equivalent',
    appFiles: ['app/ai/recommend.tsx'], miniPages: ['packages/ai/recommend/index'],
    note: '保留语音解析得到的预算、品类、产地、口味、主题和搭配语义。',
  },
  {
    group: 'AI 历史隐藏页', status: 'hidden',
    appFiles: ['app/ai/assistant.tsx', 'app/ai/chat.tsx', 'app/ai/history.tsx', 'app/ai/finance.tsx', 'app/ai/trace.tsx'],
    miniPages: [],
    note: 'App 当前重定向或隐藏；首页可见的长按语音能力直接在小程序首页实现。',
  },
  {
    group: '客服', status: 'equivalent',
    appFiles: ['app/cs/index.tsx'],
    miniPages: ['packages/customer-service/session-list/index', 'packages/customer-service/chat/index'],
    note: 'App 单路由内的会话列表和聊天态在小程序拆为两个页面。',
  },
  {
    group: '消息', status: 'equivalent',
    appFiles: ['app/inbox/index.tsx', 'app/inbox/[id].tsx'],
    miniPages: ['packages/messages/inbox/index', 'packages/messages/detail/index'],
    note: '站内消息列表、分类、未读和业务跳转对标。',
  },
] as const;

export const EXCLUDED_APP_ROUTE_PREFIXES = ['app/delivery/'] as const;
