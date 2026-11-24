import { memo, useCallback, useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SummaryTaskStatus } from '../lib/app-domain'
import type { FeedItem } from '../types'

const preloadedArticleImageURLs = new Set<string>()

function preloadArticleImage(url: string | null) {
  if (!url || preloadedArticleImageURLs.has(url) || typeof window === 'undefined') {
    return
  }
  preloadedArticleImageURLs.add(url)
  const image = new Image()
  image.decoding = 'async'
  image.referrerPolicy = 'no-referrer'
  image.src = url
}

type ReaderFeedArticleCardProps = {
  hideSourceName: boolean
  item: FeedItem
  isActive: boolean
  isRead: boolean
  isFavorite: boolean
  feedTitleOnlyMode: boolean
  showFeedImages: boolean
  summaryTaskStatus: SummaryTaskStatus | null
  summaryTaskStatusLabel: (status: SummaryTaskStatus) => string
  onOpenArticle: (articleID: number) => Promise<void>
  onToggleFavoriteArticle: (articleID: number) => void
  normalizeImageURL: (rawURL?: string) => string | null
  formatTimeAgo: (input: string) => string
  formatTimeAgoCompact: (input: string) => string
  formatReplyCount: (value?: number) => string
  buildCompactTitleParts: (title: string, summary?: string) => { title: string; summary: string }
  plainText: (input?: string) => string
  truncate: (input: string, size: number) => string
}

