import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import type { LegalBlock, LegalDocument } from '@/content/legal/types'

interface LegalDocumentViewProps {
  doc: LegalDocument
}

function renderBlock(block: LegalBlock, idx: number) {
  switch (block.type) {
    case 'p':
      return (
        <p key={idx} className="text-text-secondary leading-relaxed mb-3">
          {block.text}
        </p>
      )
    case 'strong':
      return (
        <p key={idx} className="text-text-primary font-semibold leading-relaxed mb-3 bg-light-soft border-l-4 border-brand px-4 py-3 rounded-r">
          {block.text}
        </p>
      )
    case 'bullet':
      return (
        <div key={idx} className="flex gap-2 text-text-secondary leading-relaxed mb-2 pl-2">
          <span className="text-brand mt-1 flex-shrink-0">•</span>
          <span className="flex-1">{block.text}</span>
        </div>
      )
    case 'note':
      return (
        <h4 key={idx} className="text-text-primary font-semibold mt-6 mb-3 text-base">
          {block.text}
        </h4>
      )
    default:
      return null
  }
}

export default function LegalDocumentView({ doc }: LegalDocumentViewProps) {
  const location = useLocation()

  useEffect(() => {
    if (location.hash) {
      const id = location.hash.slice(1)
      const el = document.getElementById(id)
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
      }
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
  }, [location.pathname, location.hash])

  return (
    <article className="bg-light-bg min-h-screen">
      <header className="bg-gradient-to-br from-brand-dark to-brand text-white pt-32 pb-16">
        <div className="max-w-page mx-auto px-6">
          <h1 className="text-h1-mobile md:text-h1 mb-3">{doc.title}</h1>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-white/80">
            <span>版本：{doc.version}</span>
            <span>发布日期：{doc.publishedAt}</span>
            <span>生效日期：{doc.effectiveAt}</span>
          </div>
        </div>
      </header>

      <div className="max-w-page mx-auto px-6 py-12">
        <div className="grid md:grid-cols-[240px_1fr] gap-10">
          <aside className="hidden md:block">
            <div className="sticky top-24">
              <h2 className="text-text-tertiary text-xs uppercase tracking-wider mb-3">目录</h2>
              <nav className="space-y-1">
                {doc.sections.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className="block text-sm text-text-secondary hover:text-brand transition-colors py-1"
                  >
                    {s.title}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          <main className="min-w-0">
            {doc.summary.length > 0 && (
              <section className="mb-10 bg-white rounded-card shadow-card p-6">
                <h2 className="text-text-primary font-semibold mb-3">导读</h2>
                {doc.summary.map((line, i) => (
                  <p key={i} className="text-text-secondary leading-relaxed mb-3 last:mb-0">
                    {line}
                  </p>
                ))}
              </section>
            )}

            {doc.sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="mb-10 scroll-mt-24"
              >
                <h2 className="text-h3-mobile md:text-h3 text-text-primary mb-4 pb-2 border-b border-light-soft">
                  {section.title}
                </h2>
                <div className="space-y-1">
                  {section.blocks.map((block, idx) => renderBlock(block, idx))}
                </div>
              </section>
            ))}

            <footer className="mt-16 pt-8 border-t border-light-soft text-sm text-text-tertiary">
              <p>本文档由深圳华海农业科技集团有限公司发布。</p>
              <p className="mt-1">如对本文档有任何疑问，请通过文档中提供的联系方式与我们联系。</p>
            </footer>
          </main>
        </div>
      </div>
    </article>
  )
}
