import { useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { SHOP_PRODUCTS, SHOP_CATEGORIES } from '@/data/shopMockData'
import ProductCard from '@/components/shop/ProductCard'

type SortKey = 'default' | 'sales' | 'price_asc' | 'price_desc'

export default function ShopCategory() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const searchQuery = searchParams.get('q')?.trim().toLowerCase() ?? ''
  const [sortKey, setSortKey] = useState<SortKey>('default')
  const [activeSubCat, setActiveSubCat] = useState<string>('全部')

  const category = SHOP_CATEGORIES.find(c => c.id === id)
  const subCategories = ['全部', ...(category?.subCategories ?? [])]

  // Filter products
  let products = id === 'all'
    ? SHOP_PRODUCTS
    : SHOP_PRODUCTS.filter(p => p.categoryId === id)

  if (searchQuery) {
    products = products.filter(p =>
      p.name.toLowerCase().includes(searchQuery) ||
      p.subtitle.toLowerCase().includes(searchQuery) ||
      p.origin.toLowerCase().includes(searchQuery)
    )
  }

  // Sort
  const sorted = [...products].sort((a, b) => {
    if (sortKey === 'price_asc') return a.price - b.price
    if (sortKey === 'price_desc') return b.price - a.price
    return 0
  })

  const categoryLabel = id === 'all' ? '全部商品' : (category?.label ?? '商品列表')

  return (
    <div className="max-w-page mx-auto px-4 sm:px-6 py-4">
      {/* Breadcrumb */}
      <nav className="text-xs text-gray-400 mb-4 flex items-center gap-1.5">
        <Link to="/shop" className="hover:text-brand transition-colors">首页</Link>
        <span>›</span>
        <span className="text-gray-700">{categoryLabel}</span>
      </nav>

      {searchQuery && (
        <div className="mb-3 text-sm text-gray-600">
          搜索 "<span className="font-semibold text-brand">{searchQuery}</span>" 的结果
        </div>
      )}

      <div className="flex gap-4">
        {/* Desktop: left sub-category sidebar */}
        {subCategories.length > 1 && (
          <aside className="hidden sm:block w-32 flex-shrink-0">
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden sticky top-32">
              <div className="px-3 py-2.5 bg-brand-soft text-brand text-xs font-semibold">
                {category?.emoji} {category?.label}
              </div>
              {subCategories.map(sub => (
                <button
                  key={sub}
                  onClick={() => setActiveSubCat(sub)}
                  className={`w-full text-left px-3 py-2.5 text-xs border-b border-gray-50 last:border-0 transition-colors ${
                    activeSubCat === sub
                      ? 'bg-brand-soft text-brand font-semibold'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {sub}
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Mobile: horizontal sub-category tabs */}
          {subCategories.length > 1 && (
            <div className="sm:hidden flex gap-2 overflow-x-auto scrollbar-hide mb-3 pb-1">
              {subCategories.map(sub => (
                <button
                  key={sub}
                  onClick={() => setActiveSubCat(sub)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    activeSubCat === sub
                      ? 'bg-brand text-white'
                      : 'bg-white text-gray-600 border border-gray-200'
                  }`}
                >
                  {sub}
                </button>
              ))}
            </div>
          )}

          {/* Sort toolbar */}
          <div className="flex items-center gap-2 mb-4 bg-white rounded-xl border border-gray-100 px-4 py-2.5">
            <span className="text-xs text-gray-400 mr-2">排序：</span>
            {([
              { key: 'default' as SortKey, label: '综合' },
              { key: 'sales' as SortKey, label: '销量' },
              { key: 'price_asc' as SortKey, label: '价格↑' },
              { key: 'price_desc' as SortKey, label: '价格↓' },
            ]).map(opt => (
              <button
                key={opt.key}
                onClick={() => setSortKey(opt.key)}
                className={`px-3 py-1 rounded-full text-xs transition-colors ${
                  sortKey === opt.key
                    ? 'bg-brand text-white font-semibold'
                    : 'text-gray-500 hover:text-brand'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <span className="ml-auto text-xs text-gray-400">{sorted.length} 件商品</span>
          </div>

          {/* Product grid */}
          {sorted.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {sorted.map(product => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-3">🔍</div>
              <p>该分类暂无商品</p>
              <Link to="/shop" className="text-brand text-sm mt-2 inline-block">返回首页</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
