import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export { gsap, ScrollTrigger }

/** 批量注册淡入上移动画 */
export function initScrollReveal(selector: string = '.reveal') {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // 直接显示，不动画
    gsap.set(selector, { opacity: 1, y: 0 })
    return
  }

  gsap.utils.toArray<HTMLElement>(selector).forEach((el) => {
    gsap.fromTo(
      el,
      { opacity: 0, y: 40 },
      {
        opacity: 1,
        y: 0,
        duration: 0.8,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 85%',
          once: true,
        },
      },
    )
  })
}

/** 数字递增动画 */
export function animateCountUp(el: HTMLElement, target: number, suffix: string = '') {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = target.toLocaleString() + suffix
    return
  }

  const obj = { val: 0 }
  gsap.to(obj, {
    val: target,
    duration: 2,
    ease: 'power1.out',
    scrollTrigger: {
      trigger: el,
      start: 'top 80%',
      once: true,
    },
    onUpdate: () => {
      el.textContent = Math.round(obj.val).toLocaleString() + suffix
    },
  })
}
