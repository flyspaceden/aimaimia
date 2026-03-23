import { useEffect, useRef } from 'react'
import { animateCountUp } from '@/lib/animations'

interface Props {
  target: number
  suffix?: string
  className?: string
}

export default function CountUp({ target, suffix = '', className = '' }: Props) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (ref.current) {
      animateCountUp(ref.current, target, suffix)
    }
  }, [target, suffix])

  return <span ref={ref} className={className}>0</span>
}
