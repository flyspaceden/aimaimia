import { Link, useNavigate } from 'react-router-dom'
import { SHOP_PRODUCTS } from '@/data/shopMockData'
import { useCart } from '@/contexts/CartContext'

export default function ShopCart() {
  const { items, removeItem, updateQty, toggleCheck, toggleAll } = useCart()
  const navigate = useNavigate()

  const checkedItems = items.filter(i => i.checked)
  const subtotal = checkedItems.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const allChecked = items.length > 0 && items.every(i => i.checked)

  // Recommended products not in cart
  const recommended = SHOP_PRODUCTS.filter(p => !items.find(i => i.productId === p.id)).slice(0, 2)

  return (
    <div className="max-w-page mx-auto px-4 sm:px-6 py-6">
      <h1 className="text-xl font-bold text-gray-900 mb-5">
        🛒 我的购物车
        {items.length > 0 && <span className="text-base font-normal text-gray-400 ml-2">（{items.length}件）</span>}
      </h1>

      {items.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">🛒</div>
          <p className="text-lg mb-4">购物车是空的</p>
          <Link to="/shop" className="bg-brand text-white px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-brand-dark transition-colors">
            去购物
          </Link>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Item list */}
          <div className="flex-1 min-w-0">
            {/* Select all row */}
            <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3 mb-3">
              <button
                onClick={toggleAll}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  allChecked ? 'bg-brand border-brand text-white' : 'border-gray-300'
                }`}
              >
                {allChecked && <span className="text-xs leading-none">✓</span>}
              </button>
              <span className="text-sm text-gray-600">全选</span>
              <span className="ml-auto text-xs text-gray-400">共 {items.length} 件商品</span>
            </div>

            {/* Items */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {items.map((item, idx) => {
                const product = SHOP_PRODUCTS.find(p => p.id === item.productId)
                const maxQty = Math.max(1, product?.stock ?? 99)
                return (
                  <div key={item.productId} className={`flex items-start gap-3 p-4 ${idx > 0 ? 'border-t border-gray-50' : ''}`}>
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleCheck(item.productId)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-1 transition-colors ${
                        item.checked ? 'bg-brand border-brand text-white' : 'border-gray-300'
                      }`}
                    >
                      {item.checked && <span className="text-xs leading-none">✓</span>}
                    </button>

                    {/* Image */}
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div
                        className="w-16 h-16 rounded-lg flex items-center justify-center text-3xl flex-shrink-0"
                        style={{ background: item.bgGradient }}
                        aria-hidden="true"
                      >
                        {item.emoji}
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${item.checked ? 'text-gray-900' : 'text-gray-400'}`}>
                        {item.name}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">规格：{item.spec}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-base font-bold text-red-500">¥{item.price}</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateQty(item.productId, -1)}
                            className="w-7 h-7 rounded border border-gray-200 flex items-center justify-center text-gray-500 hover:border-brand hover:text-brand transition-colors"
                          >
                            −
                          </button>
                          <span className="text-sm font-semibold w-6 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateQty(item.productId, 1, maxQty)}
                            className="w-7 h-7 rounded border border-gray-200 flex items-center justify-center text-gray-500 hover:border-brand hover:text-brand transition-colors"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Delete */}
                    <button
                      onClick={() => removeItem(item.productId)}
                      className="text-gray-300 hover:text-red-400 transition-colors text-xs flex-shrink-0"
                    >
                      删除
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Order summary */}
          <div className="lg:w-72 flex-shrink-0">
            <div className="bg-white rounded-xl border border-gray-100 p-4 sticky top-24">
              <h2 className="font-bold text-gray-900 mb-4">订单摘要</h2>

              {/* Coupon */}
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2.5 mb-4">
                <span className="text-sm text-brand">🎫 使用优惠券</span>
                <span className="ml-auto text-xs text-gray-400">暂无可用 ›</span>
              </div>

              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between text-gray-600">
                  <span>商品总价</span>
                  <span>¥{subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>运费</span>
                  <span className="text-brand">免运费</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>优惠</span>
                  <span className="text-red-500">-¥0.00</span>
                </div>
              </div>

              <div className="flex justify-between font-bold text-base border-t border-gray-100 pt-3 mb-4">
                <span>合计</span>
                <span className="text-red-500">¥{subtotal.toFixed(2)}</span>
              </div>

              <button
                onClick={() => navigate('/shop/checkout')}
                disabled={checkedItems.length === 0}
                className="w-full py-3 rounded-xl font-bold text-sm bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white transition-colors"
              >
                结算 ({checkedItems.length} 件)
              </button>

              <p className="text-center text-xs text-gray-400 mt-3">
                🔒 安全支付 · 支持微信/支付宝
              </p>

              {/* Recommended */}
              {recommended.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-600 mb-3">猜你喜欢</p>
                  <div className="grid grid-cols-2 gap-2">
                    {recommended.map(p => (
                      <Link
                        key={p.id}
                        to={`/shop/product/${p.id}`}
                        className="block bg-gray-50 rounded-lg overflow-hidden hover:shadow-sm transition-shadow"
                      >
                        <div
                          className="h-12 flex items-center justify-center text-2xl"
                          style={{ background: p.bgGradient }}
                          aria-hidden="true"
                        >
                          {p.emoji}
                        </div>
                        <div className="p-1.5">
                          <p className="text-xs text-gray-700 font-medium truncate">{p.name}</p>
                          <p className="text-xs text-red-500 font-bold">¥{p.price}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
