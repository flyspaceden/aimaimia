import { useEffect, useRef, type ReactNode } from 'react'
import { gsap, ScrollTrigger } from '@/lib/animations'
import { useReducedMotion } from '@/lib/useReducedMotion'

interface Props {
  children: ReactNode
  className?: string
  delay?: number
}

export default function ScrollReveal({ children, className = '', delay = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || reduced) return

    gsap.fromTo(
      el,
      { opacity: 0, y: 40 },
      {
        opacity: 1,
        y: 0,
        duration: 0.8,
        delay,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 85%',
          once: true,
        },
      },
    )

    return () => {
      ScrollTrigger.getAll().forEach(t => {
        if (t.trigger === el) t.kill()
      })
    }
  }, [delay, reduced])

  return (
    <div ref={ref} className={className} style={reduced ? undefined : { opacity: 0 }}>
      {children}
    </div>
  )
}
