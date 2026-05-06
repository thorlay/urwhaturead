import { Fragment, Suspense, lazy, memo, useCallback, useMemo, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FeedBriefingInputItem, FeedItem, Source } from '../types'

const ReaderFeedFilters = lazy(async () => {
  const module = await import('@/components/reader-feed-filters')
  return { default: module.ReaderFeedFilters }
})

type FeedSummaryTaskStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'

export type ReaderFeedPanelProps = {
  showFloatingReader: boolean
  readerView: 'stream' | 'detail'
  feedTitleOnlyMode: boolean
  showFeedImages: boolean
  showFeedSearch: boolean
  showAdvancedFilters: boolean
  showFeedAIMoreMenu: boolean
  loadingFeedBriefing: boolean
  unreadVisibleCount: number
  unreadOnly: boolean
  hasActiveFilters: boolean
  keyword: string
  tagFilter: string
  sourceFilter: string
  mutedSiteKeys: string[]
  availableTags: string[]
  readerSources: Source[]
  sourceFilterSelectValue: string
  sourceFilterChipLabel: string
  loadingFeed: boolean
  feedError: string | null
  feed: FeedItem[]
  visibleFeed: FeedItem[]
  hasFeedBriefingEntry: boolean
  feedBriefingInsertIndex: number
  selectedArticleID: number | null
  selectedFeedBriefing: boolean
  readArticleIDSet: Set<number>
  feedAIMoreRef: RefObject<HTMLDivElement | null>
  feedAutoLoadRef: RefObject<HTMLDivElement | null>
  hasMoreFeed: boolean
  feedBriefingPreviewText: string
  feedBriefingScopeLabel: string
  feedBriefingFreshnessLabel: string
  feedBriefingNewArticleCount: number
  feedBriefingArticleCount: number
  feedBriefingItems: FeedBriefingInputItem[]
  onGenerateFeedBriefing: (refresh: boolean) => Promise<void>
  onCloseFeedAIMoreMenu: () => void
  onToggleFeedAIMoreMenu: () => void
  onSetUnreadOnly: (next: boolean) => void
  onToggleFeedTitleOnlyMode: () => void
  onToggleFeedImages: () => void
  onToggleFeedSearch: () => void
  onApplyFilters: () => void
  onToggleAdvancedFilters: () => void
  onChangeKeyword: (value: string) => void
  onChangeTagFilter: (value: string) => void
  onChangeSourceFilter: (value: string) => void
  onClearFilters: () => void
  onRemoveFilter: (type: 'keyword' | 'tag' | 'source' | 'muted_sites' | 'unread') => void
  onRetryLoadFeed: () => Promise<void>
  onOpenArticle: (articleID: number) => Promise<void>
  onOpenFeedBriefing: () => void
  onLoadMore: () => void
  normalizeImageURL: (rawURL?: string) => string | null
  formatTimeAgo: (input: string) => string
  formatTimeAgoCompact: (input: string) => string
  formatReplyCount: (value?: number) => string
  buildCompactTitleParts: (title: string, summary?: string) => { title: string; summary: string }
  plainText: (input?: string) => string
  truncate: (input: string, size: number) => string
  getSummaryTaskStatus: (articleID: number) => FeedSummaryTaskStatus | null
  summaryTaskStatusLabel: (status: FeedSummaryTaskStatus) => string
}

