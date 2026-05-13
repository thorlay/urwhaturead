import { useAppDerivedState } from './use-app-derived-state'
import { useDetailPanel } from './use-detail-panel'
import { useFeedBriefingDerived } from './use-feed-briefing-derived'
import { useReaderStream } from './use-reader-stream'
import { useSummaryTaskView } from './use-summary-task-view'
import { threadPreviewCommentLimit } from '../lib/app-domain'
import type { AppliedSourceGroupFilter, AppTab, SummaryTask } from '../lib/app-domain'
import {
  formatReplyCount,
  formatTimeAgo,
  isTrackableForumLink,
  normalizeImageURL,
  parseSourceIDFilter,
  plainText,
  truncate,
} from '../lib/app-utils'
import type { FeedItem, Source, SourceStatus } from '../types'

type UseReaderFeatureDerivedParams = {
  activeTab: AppTab
  feed: FeedItem[]
  summaryTasks: SummaryTask[]
  selectedArticle: FeedItem | null
  selectedArticleID: number | null
  selectedFeedBriefing: boolean
  unreadOnly: boolean
  favoriteOnly: boolean
  keyword: string
  tagFilter: string
  sourceFilter: string
  sourceGroupFilter: AppliedSourceGroupFilter | null
  mutedSiteKeys: string[]
  aiModel: string
  feedBriefing: string
  feedBriefingError: string | null
  loadingFeedBriefing: boolean
  feedBriefingGeneratedAt: string
  feedBriefingAnchorArticleIDs: number[]
  expandedThreadComments: boolean
  threadCommentsNewestFirst: boolean
  sources: Source[]
  sourceStatus: SourceStatus[]
  sourceByID: Map<number, Source>
  sourceSiteKeyMap: Map<number, string>
  mutedSiteSet: Set<string>
  readArticleIDSet: Set<number>
  favoriteArticleIDSet: Set<number>
  readerSources: Source[]
}

export function useReaderFeatureDerived({
  activeTab,
  feed,
  summaryTasks,
  selectedArticle,
  selectedArticleID,
  selectedFeedBriefing,
  unreadOnly,
  favoriteOnly,
  keyword,
  tagFilter,
  sourceFilter,
  sourceGroupFilter,
  mutedSiteKeys,
  aiModel,
  feedBriefing,
  feedBriefingError,
  loadingFeedBriefing,
  feedBriefingGeneratedAt,
  feedBriefingAnchorArticleIDs,
  expandedThreadComments,
  threadCommentsNewestFirst,
  sources,
  sourceStatus,
  sourceByID,
  sourceSiteKeyMap,
  mutedSiteSet,
  readArticleIDSet,
  favoriteArticleIDSet,
  readerSources,
}: UseReaderFeatureDerivedParams) {
  const hasFeedBriefingEntry = Boolean(feedBriefing || feedBriefingError || loadingFeedBriefing)
  const {
    visibleFeed,
    feedBriefingInsertIndex,
    feedBriefingNewArticleCount,
    readerStreamItems,
    selectedFeedIndex,
    unreadVisibleCount,
    favoriteVisibleCount,
  } = useReaderStream({
    feed,
    unreadOnly,
    favoriteOnly,
    readArticleIDSet,
    favoriteArticleIDSet,
    sourceSiteKeyMap,
    mutedSiteSet,
    hasFeedBriefingEntry,
    feedBriefingAnchorArticleIDs,
    selectedFeedBriefing,
    selectedArticleID,
  })
  const {
    sourceFilterIDs,
    activeFeedBriefingSourceIDs,
    activeFeedBriefingKeyword,
    activeFeedBriefingTaskKey,
    activeFeedBriefingScopeLabel,
    visibleFeedArticleIDs,
    activeFeedBriefingAnchorArticleIDs,
    sourceFilterSelectValue,
    sourceFilterChipLabel,
  } = useFeedBriefingDerived({
    sourceFilter,
    sourceGroupFilter,
    readerSources,
    visibleFeed,
    aiModel,
    tagFilter,
    keyword,
    unreadOnly,
    mutedSiteKeys,
    sourceByID,
    parseSourceIDFilter,
  })
  const {
    visibleSummaryTasks,
    summaryTaskStats,
    pendingArticleSummaryTasks,
    selectedSummaryTask,
    getSummaryTaskStatus,
  } = useSummaryTaskView({
    summaryTasks,
    sourceFilterIDs,
    visibleFeedArticleIDs,
    selectedArticleID,
  })
  const {
    feedBriefingPreviewText,
    feedBriefingFreshnessLabel,
    hasActiveFilters,
    enabledSourceCount,
    unhealthySourceCount,
    threadComments,
    selectedArticleImageURL,
    selectedArticleReplyCountLabel,
    hasHiddenThreadComments,
    visibleThreadComments,
  } = useAppDerivedState({
    feedBriefing,
    feedBriefingError,
    loadingFeedBriefing,
    feedBriefingGeneratedAt,
    keyword,
    tagFilter,
    sourceFilter,
    unreadOnly,
    favoriteOnly,
    mutedSiteKeys,
    sources,
    sourceStatus,
    selectedArticle,
    expandedThreadComments,
    threadCommentsNewestFirst,
    threadPreviewCommentLimit,
    truncate,
    plainText,
    formatTimeAgo,
    normalizeImageURL,
    formatReplyCount,
  })
  const {
    detailMoreMenuRef,
    showDetailMoreMenu,
    closeDetailMoreMenu,
    toggleDetailMoreMenu,
    isThreadArticle,
    threadPrimaryBody,
    canTrackThread,
    canForceRecalcSummary,
    hasDetailMoreActions,
  } = useDetailPanel({
    activeTab,
    selectedArticle,
    selectedArticleID,
    selectedFeedBriefing,
    isTrackableForumLink,
  })

  return {
    hasFeedBriefingEntry,
    visibleFeed,
    feedBriefingInsertIndex,
    feedBriefingNewArticleCount,
    readerStreamItems,
    selectedFeedIndex,
    unreadVisibleCount,
    favoriteVisibleCount,
    sourceFilterIDs,
    activeFeedBriefingSourceIDs,
    activeFeedBriefingKeyword,
    activeFeedBriefingTaskKey,
    activeFeedBriefingScopeLabel,
    visibleFeedArticleIDs,
    activeFeedBriefingAnchorArticleIDs,
    sourceFilterSelectValue,
    sourceFilterChipLabel,
    visibleSummaryTasks,
    summaryTaskStats,
    pendingArticleSummaryTasks,
    selectedSummaryTask,
    getSummaryTaskStatus,
    feedBriefingPreviewText,
    feedBriefingFreshnessLabel,
    hasActiveFilters,
    enabledSourceCount,
    unhealthySourceCount,
    threadComments,
    selectedArticleImageURL,
    selectedArticleReplyCountLabel,
    hasHiddenThreadComments,
    visibleThreadComments,
    detailMoreMenuRef,
    showDetailMoreMenu,
    closeDetailMoreMenu,
    toggleDetailMoreMenu,
    isThreadArticle,
    threadPrimaryBody,
    canTrackThread,
    canForceRecalcSummary,
    hasDetailMoreActions,
  }
}