export const ReaderFeedArticleCard = memo(
  function ReaderFeedArticleCard(props: ReaderFeedArticleCardProps) {
    const {
      hideSourceName,
      item,
      isActive,
      isRead,
      isFavorite,
      feedTitleOnlyMode,
      showFeedImages,
      summaryTaskStatus,
      summaryTaskStatusLabel,
      onOpenArticle,
      onToggleFavoriteArticle,
      normalizeImageURL,
      formatTimeAgo,
      formatTimeAgoCompact,
      formatReplyCount,
      buildCompactTitleParts,
      plainText,
      truncate,
    } = props

    const previewImageURL = useMemo(() => normalizeImageURL(item.image_url), [item.image_url, normalizeImageURL])
    const publishedLabel = useMemo(
      () => formatTimeAgo(item.forum_activity_at ?? item.published_at ?? item.created_at),
      [formatTimeAgo, item.created_at, item.forum_activity_at, item.published_at],
    )
    const compactPublishedLabel = useMemo(
      () => formatTimeAgoCompact(item.forum_activity_at ?? item.published_at ?? item.created_at),
      [formatTimeAgoCompact, item.created_at, item.forum_activity_at, item.published_at],
    )
    const replyCountText = useMemo(() => {
      if (item.paper_votes != null) return `社区赞 ${item.paper_votes}`
      if (item.recent_reply_count != null) return `近 24h 回复 ${item.recent_reply_count}`
      return formatReplyCount(item.reply_count)
    }, [formatReplyCount, item.paper_votes, item.recent_reply_count, item.reply_count])
    const plainSummaryText = useMemo(() => plainText(item.summary), [item.summary, plainText])
    const compactPreviewText = useMemo(() => {
      if (item.highlight_reason) return `入选理由：${item.highlight_reason}`
      const summary = plainText(item.summary)
      if (summary) {
        return summary
      }
      return plainText(item.content)
    }, [item.content, item.summary, item.highlight_reason, plainText])
    const isShortSummary = plainSummaryText.length > 0 && plainSummaryText.length <= 72
    const duplicateCountText =
      typeof item.duplicate_count === 'number' && item.duplicate_count > 1 ? `+${item.duplicate_count - 1}关联` : ''
    const compactTitleParts = useMemo(
      () => buildCompactTitleParts(item.title, compactPreviewText),
      [buildCompactTitleParts, compactPreviewText, item.title],
    )

    const handleOpen = useCallback(() => {
      preloadArticleImage(previewImageURL)
      void onOpenArticle(item.id)
    }, [item.id, onOpenArticle, previewImageURL])

    const handleToggleFavorite = useCallback(
      (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        event.stopPropagation()
        onToggleFavoriteArticle(item.id)
      },
      [item.id, onToggleFavoriteArticle],
    )

    return (
      <article
        data-feed-row={item.id}
        className={cn('feed-item', isActive && 'active', isRead && 'read', isFavorite && 'favorited')}
        onClick={handleOpen}
        onPointerEnter={() => preloadArticleImage(previewImageURL)}
        onFocusCapture={() => preloadArticleImage(previewImageURL)}
      >
        <div className="feed-item-body">
          <div className="feed-item-content">
            {feedTitleOnlyMode ? (
              <div className="feed-item-compact-row">
                <h3 className={cn('feed-item-title', item.highlight_reason && 'has-highlight')} title={item.title}>
                  <span className="feed-item-inline-title">{compactTitleParts.title || item.title}</span>
                  {(item.highlight_reason || compactTitleParts.summary) && (
                    <>
                      <span className="feed-item-inline-sep" aria-hidden="true">
                        {' '}
                        ·{' '}
                      </span>
                      <span className={cn("feed-item-inline-summary", item.highlight_reason && "feed-highlight-reason")} title={item.highlight_reason}>{item.highlight_reason ? `入选理由：${item.highlight_reason}` : compactTitleParts.summary}</span>
                    </>
                  )}
                </h3>
                <div className="feed-item-compact-meta">
                  <span className="feed-item-compact-time">{compactPublishedLabel}</span>
                  {!hideSourceName && <span className="feed-item-compact-source">{item.source_name}</span>}
                  <button
                    type="button"
                    className={cn('feed-favorite-toggle', isFavorite && 'active')}
                    aria-label={isFavorite ? '取消收藏' : '收藏文章'}
                    aria-pressed={isFavorite}
                    onClick={handleToggleFavorite}
                  >
                    <Star aria-hidden="true" fill={isFavorite ? 'currentColor' : 'none'} />
                  </button>
                  {duplicateCountText && <span className="feed-item-compact-burst">{duplicateCountText}</span>}
                  {replyCountText && (
                    <>
                      <span>{replyCountText}</span>
                    </>
                  )}
                  {previewImageURL && <span className="feed-item-compact-flag">图</span>}
                  {summaryTaskStatus && (
                    <>
                      <span className={cn('feed-ai-status', `status-${summaryTaskStatus}`)}>
                        AI {summaryTaskStatusLabel(summaryTaskStatus)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="feed-topline">
                  {!hideSourceName && <span className="feed-source">{item.source_name}</span>}
                  <button
                    type="button"
                    className={cn('feed-favorite-toggle', 'feed-favorite-mark', isFavorite && 'active')}
                    aria-label={isFavorite ? '取消收藏' : '收藏文章'}
                    aria-pressed={isFavorite}
                    onClick={handleToggleFavorite}
                  >
                    <Star aria-hidden="true" fill={isFavorite ? 'currentColor' : 'none'} />
                    <span>{isFavorite ? '已收藏' : '收藏'}</span>
                  </button>
                  <span className="feed-sep">·</span>
                  <span>{item.source_tag}</span>
                  <span className="feed-sep">·</span>
                  <span>{publishedLabel}</span>
                  {replyCountText && (
                    <>
                      <span className="feed-sep">·</span>
                      <span>{replyCountText}</span>
                    </>
                  )}
                  {item.duplicate_count && item.duplicate_count > 1 && (
                    <>
                      <span className="feed-sep">·</span>
                      <span>相关 {item.duplicate_count} 条</span>
                    </>
                  )}
                  {summaryTaskStatus && (
                    <>
                      <span className="feed-sep">·</span>
                      <span className={cn('feed-ai-status', `status-${summaryTaskStatus}`)}>
                        AI {summaryTaskStatusLabel(summaryTaskStatus)}
                      </span>
                    </>
                  )}
                </div>
                <h3 className="feed-item-title">{item.title}</h3>
                <p className={cn('feed-item-summary', isShortSummary && 'short')}>
                  {item.highlight_reason ? `入选理由：${item.highlight_reason}` : isShortSummary ? plainSummaryText : truncate(plainSummaryText, 175)}
                </p>
              </>
            )}
          </div>
          {!feedTitleOnlyMode && showFeedImages && previewImageURL && (
            <div className="feed-item-media">
              <img
                src={previewImageURL}
                alt=""
                loading="lazy"
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
            </div>
          )}
        </div>
      </article>
    )
  },
  (prev, next) =>
    prev.item === next.item &&
    prev.isActive === next.isActive &&
    prev.isRead === next.isRead &&
    prev.isFavorite === next.isFavorite &&
    prev.feedTitleOnlyMode === next.feedTitleOnlyMode &&
    prev.showFeedImages === next.showFeedImages &&
    prev.summaryTaskStatus === next.summaryTaskStatus &&
    prev.summaryTaskStatusLabel === next.summaryTaskStatusLabel &&
    prev.onOpenArticle === next.onOpenArticle &&
    prev.onToggleFavoriteArticle === next.onToggleFavoriteArticle &&
    prev.normalizeImageURL === next.normalizeImageURL &&
    prev.formatTimeAgo === next.formatTimeAgo &&
    prev.formatTimeAgoCompact === next.formatTimeAgoCompact &&
    prev.formatReplyCount === next.formatReplyCount &&
    prev.buildCompactTitleParts === next.buildCompactTitleParts &&
    prev.plainText === next.plainText &&
    prev.truncate === next.truncate,
)
