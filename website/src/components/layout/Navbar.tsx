import { useState, useEffect, useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { NAV_LINKS } from '@/lib/constants'
import Button from '@/components/ui/Button'
import DownloadModal from '@/components/ui/DownloadModal'

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  // 路由变化关闭菜单
  useEffect(() => {
    setMenuOpen(false)
    window.scrollTo(0, 0)
  }, [location.pathname])

  // Escape 键关闭移动端菜单
  useEffect(() => {
    if (!menuOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [menuOpen])

  const toggleMenu = useCallback(() => setMenuOpen(v => !v), [])

  return (
    <>
      <a href="#main-content" className="skip-to-content">
        跳到主要内容
      </a>

      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-dark-bg/80 backdrop-blur-xl shadow-lg'
            : 'bg-transparent'
        }`}
      >
        <nav className="max-w-page mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand to-ai-end" />
            <span className="text-white font-bold text-lg">爱买买</span>
          </Link>

          {/* 桌面导航 */}
          <div className="hidden md:flex items-center gap-7">
            {NAV_LINKS.map(link => (
              <Link
                key={link.path}
                to={link.path}
                className={`text-sm transition-colors relative ${
                  location.pathname === link.path
                    ? 'text-white font-medium'
                    : 'text-text-on-dark-secondary hover:text-white'
                }`}
              >
                {link.label}
                {location.pathname === link.path && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-brand-light" />
                )}
              </Link>
            ))}
          </div>

          {/* CTA + 汉堡 */}
          <div className="flex items-center gap-4">
            <Button
              size="sm"
              className="hidden md:inline-flex"
              onClick={() => setDownloadOpen(true)}
            >
              下载 App
            </Button>

            {/* 汉堡菜单按钮 */}
            <button
              className="md:hidden text-white p-2"
              onClick={toggleMenu}
              aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
              aria-expanded={menuOpen}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {menuOpen ? (
                  <path d="M18 6L6 18M6 6l12 12" />
                ) : (
                  <path d="M3 12h18M3 6h18M3 18h18" />
                )}
              </svg>
            </button>
          </div>
        </nav>

        {/* 移动端菜单 */}
        {menuOpen && (
          <div className="md:hidden bg-dark-bg/95 backdrop-blur-xl border-t border-white/10">
            <div className="px-6 py-4 flex flex-col gap-3">
              {NAV_LINKS.map(link => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`py-2 text-base ${
                    location.pathname === link.path
                      ? 'text-white font-medium'
                      : 'text-text-on-dark-secondary'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <Button size="sm" className="mt-2" onClick={() => setDownloadOpen(true)}>
                下载 App
              </Button>
            </div>
          </div>
        )}
      </header>

      <DownloadModal open={downloadOpen} onClose={() => setDownloadOpen(false)} />
    </>
  )
}
