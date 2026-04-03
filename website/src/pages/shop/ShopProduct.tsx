import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { SHOP_PRODUCTS } from '@/data/shopMockData'
import ProductCard from '@/components/shop/ProductCard'

export default function ShopProduct() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const product = SHOP_PRODUCTS.find(p => p.id === id)

  const [selectedSkuIdx, setSelectedSkuIdx] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const [activeThumb, setActiveThumb] = useState(0)
  const [addedToCart, setAddedToCart] = useState(false)

  if (!product) {
    return (
      <div className="text-center py-20 text-gray-400">
        <div className="text-5xl mb-4">🔍</div>
        <p className="text-lg">商品不存在</p>
        <Link to="/shop" className="text-brand mt-3 inline-block">返回首页</Link>
      </div>
    )
  }

  const category = product.categoryId
  const currentSku = product.skus[selectedSkuIdx]
  const currentPrice = currentSku?.price ?? product.price

  const handleAddToCart = () => {
    setAddedToCart(true)
    setTimeout(() => setAddedToCart(false), 2000)
  }

  const handleBuyNow = () => {
    navigate('/shop/checkout')
  }

  // Recommend products from same category
  const related = SHOP_PRODUCTS
    .filter(p => p.categoryId === category && p.id !== product.id)
    .slice(0, 4)

  // Mock thumbnails (same emoji repeated for demo)
  const thumbs = [product.emoji, '📦', '🚚', '✅']

  return (
    <div className="max-w-page mx-auto px-4 sm:px-6 py-4">
      {/* Breadcrumb */}
      <nav className="text-xs text-gray-400 mb-5 flex items-center gap-1.5">
        <Link to="/shop" className="hover:text-brand transition-colors">首页</Link>
        <span>›</span>
        <Link to={`/shop/category/${product.categoryId}`} className="hover:text-brand transition-colors">
          {product.categoryId === 'seafood' ? '海鲜水产'
            : product.categoryId === 'fish' ? '鱼类'
            : product.categoryId === 'fruit' ? '新鲜水果'
            : product.categoryId === 'vegetable' ? '时令蔬菜'
            : product.categoryId === 'meat' ? '肉禽蛋'
            : product.categoryId === 'specialty' ? '农家特产'
            : '冷冻食品'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 truncate max-w-xs">{product.name}</span>
      </nav>

      {/* Main product section */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-6">
        <div className="flex flex-col lg:flex-row">
          {/* Gallery */}
          <div className="lg:w-80 flex-shrink-0">
            {/* Main image */}
            <div
              className="flex items-center justify-center text-8xl"
              style={{ background: product.bgGradient, height: '280px' }}
              aria-hidden="true"
            >
              {thumbs[activeThumb] === product.emoji ? product.emoji : thumbs[activeThumb]}
            </div>
            {/* Thumbnails */}
            <div className="flex gap-2 p-3">
              {thumbs.map((thumb, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveThumb(idx)}
                  className={`w-14 h-14 rounded-lg flex items-center justify-center text-2xl border-2 transition-colors ${
                    activeThumb === idx
                      ? 'border-brand bg-brand-soft'
                      : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                  }`}
                  style={idx === 0 ? { background: product.bgGradient } : undefined}
                >
                  {thumb}
                </button>
              ))}
            </div>
          </div>

          {/* Product info */}
          <div className="flex-1 p-5 sm:p-6 border-t lg:border-t-0 lg:border-l border-gray-100">
            <h1 className="text-xl font-bold text-gray-900 leading-tight">{product.name}</h1>
            <p className="text-sm text-gray-500 mt-1">{product.subtitle} · 产地：{product.origin}</p>

            {/* Price */}
            <div className="mt-4 bg-red-50 rounded-xl p-4 flex items-baseline gap-3">
              <span className="text-3xl font-black text-red-500">
                <span className="text-lg">¥</span>{currentPrice}
              </span>
              {product.originalPrice > currentPrice && (
                <span className="text-sm text-gray-300 line-through">¥{product.originalPrice}</span>
              )}
              {product.originalPrice > currentPrice && (
                <span className="ml-auto text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-bold">
                  {Math.round(currentPrice / product.originalPrice * 10)}折
                </span>
              )}
            </div>

            {/* Tags */}
            <div className="flex flex-wrap gap-2 mt-4">
              {product.tags.map(tag => (
                <span key={tag} className="text-xs px-2.5 py-1 rounded-full border border-brand text-brand">
                  {tag}
                </span>
              ))}
            </div>

            {/* SKU selection */}
            {product.skus.length > 1 && (
              <div className="mt-5">
                <p className="text-sm font-semibold text-gray-700 mb-2">规格</p>
                <div className="flex flex-wrap gap-2">
                  {product.skus.map((sku, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedSkuIdx(idx)}
                      className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                        selectedSkuIdx === idx
                          ? 'border-brand bg-brand-soft text-brand font-semibold'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {sku.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity */}
            <div className="mt-5">
              <p className="text-sm font-semibold text-gray-700 mb-2">数量</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:border-brand hover:text-brand transition-colors text-lg"
                >
                  −
                </button>
                <span className="text-base font-semibold w-8 text-center">{quantity}</span>
                <button
                  onClick={() => setQuantity(q => Math.min(product.stock, q + 1))}
                  className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:border-brand hover:text-brand transition-colors text-lg"
                >
                  +
                </button>
                <span className="text-xs text-gray-400">库存 {product.stock} 件</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleAddToCart}
                className={`flex-1 py-3 rounded-xl font-semibold text-sm border-2 transition-colors ${
                  addedToCart
                    ? 'border-brand bg-brand text-white'
                    : 'border-brand text-brand hover:bg-brand hover:text-white'
                }`}
              >
                {addedToCart ? '✓ 已加入购物车' : '🛒 加入购物车'}
              </button>
              <button
                onClick={handleBuyNow}
                className="flex-1 py-3 rounded-xl font-semibold text-sm bg-orange-500 hover:bg-orange-600 text-white transition-colors"
              >
                立即购买
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Product details */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 mb-6">
        <h2 className="text-base font-bold text-gray-900 mb-4">商品详情</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {product.specs.map(spec => (
            <div key={spec.label} className="flex gap-3 text-sm">
              <span className="text-gray-400 flex-shrink-0 w-20">{spec.label}</span>
              <span className="text-gray-700">{spec.value}</span>
            </div>
          ))}
        </div>
        <div className="bg-brand-soft rounded-xl p-4 text-sm text-gray-700 leading-relaxed">
          {product.description}
        </div>
      </div>

      {/* Related products */}
      {related.length > 0 && (
        <div>
          <h2 className="text-base font-bold text-gray-900 mb-4">猜你喜欢</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {related.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