type FeedBriefingListItemProps = {
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

const FeedBriefingListItem = memo(function FeedBriefingListItem(props: FeedBriefingListItemProps) {
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

type FeedArticleListItemProps = {
  item: FeedItem
  isActive: boolean
  isRead: boolean
  feedTitleOnlyMode: boolean
  showFeedImages: boolean
  summaryTaskStatus: FeedSummaryTaskStatus | null
  summaryTaskStatusLabel: (status: FeedSummaryTaskStatus) => string
  onOpenArticle: (articleID: number) => Promise<void>
  normalizeImageURL: (rawURL?: string) => string | null
  formatTimeAgo: (input: string) => string
  formatTimeAgoCompact: (input: string) => string
  formatReplyCount: (value?: number) => string
  buildCompactTitleParts: (title: string, summary?: string) => { title: string; summary: string }
  plainText: (input?: string) => string
  truncate: (input: string, size: number) => string
}

const FeedArticleListItem = memo(
  function FeedArticleListItem(props: FeedArticleListItemProps) {
    const {
      item,
      isActive,
      isRead,
      feedTitleOnlyMode,
      showFeedImages,
      summaryTaskStatus,
      summaryTaskStatusLabel,
      onOpenArticle,
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
      () => formatTimeAgo(item.published_at ?? item.created_at),
      [formatTimeAgo, item.created_at, item.published_at],
    )
    const compactPublishedLabel = useMemo(
      () => formatTimeAgoCompact(item.published_at ?? item.created_at),
      [formatTimeAgoCompact, item.created_at, item.published_at],
    )
    const replyCountText = useMemo(() => formatReplyCount(item.reply_count), [formatReplyCount, item.reply_count])
    const plainSummaryText = useMemo(() => plainText(item.summary), [item.summary, plainText])
    const compactPreviewText = useMemo(() => {
      const summary = plainText(item.summary)
      if (summary) {
        return summary
      }
      return plainText(item.content)
    }, [item.content, item.summary, plainText])
    const isShortSummary = plainSummaryText.length > 0 && plainSummaryText.length <= 72
    const duplicateCountText =
      typeof item.duplicate_count === 'number' && item.duplicate_count > 1 ? `+${item.duplicate_count - 1}源` : ''
    const compactTitleParts = useMemo(
      () => buildCompactTitleParts(item.title, compactPreviewText),
      [buildCompactTitleParts, compactPreviewText, item.title],
    )

    const handleOpen = useCallback(() => {
      void onOpenArticle(item.id)
    }, [item.id, onOpenArticle])

    return (
      <article
        className={cn('feed-item', isActive && 'active', isRead && 'read')}
        onClick={handleOpen}
      >
        <div className="feed-item-body">
          <div className="feed-item-content">
            {feedTitleOnlyMode ? (
              <div className="feed-item-compact-row">
                <div className="feed-item-compact-leading">
                  <span className="feed-item-compact-time">{compactPublishedLabel}</span>
                  <span className="feed-item-compact-source">{item.source_name}</span>
                </div>
                <h3 className="feed-item-title">
                  <span className="feed-item-inline-title">{compactTitleParts.title || item.title}</span>
                  {compactTitleParts.summary && (
                    <>
                      <span className="feed-item-inline-sep" aria-hidden="true">
                        {' '}
                        ·{' '}
                      </span>
                      <span className="feed-item-inline-summary">{compactTitleParts.summary}</span>
                    </>
                  )}
                </h3>
                <div className="feed-item-compact-meta">
                  {duplicateCountText && <span className="feed-item-compact-burst">{duplicateCountText}</span>}
                  {replyCountText && (
                    <>
                      <span>{replyCountText}</span>
                    </> 
                  )}
                  {previewImageURL && (
                    <span className="feed-item-compact-flag">图</span>
                  )}
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
                  <span className="feed-source">{item.source_name}</span>
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
                      <span>合并 {item.duplicate_count} 条</span>
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
                  {isShortSummary ? plainSummaryText : truncate(plainSummaryText, 175)}
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
    prev.feedTitleOnlyMode === next.feedTitleOnlyMode &&
    prev.showFeedImages === next.showFeedImages &&
    prev.summaryTaskStatus === next.summaryTaskStatus &&
    prev.summaryTaskStatusLabel === next.summaryTaskStatusLabel &&
    prev.onOpenArticle === next.onOpenArticle &&
    prev.normalizeImageURL === next.normalizeImageURL &&
    prev.formatTimeAgo === next.formatTimeAgo &&
    prev.formatTimeAgoCompact === next.formatTimeAgoCompact &&
    prev.formatReplyCount === next.formatReplyCount &&
    prev.buildCompactTitleParts === next.buildCompactTitleParts &&
    prev.plainText === next.plainText &&
    prev.truncate === next.truncate,
)

export function ReaderFeedPanel(props: ReaderFeedPanelProps) {
  const {
    showFloatingReader,
    readerView,
    feedTitleOnlyMode,
    showFeedImages,
    showFeedSearch,
    showAdvancedFilters,
    showFeedAIMoreMenu,
    loadingFeedBriefing,
    unreadVisibleCount,
    unreadOnly,
    hasActiveFilters,
    keyword,
    tagFilter,
    sourceFilter,
    mutedSiteKeys,
    availableTags,
    readerSources,
    sourceFilterSelectValue,
    sourceFilterChipLabel,
    loadingFeed,
    feedError,
    feed,
    visibleFeed,
    hasFeedBriefingEntry,
    feedBriefingInsertIndex,
    selectedArticleID,
    selectedFeedBriefing,
    readArticleIDSet,
    feedAIMoreRef,
    feedAutoLoadRef,
    hasMoreFeed,
    feedBriefingPreviewText,
    feedBriefingScopeLabel,
    feedBriefingFreshnessLabel,
    feedBriefingNewArticleCount,
    feedBriefingArticleCount,
    feedBriefingItems,
    onGenerateFeedBriefing,
    onCloseFeedAIMoreMenu,
    onToggleFeedAIMoreMenu,
    onSetUnreadOnly,
    onToggleFeedTitleOnlyMode,
    onToggleFeedImages,
    onToggleFeedSearch,
    onApplyFilters,
    onToggleAdvancedFilters,
    onChangeKeyword,
    onChangeTagFilter,
    onChangeSourceFilter,
    onClearFilters,
    onRemoveFilter,
    onRetryLoadFeed,
    onOpenArticle,
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
  } = props

  return (
    <section
      className={cn(
        'panel feed reader-panel',
        showFloatingReader && readerView === 'stream' && 'feed-with-floating',
        feedTitleOnlyMode && 'feed-title-only',
      )}
    >
      <div className="feed-header">
        <div className="feed-header-title">
          <h2>聚合流</h2>
          <p className="hint">以列表为主，沉浸阅读可单独进入详情页</p>
        </div>
        <div className="feed-header-tools">
          <div className="feed-ai-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onCloseFeedAIMoreMenu()
                void onGenerateFeedBriefing(false)
              }}
              disabled={loadingFeedBriefing}
            >
              {loadingFeedBriefing ? '生成中...' : 'AI 速览'}
            </Button>
            <div ref={feedAIMoreRef} className="feed-ai-more">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={showFeedAIMoreMenu}
                onClick={onToggleFeedAIMoreMenu}
                disabled={loadingFeedBriefing}
              >
                更多
              </Button>
              {showFeedAIMoreMenu && (
                <div className="feed-ai-more-menu" role="menu" aria-label="AI 速览更多操作">
                  <button
                    type="button"
                    className="feed-ai-more-item"
                    role="menuitem"
                    onClick={() => {
                      onCloseFeedAIMoreMenu()
                      void onGenerateFeedBriefing(true)
                    }}
                    disabled={loadingFeedBriefing}
                  >
                    重算
                  </button>
                  <button
                    type="button"
                    className="feed-ai-more-item"
                    role="menuitem"
                    onClick={() => {
                      onCloseFeedAIMoreMenu()
                      onToggleFeedSearch()
                    }}
                  >
                    {showFeedSearch ? '收起搜索与筛选' : '打开搜索与筛选'}
                  </button>
                  <button
                    type="button"
                    className="feed-ai-more-item"
                    role="menuitem"
                    onClick={() => {
                      onCloseFeedAIMoreMenu()
                      onToggleFeedTitleOnlyMode()
                    }}
                  >
                    {feedTitleOnlyMode ? '切换到标准模式' : '切换到仅标题'}
                  </button>
                  <button
                    type="button"
                    className="feed-ai-more-item"
                    role="menuitem"
                    disabled={feedTitleOnlyMode}
                    onClick={() => {
                      onCloseFeedAIMoreMenu()
                      if (feedTitleOnlyMode) return
                      onToggleFeedImages()
                    }}
                  >
                    {feedTitleOnlyMode ? '仅标题模式下不可显示图片' : showFeedImages ? '关闭图片' : '显示图片'}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="feed-read-actions">
            <div className="feed-read-toggle" role="group" aria-label="文章可见范围">
              <Button type="button" variant={!unreadOnly ? 'default' : 'ghost'} size="sm" aria-pressed={!unreadOnly} onClick={() => onSetUnreadOnly(false)}>
                全部
              </Button>
              <Button type="button" variant={unreadOnly ? 'default' : 'ghost'} size="sm" aria-pressed={unreadOnly} onClick={() => onSetUnreadOnly(true)}>
                未读 {unreadVisibleCount}
              </Button>
            </div>
          </div>
          <div className="feed-density-actions" role="group" aria-label="信息密度">
            <Button
              type="button"
              variant={feedTitleOnlyMode ? 'default' : 'ghost'}
              size="sm"
              aria-pressed={feedTitleOnlyMode}
              onClick={onToggleFeedTitleOnlyMode}
            >
              {feedTitleOnlyMode ? '仅标题' : '标准'}
            </Button>
            {!feedTitleOnlyMode && (
              <Button
                type="button"
                variant={showFeedImages ? 'default' : 'ghost'}
                size="sm"
                aria-pressed={showFeedImages}
                onClick={onToggleFeedImages}
              >
                图片
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="feed-filter-toggle-row">
        <Button type="button" variant={showFeedSearch || hasActiveFilters ? 'outline' : 'ghost'} size="sm" onClick={onToggleFeedSearch}>
          {showFeedSearch ? '收起搜索与筛选' : hasActiveFilters ? '搜索与筛选（已启用）' : '搜索与筛选'}
        </Button>
        {hasActiveFilters && !showFeedSearch && <p className="hint">已启用筛选，点击可快速调整。</p>}
      </div>

      {(showFeedSearch || hasActiveFilters) && (
        <Suspense fallback={null}>
          <ReaderFeedFilters
            showFeedSearch={showFeedSearch}
            showAdvancedFilters={showAdvancedFilters}
            hasActiveFilters={hasActiveFilters}
            keyword={keyword}
            tagFilter={tagFilter}
            sourceFilter={sourceFilter}
            mutedSiteKeys={mutedSiteKeys}
            availableTags={availableTags}
            readerSources={readerSources}
            sourceFilterSelectValue={sourceFilterSelectValue}
            sourceFilterChipLabel={sourceFilterChipLabel}
            onApplyFilters={onApplyFilters}
            onToggleAdvancedFilters={onToggleAdvancedFilters}
            onChangeKeyword={onChangeKeyword}
            onChangeTagFilter={onChangeTagFilter}
            onChangeSourceFilter={onChangeSourceFilter}
            onClearFilters={onClearFilters}
            onRemoveFilter={onRemoveFilter}
            unreadOnly={unreadOnly}
          />
        </Suspense>
      )}

      <div className="module-divider" aria-hidden="true" />

      <p className="feed-shortcuts">快捷键: `j` / `k` 切换，`o` 打开原文，`esc` 关闭浮窗</p>

      <div className={cn('feed-list', loadingFeed && 'is-loading')}>
        {loadingFeed && visibleFeed.length === 0 && !hasFeedBriefingEntry && (
          <>
            <FeedSkeleton />
            <FeedSkeleton />
            <FeedSkeleton />
          </>
        )}

        {feedError && visibleFeed.length === 0 && !hasFeedBriefingEntry && (
          <div className="inline-error">
            <span>聚合流加载失败: {feedError}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void onRetryLoadFeed()}>
              重试
            </Button>
          </div>
        )}

        {!loadingFeed && !feedError && visibleFeed.length === 0 && !hasFeedBriefingEntry && (
          <p className="hint">{feed.length > 0 ? '当前网站都被临时隐藏了，可点击“恢复全部”。' : '暂无文章'}</p>
        )}

        {hasFeedBriefingEntry && feedBriefingInsertIndex === 0 && (
          <FeedBriefingListItem
            itemKey="feed-briefing"
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
        )}

        {visibleFeed.map((item, index) => {
          const summaryTaskStatus = getSummaryTaskStatus(item.id)
          return (
            <Fragment key={`feed-row-${item.id}`}>
              {hasFeedBriefingEntry && feedBriefingInsertIndex === index && feedBriefingInsertIndex > 0 && (
                <FeedBriefingListItem
                  itemKey={`feed-briefing-before-${item.id}`}
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
              )}
              <FeedArticleListItem
                item={item}
                isActive={selectedArticleID === item.id && !selectedFeedBriefing}
                isRead={readArticleIDSet.has(item.id)}
                feedTitleOnlyMode={feedTitleOnlyMode}
                showFeedImages={showFeedImages}
                summaryTaskStatus={summaryTaskStatus}
                summaryTaskStatusLabel={summaryTaskStatusLabel}
                onOpenArticle={onOpenArticle}
                normalizeImageURL={normalizeImageURL}
                formatTimeAgo={formatTimeAgo}
                formatTimeAgoCompact={formatTimeAgoCompact}
                formatReplyCount={formatReplyCount}
                buildCompactTitleParts={buildCompactTitleParts}
                plainText={plainText}
                truncate={truncate}
              />
            </Fragment>
          )
        })}
      </div>

      <div ref={feedAutoLoadRef} className="feed-auto-load-sentinel" aria-hidden="true" />

      <div className="feed-footer">
        <Button type="button" onClick={onLoadMore} disabled={!hasMoreFeed || loadingFeed}>
          {loadingFeed ? '加载中...' : hasMoreFeed ? '加载更多' : '没有更多了'}
        </Button>
      </div>
    </section>
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
