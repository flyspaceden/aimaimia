// website/src/pages/shop/ShopUser.tsx
import { Link } from 'react-router-dom'

const ORDER_STATS = [
  { label: '待付款', emoji: '💳', count: 0 },
  { label: '待发货', emoji: '📦', count: 1 },
  { label: '待收货', emoji: '🚚', count: 2 },
  { label: '已完成', emoji: '✅', count: 8 },
]

const RECENT_ORDERS = [
  {
    id: 'AMM2025040301',
    date: '2025-04-03',
    status: '待收货',
    statusColor: 'text-orange-500',
    items: [
      { emoji: '🦀', name: '阳江肉蟹', spec: '500g/只 ×1', price: 68 },
      { emoji: '🦐', name: '湛江大对虾', spec: '500g/袋 ×2', price: 90 },
    ],
    total: 158,
  },
  {
    id: 'AMM2025033101',
    date: '2025-03-31',
    status: '已完成',
    statusColor: 'text-green-600',
    items: [
      { emoji: '🐟', name: '顺德鲩鱼', spec: '约1.5kg/条 ×1', price: 32 },
    ],
    total: 32,
  },
]

const MENU_ITEMS = [
  { icon: '📋', label: '全部订单', to: '/shop/user' },
  { icon: '📍', label: '收货地址', to: '/shop/user' },
  { icon: '🎫', label: '我的优惠券', to: '/shop/user' },
  { icon: '👁️', label: '浏览历史', to: '/shop/user' },
  { icon: '❓', label: '帮助中心', to: '/shop/user' },
  { icon: '📞', label: '联系客服', to: '/shop/user' },
]

export default function ShopUser() {
  return (
    <div className="max-w-page mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* User info header */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-brand-soft flex items-center justify-center text-3xl flex-shrink-0">
            👩
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-lg font-bold text-gray-900">李**</h1>
              <span className="text-xs bg-gold text-white px-2 py-0.5 rounded-full font-semibold">
                🌟 VIP会员
              </span>
            </div>
            <p className="text-sm text-gray-500">手机：138****8888</p>
            <p className="text-xs text-gray-400 mt-0.5">注册时间：2024-08-15 · 累计消费 ¥1,286</p>
          </div>
          <Link to="/" className="ml-auto text-xs text-gray-400 hover:text-brand transition-colors flex-shrink-0">
            返回官网
          </Link>
        </div>
      </div>

      {/* Order status */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900">我的订单</h2>
          <button className="text-xs text-brand">查看全部 →</button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {ORDER_STATS.map(stat => (
            <button key={stat.label} className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-gray-50 transition-colors">
              <span className="text-2xl">{stat.emoji}</span>
              {stat.count > 0 && (
                <span className="text-base font-bold text-brand">{stat.count}</span>
              )}
              <span className="text-xs text-gray-500">{stat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Recent orders */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h2 className="font-bold text-gray-900 mb-4">最近订单</h2>
        <div className="space-y-4">
          {RECENT_ORDERS.map(order => (
            <div key={order.id} className="border border-gray-100 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 font-mono">{order.id}</span>
                  <span className="text-xs text-gray-400">{order.date}</span>
                </div>
                <span className={`text-xs font-semibold ${order.statusColor}`}>{order.status}</span>
              </div>
              <div className="px-4 py-3 space-y-2">
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="text-xl">{item.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 font-medium truncate">{item.name}</p>
                      <p className="text-xs text-gray-400">{item.spec}</p>
                    </div>
                    <span className="text-sm font-semibold text-gray-700 flex-shrink-0">¥{item.price}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
                <span className="text-sm text-gray-500">
                  合计：<span className="font-bold text-gray-900">¥{order.total}</span>
                </span>
                <div className="flex gap-2">
                  {order.status === '待收货' && (
                    <button className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white font-medium">
                      确认收货
                    </button>
                  )}
                  <button className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600">
                    查看详情
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Menu list */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {MENU_ITEMS.map((item, idx) => (
          <Link
            key={item.label}
            to={item.to}
            className={`flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors ${idx > 0 ? 'border-t border-gray-50' : ''}`}
          >
            <span className="text-xl">{item.icon}</span>
            <span className="text-sm font-medium text-gray-700 flex-1">{item.label}</span>
            <span className="text-gray-300">›</span>
          </Link>
        ))}
        <button className="w-full flex items-center gap-3 px-5 py-4 border-t border-gray-50 hover:bg-red-50 transition-colors text-red-400">
          <span className="text-xl">🚪</span>
          <span className="text-sm font-medium flex-1 text-left">退出登录</span>
        </button>
      </div>
    </div>
  )
}
