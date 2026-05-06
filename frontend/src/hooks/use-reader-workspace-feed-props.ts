import type { Dispatch, SetStateAction } from 'react'
import type { ReaderWorkspaceProps } from '@/components/reader-workspace'

type FeedProps = ReaderWorkspaceProps['feedProps']

type UseReaderWorkspaceFeedPropsParams = {
  showFloatingReader: FeedProps['showFloatingReader']
  readerView: FeedProps['readerView']
  feedTitleOnlyMode: FeedProps['feedTitleOnlyMode']
  showFeedImages: FeedProps['showFeedImages']
  showFeedSearch: FeedProps['showFeedSearch']
  showAdvancedFilters: FeedProps['showAdvancedFilters']
  showFeedAIMoreMenu: FeedProps['showFeedAIMoreMenu']
  loadingFeedBriefing: FeedProps['loadingFeedBriefing']
  unreadVisibleCount: FeedProps['unreadVisibleCount']
  favoriteVisibleCount: FeedProps['favoriteVisibleCount']
  unreadOnly: FeedProps['unreadOnly']
  favoriteOnly: FeedProps['favoriteOnly']
  hasActiveFilters: FeedProps['hasActiveFilters']
  keyword: FeedProps['keyword']
  tagFilter: FeedProps['tagFilter']
  sourceFilter: FeedProps['sourceFilter']
  mutedSiteKeys: FeedProps['mutedSiteKeys']
  availableTags: FeedProps['availableTags']
  readerSources: FeedProps['readerSources']
  sourceFilterSelectValue: FeedProps['sourceFilterSelectValue']
  sourceFilterChipLabel: FeedProps['sourceFilterChipLabel']
  loadingFeed: FeedProps['loadingFeed']
  feedError: FeedProps['feedError']
  feed: FeedProps['feed']
  visibleFeed: FeedProps['visibleFeed']
  hasFeedBriefingEntry: FeedProps['hasFeedBriefingEntry']
  feedBriefingInsertIndex: FeedProps['feedBriefingInsertIndex']
  selectedArticleID: FeedProps['selectedArticleID']
  selectedFeedBriefing: FeedProps['selectedFeedBriefing']
  readArticleIDSet: FeedProps['readArticleIDSet']
  favoriteArticleIDSet: FeedProps['favoriteArticleIDSet']
  feedAIMoreRef: FeedProps['feedAIMoreRef']
  feedAutoLoadRef: FeedProps['feedAutoLoadRef']
  hasMoreFeed: FeedProps['hasMoreFeed']
  feedBriefingPreviewText: FeedProps['feedBriefingPreviewText']
  feedBriefingScopeLabel: FeedProps['feedBriefingScopeLabel']
  feedBriefingFreshnessLabel: FeedProps['feedBriefingFreshnessLabel']
  feedBriefingNewArticleCount: FeedProps['feedBriefingNewArticleCount']
  feedBriefingArticleCount: FeedProps['feedBriefingArticleCount']
  feedBriefingItems: FeedProps['feedBriefingItems']
  onGenerateFeedBriefing: FeedProps['onGenerateFeedBriefing']
  onSetUnreadOnly: FeedProps['onSetUnreadOnly']
  onSetFavoriteOnly: FeedProps['onSetFavoriteOnly']
  onApplyFilters: FeedProps['onApplyFilters']
  onChangeKeyword: FeedProps['onChangeKeyword']
  onChangeTagFilter: FeedProps['onChangeTagFilter']
  onClearFilters: FeedProps['onClearFilters']
  onRemoveFilter: FeedProps['onRemoveFilter']
  onRetryLoadFeed: FeedProps['onRetryLoadFeed']
  onOpenArticle: FeedProps['onOpenArticle']
  onToggleFavoriteArticle: FeedProps['onToggleFavoriteArticle']
  onOpenFeedBriefing: FeedProps['onOpenFeedBriefing']
  onLoadMore: FeedProps['onLoadMore']
  normalizeImageURL: FeedProps['normalizeImageURL']
  formatTimeAgo: FeedProps['formatTimeAgo']
  formatTimeAgoCompact: FeedProps['formatTimeAgoCompact']
  formatReplyCount: FeedProps['formatReplyCount']
  buildCompactTitleParts: FeedProps['buildCompactTitleParts']
  plainText: FeedProps['plainText']
  truncate: FeedProps['truncate']
  getSummaryTaskStatus: FeedProps['getSummaryTaskStatus']
  summaryTaskStatusLabel: FeedProps['summaryTaskStatusLabel']
  setShowFeedAIMoreMenu: Dispatch<SetStateAction<boolean>>
  setFeedTitleOnlyMode: Dispatch<SetStateAction<boolean>>
  setShowFeedImages: Dispatch<SetStateAction<boolean>>
  setShowFeedSearch: Dispatch<SetStateAction<boolean>>
  setShowAdvancedFilters: Dispatch<SetStateAction<boolean>>
  setSourceGroupFilter: Dispatch<SetStateAction<{ key: string; label: string } | null>>
  setSidebarTagFilters: Dispatch<SetStateAction<string[]>>
  setSourceFilter: Dispatch<SetStateAction<string>>
}

