import { useMemo } from 'react'
import { PlainTextBlock, SafeHTMLBlock } from '@/components/rich-content-blocks'
import { readingBodyHasImages } from '@/lib/reading-images'
import type { ArticleDetail } from '../types'

export type ReaderArticleBodyProps = {
  selectedArticle: ArticleDetail
  isThreadArticle: boolean
  threadPrimaryBody: string
}

export function ReaderArticleBody({ selectedArticle, isThreadArticle, threadPrimaryBody }: ReaderArticleBodyProps) {
  const hasCapturedExternal = Boolean(selectedArticle.external?.content)

  return (
    <section className="detail-section detail-reading-section">
      {isThreadArticle && threadPrimaryBody ? (
        <PlainTextBlock content={threadPrimaryBody} className="reading-block prose" />
      ) : hasCapturedExternal && selectedArticle.external?.content ? (
        <>
          <PlainTextBlock content={selectedArticle.external.content} className="reading-block prose" />
          {selectedArticle.external.truncated && <p className="hint">原文较长，已截断显示。</p>}
        </>
      ) : selectedArticle.content_html ? (
        <SafeHTMLBlock content={selectedArticle.content_html} baseURL={selectedArticle.link} />
      ) : selectedArticle.content ? (
        <PlainTextBlock content={selectedArticle.content} className="reading-block prose" />
      ) : selectedArticle.summary ? (
        <PlainTextBlock content={selectedArticle.summary} className="reading-block" />
      ) : (
        <p className="hint">暂无可展示正文。</p>
      )}
    </section>
  )
}

export function ReaderArticleCover({
  selectedArticle,
  isThreadArticle,
  threadPrimaryBody,
  selectedArticleImageURL,
}: ReaderArticleBodyProps & { selectedArticleImageURL: string | null }) {
  const bodyHasImages = useMemo(() => {
    if (isThreadArticle && threadPrimaryBody) return readingBodyHasImages(threadPrimaryBody)
    if (selectedArticle.external?.content) return readingBodyHasImages(selectedArticle.external.content)
    if (selectedArticle.content_html) return readingBodyHasImages(selectedArticle.content_html, true, selectedArticle.link)
    return readingBodyHasImages(selectedArticle.content || selectedArticle.summary)
  }, [selectedArticle, isThreadArticle, threadPrimaryBody])

  if (!selectedArticleImageURL || bodyHasImages) return null

  return (
    <figure className="detail-hero-image">
      <img
        src={selectedArticleImageURL}
        alt=""
        loading="eager"
        fetchPriority="high"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={(event) => {
          const target = event.currentTarget
          const wrapper = target.parentElement
          target.style.display = 'none'
          if (wrapper) {
            wrapper.style.display = 'none'
          }
        }}
      />
    </figure>
  )
}
