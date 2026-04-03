// website/src/components/shop/ProductCard.tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Product } from '@/data/shopMockData'
import { useCart } from '@/contexts/CartContext'

interface Props {
  product: Product
}

export default function ProductCard({ product }: Props) {
  const { addItem } = useCart()
  const [justAdded, setJustAdded] = useState(false)

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    addItem(product, 0, 1)
    setJustAdded(true)
    setTimeout(() => setJustAdded(false), 1200)
  }

  return (
    <Link
      to={`/shop/product/${product.id}`}
      className="block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 group relative"
    >
      {/* Product image area */}
      <div
        className="flex items-center justify-center text-5xl"
        style={{ background: product.bgGradient || 'linear-gradient(135deg, #e8f5e9, #c8e6c9)', height: '120px' }}
        aria-hidden="true"
      >
        {product.emoji}
      </div>

      {/* Product info */}
      <div className="p-3">
        {product.badge && (
          <span className="inline-block text-xs bg-brand text-white px-1.5 py-0.5 rounded mb-1.5">
            {product.badge}
          </span>
        )}
        <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-brand transition-colors">
          {product.name}
        </p>
        <p className="text-xs text-gray-400 mt-0.5 truncate">{product.subtitle}</p>
        <div className="flex items-baseline gap-1.5 mt-2">
          <span className="text-base font-bold text-red-500">
            <span className="text-xs">¥</span>{product.price}
          </span>
          {product.originalPrice > product.price && (
            <span className="text-xs text-gray-300 line-through">¥{product.originalPrice}</span>
          )}
        </div>
      </div>

      {/* Quick-add button (appears on hover) */}
      <button
        onClick={handleQuickAdd}
        aria-label={`加入购物车: ${product.name}`}
        className={`absolute bottom-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shadow-md transition-all duration-200
          ${justAdded
            ? 'bg-brand text-white opacity-100 scale-110'
            : 'bg-brand text-white opacity-0 group-hover:opacity-100 scale-95 group-hover:scale-100'
          }`}
      >
        {justAdded ? '✓' : '+'}
      </button>
    </Link>
  )
}
