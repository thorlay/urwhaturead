import { useMemo, type RefObject } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FeedBriefingInputItem, FeedItem } from '../types'
import type { SummaryTaskStatus } from '../lib/app-domain'
import { useReaderFeedScroll } from '../hooks/use-reader-feed-scroll'
import { ReaderFeedArticleCard } from './reader-feed-article-card'
import { ReaderFeedBriefingCard } from './reader-feed-briefing-card'
import { ReaderFeedViewport } from './reader-feed-viewport'

type FeedListRow = { key: string; type: 'briefing' } | { key: string; type: 'article'; item: FeedItem }

export type ReaderFeedListProps = {
  showFloatingReader: boolean
  readerView: 'stream' | 'detail'
  feedMode: 'all' | 'important'
  feedTitleOnlyMode: boolean
  showFeedImages: boolean
  unreadOnly: boolean
  favoriteOnly: boolean
  sourceFilter: string
  formatTimeAgo: (input: string) => string
  loadingFeed: boolean
  feedError: string | null
  feed: FeedItem[]
  visibleFeed: FeedItem[]
  hasFeedBriefingEntry: boolean
  feedBriefingInsertIndex: number
  selectedArticleID: number | null
  selectedFeedBriefing: boolean
  readArticleIDSet: Set<number>
  favoriteArticleIDSet: Set<number>
  feedAutoLoadRef: RefObject<HTMLDivElement | null>
  hasMoreFeed: boolean
  feedBriefingPreviewText: string
  feedBriefingScopeLabel: string
  feedBriefingFreshnessLabel: string
  feedBriefingNewArticleCount: number
  feedBriefingArticleCount: number
  feedBriefingItems: FeedBriefingInputItem[]
  onRetryLoadFeed: () => Promise<void>
  onOpenArticle: (articleID: number) => Promise<void>
  onToggleFavoriteArticle: (articleID: number) => void
  onOpenFeedBriefing: () => void
  onLoadMore: () => void
  normalizeImageURL: (rawURL?: string) => string | null
  formatTimeAgoCompact: (input: string) => string
  formatReplyCount: (value?: number) => string
  buildCompactTitleParts: (title: string, summary?: string) => { title: string; summary: string }
  plainText: (input?: string) => string
  truncate: (input: string, size: number) => string
  getSummaryTaskStatus: (articleID: number) => SummaryTaskStatus | null
  summaryTaskStatusLabel: (status: SummaryTaskStatus) => string
}

