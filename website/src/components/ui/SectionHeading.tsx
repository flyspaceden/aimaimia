interface Props {
  title: string
  subtitle?: string
  light?: boolean
  className?: string
}

export default function SectionHeading({ title, subtitle, light = true, className = '' }: Props) {
  return (
    <div className={`text-center mb-12 md:mb-16 ${className}`}>
      <h2 className={`text-h2-mobile md:text-h2 ${light ? 'text-text-primary' : 'text-text-on-dark'}`}>
        {title}
      </h2>
      {subtitle && (
        <p className={`mt-4 text-lg max-w-2xl mx-auto ${light ? 'text-text-secondary' : 'text-text-on-dark-secondary'}`}>
          {subtitle}
        </p>
      )}
      <div className="mt-6 mx-auto w-16 h-0.5 bg-gradient-to-r from-brand via-ai-start to-ai-end rounded-full" />
    </div>
  )
}
