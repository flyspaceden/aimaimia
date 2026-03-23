import { type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'gold'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-gradient-to-r from-brand to-ai-start text-white hover:shadow-card-hover',
  secondary: 'border-2 border-brand text-brand hover:bg-brand hover:text-white',
  ghost: 'text-text-on-dark-secondary hover:text-white border border-white/20 hover:border-white/40',
  gold: 'bg-gradient-to-r from-gold to-gold-light text-white hover:shadow-card-hover',
}

const sizeClasses = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-6 py-3 text-base',
  lg: 'px-8 py-4 text-lg',
}

export default function Button({ variant = 'primary', size = 'md', className = '', children, ...rest }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-pill font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
