// website/src/components/shop/ProductCard.tsx
import { Link } from 'react-router-dom'
import type { Product } from '@/data/shopMockData'

interface Props {
  product: Product
}

export default function ProductCard({ product }: Props) {
  return (
    <Link
      to={`/shop/product/${product.id}`}
      className="block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 group"
    >
      {/* Product image area */}
      <div
        className="flex items-center justify-center text-5xl"
        style={{ background: product.bgGradient, height: '120px' }}
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
    </Link>
  )
}
