// website/src/components/shop/ShopNavbar.tsx
import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { SHOP_CATEGORIES } from '@/data/shopMockData'

interface Props {
  cartCount?: number
}

export default function ShopNavbar({ cartCount = 3 }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleSearch = () => {
    if (searchQuery.trim()) {
      navigate(`/shop/category/all?q=${encodeURIComponent(searchQuery.trim())}`)
    }
  }

  const activeCatId = location.pathname.startsWith('/shop/category/')
    ? location.pathname.split('/')[3]
    : null

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      {/* Top row */}
      <div className="max-w-page mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
        {/* Logo */}
        <Link to="/shop" className="font-black text-brand text-base sm:text-lg whitespace-nowrap flex items-center gap-1">
          🛒 <span>爱买买生鲜</span>
        </Link>

        {/* Search bar */}
        <div className="flex-1 flex items-center bg-gray-100 rounded-full px-3 sm:px-4 py-2 gap-2 min-w-0">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="搜索广东海鲜、生鲜蔬果..."
            className="bg-transparent flex-1 text-sm text-gray-600 placeholder-gray-400 outline-none min-w-0"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
          />
        </div>

        {/* Desktop: city + my orders */}
        <div className="hidden lg:flex items-center gap-4 text-sm text-gray-500 whitespace-nowrap flex-shrink-0">
          <span className="cursor-pointer hover:text-brand transition-colors">📍 广州 ▾</span>
          <Link to="/shop/user" className="hover:text-brand transition-colors">我的订单</Link>
        </div>

        {/* Cart icon */}
        <Link to="/shop/cart" className="relative text-gray-600 hover:text-brand transition-colors flex-shrink-0">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          {cartCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center font-bold leading-none">
              {cartCount}
            </span>
          )}
        </Link>

        {/* Desktop: user icon */}
        <Link to="/shop/user" className="hidden sm:block text-gray-600 hover:text-brand transition-colors flex-shrink-0">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </Link>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden text-gray-600 flex-shrink-0 p-1"
          onClick={() => setMenuOpen(v => !v)}
          aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
          aria-expanded={menuOpen}
          aria-controls="shop-mobile-menu"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {menuOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            }
          </svg>
        </button>
      </div>

      {/* Category tabs – desktop */}
      <div className="hidden sm:flex max-w-page mx-auto px-6 overflow-x-auto scrollbar-hide border-t border-gray-100">
        {SHOP_CATEGORIES.map(cat => (
          <Link
            key={cat.id}
            to={`/shop/category/${cat.id}`}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
              activeCatId === cat.id
                ? 'text-brand border-brand font-semibold'
                : 'text-gray-600 border-transparent hover:text-brand hover:border-brand'
            }`}
          >
            {cat.emoji} {cat.label}
          </Link>
        ))}
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="sm:hidden bg-white border-t border-gray-100 shadow-lg" id="shop-mobile-menu">
          <div className="px-4 py-3 flex flex-col">
            {SHOP_CATEGORIES.map(cat => (
              <Link
                key={cat.id}
                to={`/shop/category/${cat.id}`}
                className="py-3 text-sm text-gray-700 border-b border-gray-50 last:border-0 flex items-center gap-2"
              >
                <span>{cat.emoji}</span>
                <span>{cat.label}</span>
              </Link>
            ))}
            <Link to="/shop/user" className="py-3 text-sm text-brand font-medium flex items-center gap-2">
              <span>👤</span><span>个人中心</span>
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
