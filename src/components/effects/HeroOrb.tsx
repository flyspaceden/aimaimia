import { useEffect, useRef } from 'react'
import { gsap } from '@/lib/animations'
import { useReducedMotion } from '@/lib/useReducedMotion'

interface Props {
  size?: number
  className?: string
}

export default function HeroOrb({ size = 200, className = '' }: Props) {
  const orbRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const orb = orbRef.current
    if (!orb || reduced) return

    // 呼吸动画
    const breathe = gsap.to(orb, {
      scale: 1.05,
      duration: 3,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    })

    // 鼠标跟随（仅桌面端）
    const isMobile = window.innerWidth < 768
    let moveX: gsap.QuickToFunc | undefined
    let moveY: gsap.QuickToFunc | undefined

    if (!isMobile) {
      moveX = gsap.quickTo(orb, 'x', { duration: 0.3, ease: 'power2.out' })
      moveY = gsap.quickTo(orb, 'y', { duration: 0.3, ease: 'power2.out' })

      const handleMouse = (e: MouseEvent) => {
        const rect = orb.parentElement?.getBoundingClientRect()
        if (!rect) return
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const dx = ((e.clientX - cx) / rect.width) * 30
        const dy = ((e.clientY - cy) / rect.height) * 30
        moveX!(dx)
        moveY!(dy)
      }

      window.addEventListener('mousemove', handleMouse)
      return () => {
        breathe.kill()
        window.removeEventListener('mousemove', handleMouse)
      }
    }

    return () => breathe.kill()
  }, [reduced])

  return (
    <div
      ref={orbRef}
      className={`relative ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label="AI 智能光球"
    >
      {/* 外层光晕 */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(0,229,204,0.2) 0%, transparent 70%)',
          filter: 'blur(60px)',
          transform: 'scale(1.5)',
        }}
      />
      {/* 主球体 */}
      <div
        className="absolute inset-0 rounded-full shadow-ai-glow"
        style={{
          background: 'radial-gradient(circle at 40% 35%, #00E5CC 0%, #00BFA5 30%, #00897B 60%, transparent 80%)',
        }}
      />
      {/* 内核高光 */}
      <div
        className="absolute rounded-full"
        style={{
          width: size * 0.15,
          height: size * 0.15,
          top: '30%',
          left: '35%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.8) 0%, transparent 70%)',
        }}
      />
    </div>
  )
}
