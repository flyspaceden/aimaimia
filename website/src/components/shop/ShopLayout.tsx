// website/src/components/shop/ShopLayout.tsx
import { Outlet } from 'react-router-dom'
import ShopNavbar from './ShopNavbar'
import ShopFooter from './ShopFooter'
import { CartProvider } from '@/contexts/CartContext'

export default function ShopLayout() {
  return (
    <CartProvider>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <ShopNavbar />
        <div className="flex-1">
          <Outlet />
        </div>
        <ShopFooter />
      </div>
    </CartProvider>
  )
}
