import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { PAGE_META } from '@/lib/constants'

const Home = lazy(() => import('@/pages/Home'))
const Products = lazy(() => import('@/pages/Products'))
const AiTech = lazy(() => import('@/pages/AiTech'))
const About = lazy(() => import('@/pages/About'))
const Merchants = lazy(() => import('@/pages/Merchants'))
const MerchantApply = lazy(() => import('@/pages/MerchantApply'))
const Contact = lazy(() => import('@/pages/Contact'))
const NotFound = lazy(() => import('@/pages/NotFound'))
const Download = lazy(() => import('@/pages/Download'))
const Resolve = lazy(() => import('@/pages/Resolve'))

// 商城模块
const ShopLayout = lazy(() => import('@/components/shop/ShopLayout'))
const ShopHome = lazy(() => import('@/pages/shop/ShopHome'))
const ShopCategory = lazy(() => import('@/pages/shop/ShopCategory'))
const ShopProduct = lazy(() => import('@/pages/shop/ShopProduct'))
const ShopCart = lazy(() => import('@/pages/shop/ShopCart'))
const ShopCheckout = lazy(() => import('@/pages/shop/ShopCheckout'))
const ShopUser = lazy(() => import('@/pages/shop/ShopUser'))

/** 动态更新页面 title 和 meta description */
function MetaUpdater() {
  const location = useLocation()

  useEffect(() => {
    const meta = PAGE_META[location.pathname]
    if (meta) {
      document.title = meta.title
      const updateMeta = (sel: string, attr: string, val: string) => {
        const el = document.querySelector(sel)
        if (el) el.setAttribute(attr, val)
      }
      updateMeta('meta[name="description"]', 'content', meta.description)
      updateMeta('meta[property="og:title"]', 'content', meta.title)
      updateMeta('meta[property="og:description"]', 'content', meta.description)
      updateMeta('meta[property="og:url"]', 'content', window.location.href)
      updateMeta('meta[name="twitter:title"]', 'content', meta.title)
      updateMeta('meta[name="twitter:description"]', 'content', meta.description)
    }
  }, [location.pathname])

  return null
}

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-bg">
      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-ai-start to-ai-glow animate-pulse" />
    </div>
  )
}

export default function App() {
  const location = useLocation()
  const isLandingPage = location.pathname.startsWith('/r/') || location.pathname === '/download' || location.pathname === '/resolve'
  const isShopPage = location.pathname === '/shop' || location.pathname.startsWith('/shop/')

  return (
    <>
      <MetaUpdater />
      {!isLandingPage && !isShopPage && <Navbar />}
      <main id="main-content">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/products" element={<Products />} />
            <Route path="/ai" element={<AiTech />} />
            <Route path="/about" element={<About />} />
            <Route path="/merchants" element={<Merchants />} />
            <Route path="/merchants/apply" element={<MerchantApply />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/r/:code" element={<Download />} />
            <Route path="/download" element={<Download />} />
            <Route path="/resolve" element={<Resolve />} />
            {/* 商城路由（嵌套在 ShopLayout 下） */}
            <Route path="/shop" element={<ShopLayout />}>
              <Route index element={<ShopHome />} />
              <Route path="category/:id" element={<ShopCategory />} />
              <Route path="product/:id" element={<ShopProduct />} />
              <Route path="cart" element={<ShopCart />} />
              <Route path="checkout" element={<ShopCheckout />} />
              <Route path="user" element={<ShopUser />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      {!isLandingPage && !isShopPage && <Footer />}
    </>
  )
}
