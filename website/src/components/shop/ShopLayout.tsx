// website/src/components/shop/ShopLayout.tsx
import { Outlet } from 'react-router-dom'
import ShopNavbar from './ShopNavbar'
import ShopFooter from './ShopFooter'

export default function ShopLayout() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <ShopNavbar cartCount={3} />
      <main className="flex-1">
        <Outlet />
      </main>
      <ShopFooter />
    </div>
  )
}
