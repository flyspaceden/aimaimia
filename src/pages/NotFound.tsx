import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import HeroOrb from '@/components/effects/HeroOrb'
import Button from '@/components/ui/Button'

export default function NotFound() {
  const navigate = useNavigate()
  const [countdown, setCountdown] = useState(5)
  const [cancelled, setCancelled] = useState(false)

  useEffect(() => {
    if (cancelled) return

    if (countdown <= 0) {
      navigate('/')
      return
    }

    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown, cancelled, navigate])

  return (
    <section className="min-h-screen flex items-center justify-center bg-dark-bg">
      <div className="text-center px-6">
        <HeroOrb size={100} className="mx-auto mb-8" />
        <h1 className="text-h1-mobile md:text-h1 text-text-on-dark mb-4">页面未找到</h1>
        <p className="text-text-on-dark-secondary mb-8">
          您访问的页面不存在或已被移除
        </p>
        <Button onClick={() => navigate('/')}>返回首页</Button>
        {!cancelled && (
          <p className="mt-4 text-text-on-dark-tertiary text-sm">
            {countdown} 秒后自动跳转...
            <button className="ml-2 text-ai-end underline" onClick={() => setCancelled(true)}>
              取消
            </button>
          </p>
        )}
      </div>
    </section>
  )
}
