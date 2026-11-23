import { memo } from 'react'
import { cn } from '@/lib/utils'

type ReaderFeedBriefingCardProps = {
  itemKey: string
  selectedFeedBriefing: boolean
  feedTitleOnlyMode: boolean
  feedBriefingPreviewText: string
  feedBriefingScopeLabel: string
  feedBriefingFreshnessLabel: string
  feedBriefingNewArticleCount: number
  feedBriefingArticleCount: number
  feedBriefingItemsCount: number
  onOpenFeedBriefing: () => void
}

export const ReaderFeedBriefingCard = memo(function ReaderFeedBriefingCard(props: ReaderFeedBriefingCardProps) {
  const {
    itemKey,
    selectedFeedBriefing,
    feedTitleOnlyMode,
    feedBriefingPreviewText,
    feedBriefingScopeLabel,
    feedBriefingFreshnessLabel,
    feedBriefingNewArticleCount,
    feedBriefingArticleCount,
    feedBriefingItemsCount,
    onOpenFeedBriefing,
  } = props

  return (
    <article
      key={itemKey}
      className={cn('feed-item', 'feed-item-briefing', selectedFeedBriefing && 'active')}
      onClick={onOpenFeedBriefing}
    >
      <div className="feed-item-body">
        <div className="feed-item-content">
          {feedTitleOnlyMode ? (
            <div className="feed-item-compact-row">
              <h3 className="feed-item-title">
                <span className="feed-item-inline-title">AI 聚合速览</span>
                {feedBriefingPreviewText && (
                  <>
                    <span className="feed-item-inline-sep" aria-hidden="true">
                      {' '}
                      ·{' '}
                    </span>
                    <span className="feed-item-inline-summary">{feedBriefingPreviewText}</span>
                  </>
                )}
              </h3>
              <div className="feed-item-compact-meta">
                <span className="feed-source feed-item-compact-source">{feedBriefingScopeLabel || '当前阅读流'}</span>
                {feedBriefingFreshnessLabel && (
                  <>
                    <span className="feed-sep">·</span>
                    <span>{feedBriefingFreshnessLabel}</span>
                  </>
                )}
                {feedBriefingNewArticleCount > 0 && (
                  <>
                    <span className="feed-sep">·</span>
                    <span className="feed-briefing-stale">新增 {feedBriefingNewArticleCount}</span>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="feed-topline">
                <span className="feed-source">AI 聚合速览</span>
                <span className="feed-sep">·</span>
                <span>{feedBriefingScopeLabel || '当前阅读流'}</span>
                {feedBriefingFreshnessLabel && (
                  <>
                    <span className="feed-sep">·</span>
                    <span>{feedBriefingFreshnessLabel}</span>
                  </>
                )}
                <span className="feed-sep">·</span>
                <span>{feedBriefingArticleCount || feedBriefingItemsCount || 0} 篇</span>
                {feedBriefingNewArticleCount > 0 && (
                  <>
                    <span className="feed-sep">·</span>
                    <span className="feed-briefing-stale">速览后新增 {feedBriefingNewArticleCount} 条</span>
                  </>
                )}
              </div>
              <h3 className="feed-item-title">AI 聚合速览</h3>
              <p className="feed-item-summary">{feedBriefingPreviewText}</p>
            </>
          )}
        </div>
      </div>
    </article>
  )
})