export function ReaderFeedList(props: ReaderFeedListProps) {
  const {
    showFloatingReader,
    readerView,
    feedTitleOnlyMode,
    showFeedImages,
    unreadOnly,
    favoriteOnly,
    sourceFilter,
    loadingFeed,
    feedError,
    feed,
    visibleFeed,
    hasFeedBriefingEntry,
    feedBriefingInsertIndex,
    selectedArticleID,
    selectedFeedBriefing,
    readArticleIDSet,
    favoriteArticleIDSet,
    feedAutoLoadRef,
    hasMoreFeed,
    feedBriefingPreviewText,
    feedBriefingScopeLabel,
    feedBriefingFreshnessLabel,
    feedBriefingNewArticleCount,
    feedBriefingArticleCount,
    feedBriefingItems,
    onRetryLoadFeed,
    onOpenArticle,
    onToggleFavoriteArticle,
    onOpenFeedBriefing,
    onLoadMore,
    normalizeImageURL,
    formatTimeAgo,
    formatTimeAgoCompact,
    formatReplyCount,
    buildCompactTitleParts,
    plainText,
    truncate,
    getSummaryTaskStatus,
    summaryTaskStatusLabel,
    feedMode,
  } = props

  const listRows = useMemo<FeedListRow[]>(() => {
    const rows: FeedListRow[] = []
    const briefingIndex = Math.max(0, Math.min(feedBriefingInsertIndex, visibleFeed.length))
    for (let index = 0; index <= visibleFeed.length; index += 1) {
      if (feedMode === 'all' && hasFeedBriefingEntry && index === briefingIndex) {
        rows.push({ key: 'feed-briefing', type: 'briefing' })
      }
      if (index < visibleFeed.length) {
        const item = visibleFeed[index]
        rows.push({ key: `feed-row-${item.id}`, type: 'article', item })
      }
    }
    return rows
  }, [feedMode, feedBriefingInsertIndex, hasFeedBriefingEntry, visibleFeed])
  const {
    feedListRef,
    shouldVirtualizeFeed,
    virtualStart,
    virtualEnd,
    virtualTopSpacer,
    virtualBottomSpacer,
  } = useReaderFeedScroll({
    rowCount: listRows.length,
    feedTitleOnlyMode,
    showFeedImages,
  })
  const renderedRows = shouldVirtualizeFeed ? listRows.slice(virtualStart, virtualEnd) : listRows
  const isInitialFeedLoading = loadingFeed && feed.length === 0
  const emptyFeedMessage = feedMode === 'important' && !favoriteOnly && !unreadOnly
    ? '当前范围暂无 AI 推荐。可先生成来源速览，或切换到全部文章；不会为凑数推荐普通文章。'
    : favoriteOnly
    ? '还没有收藏文章。点击文章旁边的星标后会出现在这里。'
    : unreadOnly
      ? '当前没有未读文章。'
      : feed.length > 0
        ? '当前筛选下没有文章，可清空筛选或恢复隐藏的网站。'
        : '暂无文章'

  return (
    <ReaderFeedViewport
      listRef={feedListRef}
      className={cn('feed-list', isInitialFeedLoading && 'is-loading', shouldVirtualizeFeed && 'is-virtualized')}
      split={showFloatingReader && readerView === 'stream'}
      selection={selectedFeedBriefing ? 'briefing' : selectedArticleID?.toString() ?? null}
    >
      {isInitialFeedLoading && visibleFeed.length === 0 && (feedMode === 'important' || !hasFeedBriefingEntry) && (
        <>
          <FeedSkeleton />
          <FeedSkeleton />
          <FeedSkeleton />
        </>
      )}

      {feedError && feed.length === 0 && visibleFeed.length === 0 && (feedMode === 'important' || !hasFeedBriefingEntry) && (
        <div className="inline-error">
          <span>聚合流加载失败: {feedError}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void onRetryLoadFeed()}>
            <RotateCcw aria-hidden="true" />
            重试
          </Button>
        </div>
      )}

      {!isInitialFeedLoading && !feedError && visibleFeed.length === 0 && (feedMode === 'important' || !hasFeedBriefingEntry) && (
        <p className="hint">{emptyFeedMessage}</p>
      )}

      {virtualTopSpacer > 0 && <div className="feed-list-spacer" style={{ height: virtualTopSpacer }} aria-hidden="true" />}

      {renderedRows.map((row) => {
        if (row.type === 'briefing') {
          return (
            <ReaderFeedBriefingCard
              key={row.key}
              itemKey={row.key}
              selectedFeedBriefing={selectedFeedBriefing}
              feedTitleOnlyMode={feedTitleOnlyMode}
              feedBriefingPreviewText={feedBriefingPreviewText}
              feedBriefingScopeLabel={feedBriefingScopeLabel}
              feedBriefingFreshnessLabel={feedBriefingFreshnessLabel}
              feedBriefingNewArticleCount={feedBriefingNewArticleCount}
              feedBriefingArticleCount={feedBriefingArticleCount}
              feedBriefingItemsCount={feedBriefingItems.length}
              onOpenFeedBriefing={onOpenFeedBriefing}
            />
          )
        }

        const summaryTaskStatus = getSummaryTaskStatus(row.item.id)
        return (
          <ReaderFeedArticleCard
            key={row.key}
            item={row.item}
            hideSourceName={/^\d+$/.test(sourceFilter)}
            isActive={selectedArticleID === row.item.id && !selectedFeedBriefing}
            isRead={readArticleIDSet.has(row.item.id)}
            isFavorite={favoriteArticleIDSet.has(row.item.id)}
            feedTitleOnlyMode={feedTitleOnlyMode}
            showFeedImages={showFeedImages}
            summaryTaskStatus={summaryTaskStatus}
            summaryTaskStatusLabel={summaryTaskStatusLabel}
            onOpenArticle={onOpenArticle}
            onToggleFavoriteArticle={onToggleFavoriteArticle}
            normalizeImageURL={normalizeImageURL}
            formatTimeAgo={formatTimeAgo}
            formatTimeAgoCompact={formatTimeAgoCompact}
            formatReplyCount={formatReplyCount}
            buildCompactTitleParts={buildCompactTitleParts}
            plainText={plainText}
            truncate={truncate}
          />
        )
      })}

      {virtualBottomSpacer > 0 && (
        <div className="feed-list-spacer" style={{ height: virtualBottomSpacer }} aria-hidden="true" />
      )}

      <div ref={feedAutoLoadRef} className="feed-auto-load-sentinel" aria-hidden="true" />
      {hasMoreFeed && (
        <div className="feed-footer">
          <span role="status" className="sr-only">
            {loadingFeed ? '正在加载更多文章' : feedError ? '加载失败，可以重试' : ''}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="feed-load-more-button"
            onClick={feedError ? () => void onRetryLoadFeed() : onLoadMore}
            disabled={loadingFeed}
          >
            {loadingFeed ? '正在加载…' : feedError ? '重试' : '加载更多'}
          </Button>
        </div>
      )}
    </ReaderFeedViewport>
  )
}

function FeedSkeleton() {
  return (
    <article className="feed-item">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line short" />
    </article>
  )
}
