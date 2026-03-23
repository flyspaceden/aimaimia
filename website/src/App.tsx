import { lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { PAGE_META } from '@/lib/constants'

const Home = lazy(() => import('@/pages/Home'))
const Products = lazy(() => import('@/pages/Products'))
const AiTech = lazy(() => import('@/pages/AiTech'))
const About = lazy(() => import('@/pages/About'))
const Merchants = lazy(() => import('@/pages/Merchants'))
const Contact = lazy(() => import('@/pages/Contact'))
const NotFound = lazy(() => import('@/pages/NotFound'))

/** 动态更新页面 title 和 meta description */
function MetaUpdater() {
  const location = useLocation()

  useEffect(() => {
    const meta = PAGE_META[location.pathname]
    if (meta) {
      document.title = meta.title
      const desc = document.querySelector('meta[name="description"]')
      if (desc) desc.setAttribute('content', meta.description)
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
  return (
    <>
      <MetaUpdater />
      <Navbar />
      <main id="main-content">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/products" element={<Products />} />
            <Route path="/ai" element={<AiTech />} />
            <Route path="/about" element={<About />} />
            <Route path="/merchants" element={<Merchants />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </>
  )
}
