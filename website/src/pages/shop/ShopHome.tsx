// website/src/pages/shop/ShopHome.tsx
import { Link } from 'react-router-dom'
import { SHOP_PRODUCTS, HOME_SECTIONS } from '@/data/shopMockData'
import ProductCard from '@/components/shop/ProductCard'

function HeroBanner() {
  return (
    <div
      className="relative overflow-hidden flex items-center px-6 sm:px-12 py-8 sm:py-12"
      style={{ background: 'linear-gradient(135deg, #1B5E20 0%, #2E7D32 55%, #00897B 100%)', minHeight: '160px' }}
    >
      {/* Background decoration */}
      <div className="absolute right-6 sm:right-16 text-8xl sm:text-9xl opacity-20 select-none" aria-hidden="true">
        🌊
      </div>
      <div className="relative z-10 text-white">
        <span className="inline-block text-xs bg-white/20 px-3 py-1 rounded-full mb-3">
          🔥 粤港澳生鲜直供
        </span>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight">
          每日清晨直采 · 产地直发
        </h1>
        <p className="text-white/80 text-sm sm:text-base mt-2">
          湛江海鲜 · 阳江生猛 · 顺德河鲜 · 冷链直送到家
        </p>
        <Link
          to="/shop/category/seafood"
          className="inline-block mt-4 bg-orange-500 hover:bg-orange-600 text-white font-bold px-6 py-2.5 rounded-full text-sm transition-colors"
        >
          立即选购 →
        </Link>
      </div>
    </div>
  )
}

function FlashDealBar() {
  return (
    <div className="bg-orange-50 border-b border-orange-200 px-4 sm:px-6 py-3 flex items-center gap-3">
      <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded flex-shrink-0">
        限时秒杀
      </span>
      <span className="text-sm font-semibold text-orange-700">今日特惠</span>
      <span className="text-xs text-gray-400 ml-auto flex-shrink-0">距结束 02:34:17 ⏱</span>
      <Link to="/shop/category/all" className="text-xs text-brand font-semibold flex-shrink-0 hidden sm:block">
        查看全部 →
      </Link>
    </div>
  )
}

interface ProductSectionProps {
  title: string
  categoryId: string
  productIds: string[]
}

function ProductSection({ title, categoryId, productIds }: ProductSectionProps) {
  const products = productIds
    .map(id => SHOP_PRODUCTS.find(p => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined)

  return (
    <section className="max-w-page mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <Link
          to={`/shop/category/${categoryId}`}
          className="text-sm text-brand hover:text-brand-dark font-medium transition-colors"
        >
          查看全部 →
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {products.map(product => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  )
}

export default function ShopHome() {
  return (
    <div>
      <HeroBanner />
      <FlashDealBar />

      {/* Category icon row */}
      <div className="max-w-page mx-auto px-4 sm:px-6 py-5 sm:hidden">
        <div className="grid grid-cols-4 gap-2">
          {[
            { id: 'seafood', emoji: '🦐', label: '海鲜' },
            { id: 'fish',    emoji: '🐟', label: '鱼类' },
            { id: 'fruit',   emoji: '🍊', label: '水果' },
            { id: 'vegetable', emoji: '🥬', label: '蔬菜' },
          ].map(cat => (
            <Link
              key={cat.id}
              to={`/shop/category/${cat.id}`}
              className="flex flex-col items-center gap-1 bg-white rounded-xl p-3 shadow-sm hover:shadow-card transition-shadow"
            >
              <span className="text-2xl">{cat.emoji}</span>
              <span className="text-xs text-gray-600">{cat.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Product sections */}
      {HOME_SECTIONS.map(section => (
        <ProductSection
          key={section.categoryId}
          title={section.title}
          categoryId={section.categoryId}
          productIds={section.productIds}
        />
      ))}

      {/* Trust banner */}
      <div className="bg-white border-t border-gray-100 py-8 mt-4">
        <div className="max-w-page mx-auto px-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
            {[
              { icon: '🚚', title: '顺丰冷链', desc: '全程0-4°C保鲜' },
              { icon: '🌊', title: '产地直采', desc: '清晨鲜采当日发' },
              { icon: '✅', title: '品质保障', desc: '严格质检，不满意退' },
              { icon: '📞', title: '7×14客服', desc: '400-888-8888' },
            ].map(item => (
              <div key={item.title} className="flex flex-col items-center gap-2">
                <span className="text-3xl">{item.icon}</span>
                <span className="font-semibold text-gray-800 text-sm">{item.title}</span>
                <span className="text-xs text-gray-400">{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
