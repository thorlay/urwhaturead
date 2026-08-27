import { ExternalLink, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PlainTextBlock, SafeHTMLBlock } from '@/components/rich-content-blocks'
import { normalizeImageURL } from '../../lib/app-utils'
import type { ArticleDetail } from '../../types'

type AIArticleReaderProps = {
  article: ArticleDetail | null
  loading: boolean
  error: string | null
  formatTimeAgo: (input: string) => string
  onClose: () => void
  isFavorite: boolean
  onToggleFavorite: (articleID: number) => void
}

export function AIArticleReader(props: AIArticleReaderProps) {
  const { article, loading, error, formatTimeAgo, onClose, isFavorite, onToggleFavorite } = props
  const imageURL = normalizeImageURL(article?.image_url)
  const hasExternal = Boolean(article?.external?.content?.trim())
  const threadComments = article?.thread?.comments ?? []

  if (!loading && !error && !article) return null

  return (
    <div className="ai-article-reader-shell" role="dialog" aria-modal="true" aria-label="文章阅读">
      <div className="ai-article-reader-backdrop" onClick={onClose} />
      <article className="ai-article-reader-panel">
        <header className="ai-article-reader-top">
          <Button type="button" variant="ghost" className="ai-article-reader-close" onClick={onClose}>
            <X aria-hidden="true" />
            返回简报
          </Button>
          <div className="ai-article-reader-actions">
            {article && (
              <Button
                type="button"
                variant="ghost"
                className={`ai-article-reader-favorite ${isFavorite ? 'active' : ''}`}
                aria-label={isFavorite ? '取消收藏' : '收藏文章'}
                aria-pressed={isFavorite}
                onClick={() => onToggleFavorite(article.id)}
              >
                <Star aria-hidden="true" fill={isFavorite ? 'currentColor' : 'none'} />
                {isFavorite ? '已收藏' : '收藏'}
              </Button>
            )}
            {article?.link && (
              <Button asChild variant="ghost">
                <a className="ai-article-reader-source-link" href={article.link} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
                  原文
                </a>
              </Button>
            )}
          </div>
        </header>

        {loading && (
          <div className="ai-article-reader-loading" aria-label="正在加载文章">
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
          </div>
        )}

        {error && !loading && <div className="inline-error">{error}</div>}

        {article && !loading && (
          <div className="ai-article-reader-content">
            <header className="ai-article-reader-heading">
              <p className="ai-article-reader-meta">
                {article.source_name} · {formatTimeAgo(article.published_at ?? article.created_at)}
                {article.reply_count ? ` · ${article.reply_count} 回复` : ''}
              </p>
              <h2>{article.title}</h2>
              {article.author && <p className="hint">作者：{article.author}</p>}
            </header>

            {imageURL && (
              <figure className="ai-article-reader-image">
                <img src={imageURL} alt="" loading="eager" decoding="async" referrerPolicy="no-referrer" />
              </figure>
            )}

            <section className="ai-article-reader-body">
              {hasExternal && article.external ? (
                <>
                  {article.external.title && <p className="hint">{article.external.title}</p>}
                  <PlainTextBlock content={article.external.content} className="reading-block prose" />
                  {article.external.truncated && <p className="hint">原文较长，已截断显示。</p>}
                </>
              ) : article.content_html ? (
                <SafeHTMLBlock content={article.content_html} baseURL={article.link} />
              ) : article.content ? (
                <PlainTextBlock content={article.content} className="reading-block prose" />
              ) : article.summary ? (
                <PlainTextBlock content={article.summary} className="reading-block prose" />
              ) : (
                <p className="hint">这篇文章暂时没有可展示正文。</p>
              )}
            </section>

            {threadComments.length > 0 && (
              <section className="ai-article-reader-comments">
                <div className="ai-article-reader-section-head">
                  <h3>讨论</h3>
                  <span className="hint">{article.thread?.total_posts ?? threadComments.length} 条</span>
                </div>
                <div className="ai-article-reader-comment-list">
                  {threadComments.slice(0, 30).map((comment) => (
                    <div key={`${comment.post_number}-${comment.link}`} className="ai-article-reader-comment">
                      <p className="ai-article-reader-comment-meta">
                        {comment.author || '匿名'} · #{comment.post_number}
                        {comment.published_at ? ` · ${formatTimeAgo(comment.published_at)}` : ''}
                      </p>
                      <PlainTextBlock content={comment.content} />
                    </div>
                  ))}
                </div>
                {threadComments.length > 30 && <p className="hint">评论较多，仅展示前 30 条。</p>}
              </section>
            )}
          </div>
        )}
      </article>
    </div>
  )
}
