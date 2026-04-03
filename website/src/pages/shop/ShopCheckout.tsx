import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MOCK_CART_ITEMS } from '@/data/shopMockData'

type DeliveryOption = 'sf_cold' | 'next_day'
type PaymentMethod = 'wechat' | 'alipay' | 'card'

const DELIVERY_OPTIONS = [
  { key: 'sf_cold' as DeliveryOption, label: '顺丰冷链专递', desc: '次日11:00前', price: 0 },
  { key: 'next_day' as DeliveryOption, label: '极速次日达', desc: '次日18:00前', price: 12 },
]

const PAYMENT_METHODS = [
  { key: 'wechat' as PaymentMethod, label: '微信支付', icon: '💚', desc: '推荐' },
  { key: 'alipay' as PaymentMethod, label: '支付宝', icon: '💙', desc: '' },
  { key: 'card' as PaymentMethod, label: '银行卡', icon: '💳', desc: '' },
]

function SuccessModal({ orderNo, onClose }: { orderNo: string; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
        <div className="text-6xl mb-4">🎉</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">支付成功！</h2>
        <p className="text-sm text-gray-500 mb-1">感谢您的购买</p>
        <p className="text-xs text-gray-400 mb-6">
          订单号：<span className="font-mono text-gray-600">{orderNo}</span>
        </p>
        <div className="bg-brand-soft rounded-xl p-3 text-sm text-brand mb-6 text-left">
          <p className="font-semibold mb-1">📦 预计配送时间</p>
          <p className="text-xs text-gray-600">顺丰冷链将于明日 11:00 前送达</p>
          <p className="text-xs text-gray-600">配送地址：广州市天河区珠江新城某小区 1栋101</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            继续购物
          </button>
          <button
            onClick={() => navigate('/shop/user')}
            className="flex-1 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-dark transition-colors"
          >
            查看订单
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ShopCheckout() {
  const navigate = useNavigate()
  const [delivery, setDelivery] = useState<DeliveryOption>('sf_cold')
  const [payment, setPayment] = useState<PaymentMethod>('wechat')
  const [remark, setRemark] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)

  const checkedItems = MOCK_CART_ITEMS.filter(i => i.checked)
  const subtotal = checkedItems.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const deliveryFee = DELIVERY_OPTIONS.find(o => o.key === delivery)?.price ?? 0
  const total = subtotal + deliveryFee

  const orderNo = `AMM${Date.now().toString().slice(-10)}`

  const handlePay = () => {
    setShowSuccess(true)
  }

  const handleCloseSuccess = () => {
    setShowSuccess(false)
    navigate('/shop')
  }

  return (
    <div className="max-w-page mx-auto px-4 sm:px-6 py-6">
      {showSuccess && <SuccessModal orderNo={orderNo} onClose={handleCloseSuccess} />}

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 transition-colors">
          ← 返回
        </button>
        <h1 className="text-xl font-bold text-gray-900">确认订单</h1>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left: order details */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Delivery address */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span>📍</span> 收货地址
            </h2>
            <div className="flex items-start gap-3 p-3 border-2 border-brand rounded-xl bg-brand-soft">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-900">李** </span>
                  <span className="text-gray-600 text-sm">138****8888</span>
                  <span className="text-xs bg-brand text-white px-1.5 py-0.5 rounded">默认</span>
                </div>
                <p className="text-sm text-gray-600">广东省广州市天河区珠江新城花城大道88号某某小区 1栋101室</p>
              </div>
              <button className="text-xs text-brand flex-shrink-0">修改</button>
            </div>
          </div>

          {/* Product list */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span>📦</span> 商品清单
            </h2>
            <div className="space-y-3">
              {checkedItems.map(item => (
                <div key={item.productId} className="flex items-center gap-3">
                  <div
                    className="w-14 h-14 rounded-lg flex items-center justify-center text-2xl flex-shrink-0"
                    style={{ background: item.bgGradient }}
                    aria-hidden="true"
                  >
                    {item.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                    <p className="text-xs text-gray-400">规格：{item.spec} · 数量：×{item.quantity}</p>
                  </div>
                  <span className="text-sm font-bold text-gray-900 flex-shrink-0">
                    ¥{(item.price * item.quantity).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Delivery options */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span>🚚</span> 配送方式
            </h2>
            <div className="space-y-3">
              {DELIVERY_OPTIONS.map(opt => (
                <label
                  key={opt.key}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                    delivery === opt.key
                      ? 'border-brand bg-brand-soft'
                      : 'border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="delivery"
                    value={opt.key}
                    checked={delivery === opt.key}
                    onChange={() => setDelivery(opt.key)}
                    className="accent-brand"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                    <span className="text-xs text-gray-400 ml-2">{opt.desc}</span>
                  </div>
                  <span className={`text-sm font-bold ${opt.price === 0 ? 'text-brand' : 'text-gray-700'}`}>
                    {opt.price === 0 ? '免费' : `¥${opt.price}`}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Remark */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
              <span>💬</span> 买家备注
            </h2>
            <textarea
              value={remark}
              onChange={e => setRemark(e.target.value)}
              placeholder="如有特殊要求可在此备注（选填）"
              rows={3}
              className="w-full text-sm text-gray-600 placeholder-gray-300 border border-gray-200 rounded-xl p-3 resize-none outline-none focus:border-brand transition-colors"
            />
          </div>
        </div>

        {/* Right: payment summary */}
        <div className="lg:w-80 flex-shrink-0">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 sticky top-24 space-y-5">
            {/* Payment method */}
            <div>
              <h2 className="font-bold text-gray-900 mb-3">支付方式</h2>
              <div className="space-y-2">
                {PAYMENT_METHODS.map(method => (
                  <label
                    key={method.key}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                      payment === method.key
                        ? 'border-brand bg-brand-soft'
                        : 'border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value={method.key}
                      checked={payment === method.key}
                      onChange={() => setPayment(method.key)}
                      className="accent-brand"
                    />
                    <span className="text-xl">{method.icon}</span>
                    <span className="text-sm font-medium text-gray-900 flex-1">{method.label}</span>
                    {method.desc && (
                      <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">{method.desc}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            {/* Price breakdown */}
            <div className="space-y-2 text-sm border-t border-gray-100 pt-4">
              <div className="flex justify-between text-gray-600">
                <span>商品合计</span>
                <span>¥{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>运费</span>
                <span className={deliveryFee === 0 ? 'text-brand' : ''}>
                  {deliveryFee === 0 ? '免费' : `¥${deliveryFee}`}
                </span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>优惠</span>
                <span className="text-red-500">-¥0.00</span>
              </div>
            </div>

            {/* Total */}
            <div className="flex justify-between font-black text-lg border-t border-gray-100 pt-3">
              <span>实付金额</span>
              <span className="text-red-500">¥{total.toFixed(2)}</span>
            </div>

            {/* Pay button */}
            <button
              onClick={handlePay}
              className="w-full py-4 rounded-xl font-bold text-base bg-orange-500 hover:bg-orange-600 text-white transition-colors shadow-lg"
            >
              确认支付 ¥{total.toFixed(2)}
            </button>

            <p className="text-center text-xs text-gray-400 flex items-center justify-center gap-1">
              <span>🔒</span>
              <span>SSL 加密保护 · 支付信息安全</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