export function useReaderWorkspaceFeedProps(
  params: UseReaderWorkspaceFeedPropsParams,
): FeedProps {
  return {
    showFloatingReader: params.showFloatingReader,
    readerView: params.readerView,
    feedTitleOnlyMode: params.feedTitleOnlyMode,
    showFeedImages: params.showFeedImages,
    showFeedSearch: params.showFeedSearch,
    showAdvancedFilters: params.showAdvancedFilters,
    showFeedAIMoreMenu: params.showFeedAIMoreMenu,
    loadingFeedBriefing: params.loadingFeedBriefing,
    unreadVisibleCount: params.unreadVisibleCount,
    favoriteVisibleCount: params.favoriteVisibleCount,
    unreadOnly: params.unreadOnly,
    favoriteOnly: params.favoriteOnly,
    hasActiveFilters: params.hasActiveFilters,
    keyword: params.keyword,
    tagFilter: params.tagFilter,
    sourceFilter: params.sourceFilter,
    mutedSiteKeys: params.mutedSiteKeys,
    availableTags: params.availableTags,
    readerSources: params.readerSources,
    sourceFilterSelectValue: params.sourceFilterSelectValue,
    sourceFilterChipLabel: params.sourceFilterChipLabel,
    loadingFeed: params.loadingFeed,
    feedError: params.feedError,
    feed: params.feed,
    visibleFeed: params.visibleFeed,
    hasFeedBriefingEntry: params.hasFeedBriefingEntry,
    feedBriefingInsertIndex: params.feedBriefingInsertIndex,
    selectedArticleID: params.selectedArticleID,
    selectedFeedBriefing: params.selectedFeedBriefing,
    readArticleIDSet: params.readArticleIDSet,
    favoriteArticleIDSet: params.favoriteArticleIDSet,
    feedAIMoreRef: params.feedAIMoreRef,
    feedAutoLoadRef: params.feedAutoLoadRef,
    hasMoreFeed: params.hasMoreFeed,
    feedBriefingPreviewText: params.feedBriefingPreviewText,
    feedBriefingScopeLabel: params.feedBriefingScopeLabel,
    feedBriefingFreshnessLabel: params.feedBriefingFreshnessLabel,
    feedBriefingNewArticleCount: params.feedBriefingNewArticleCount,
    feedBriefingArticleCount: params.feedBriefingArticleCount,
    feedBriefingItems: params.feedBriefingItems,
    onGenerateFeedBriefing: params.onGenerateFeedBriefing,
    onCloseFeedAIMoreMenu: () => params.setShowFeedAIMoreMenu(false),
    onToggleFeedAIMoreMenu: () => params.setShowFeedAIMoreMenu((value) => !value),
    onSetUnreadOnly: params.onSetUnreadOnly,
    onSetFavoriteOnly: params.onSetFavoriteOnly,
    onToggleFeedTitleOnlyMode: () => params.setFeedTitleOnlyMode((value) => !value),
    onToggleFeedImages: () => params.setShowFeedImages((value) => !value),
    onToggleFeedSearch: () => {
      params.setShowFeedSearch((value) => {
        const next = !value
        if (!next) {
          params.setShowAdvancedFilters(false)
        }
        return next
      })
    },
    onApplyFilters: params.onApplyFilters,
    onToggleAdvancedFilters: () => params.setShowAdvancedFilters((value) => !value),
    onChangeKeyword: params.onChangeKeyword,
    onChangeTagFilter: params.onChangeTagFilter,
    onChangeSourceFilter: (value) => {
      params.setSourceGroupFilter(null)
      params.setSidebarTagFilters([])
      params.setSourceFilter(value)
    },
    onClearFilters: params.onClearFilters,
    onRemoveFilter: params.onRemoveFilter,
    onRetryLoadFeed: params.onRetryLoadFeed,
    onOpenArticle: params.onOpenArticle,
    onToggleFavoriteArticle: params.onToggleFavoriteArticle,
    onOpenFeedBriefing: params.onOpenFeedBriefing,
    onLoadMore: params.onLoadMore,
    normalizeImageURL: params.normalizeImageURL,
    formatTimeAgo: params.formatTimeAgo,
    formatTimeAgoCompact: params.formatTimeAgoCompact,
    formatReplyCount: params.formatReplyCount,
    buildCompactTitleParts: params.buildCompactTitleParts,
    plainText: params.plainText,
    truncate: params.truncate,
    getSummaryTaskStatus: params.getSummaryTaskStatus,
    summaryTaskStatusLabel: params.summaryTaskStatusLabel,
  }
}
