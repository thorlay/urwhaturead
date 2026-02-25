import { useMemo } from 'react'
import type { ArticleDetail, Source, SourceStatus } from '../types'

type UseAppDerivedStateParams = {
  feedBriefing: string
  feedBriefingError: string | null
  loadingFeedBriefing: boolean
  feedBriefingGeneratedAt: string
  keyword: string
  tagFilter: string
  sourceFilter: string
  unreadOnly: boolean
  mutedSiteKeys: string[]
  sources: Source[]
  sourceStatus: SourceStatus[]
  selectedArticle: ArticleDetail | null
  expandedThreadComments: boolean
  threadCommentsNewestFirst: boolean
  threadPreviewCommentLimit: number
  truncate: (value: string, max: number) => string
  plainText: (value?: string) => string
  formatTimeAgo: (input: string) => string
  normalizeImageURL: (value?: string) => string | null
  formatReplyCount: (value?: number) => string
}

export function useAppDerivedState({
  feedBriefing,
  feedBriefingError,
  loadingFeedBriefing,
  feedBriefingGeneratedAt,
  keyword,
  tagFilter,
  sourceFilter,
  unreadOnly,
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
}: UseAppDerivedStateParams) {
  const feedBriefingPreviewText = useMemo(() => {
    if (feedBriefingError) {
      return `生成失败：${feedBriefingError}`
    }
    if (feedBriefing) {
      return truncate(plainText(feedBriefing), 190)
    }
    if (loadingFeedBriefing) {
      return '正在生成聚合速览...'
    }
    return '暂无可展示速览内容。'
  }, [feedBriefing, feedBriefingError, loadingFeedBriefing, plainText, truncate])

  const feedBriefingFreshnessLabel = useMemo(() => {
    if (!feedBriefingGeneratedAt) {
      return ''
    }
    return formatTimeAgo(feedBriefingGeneratedAt)
  }, [feedBriefingGeneratedAt, formatTimeAgo])

  const hasActiveFilters = Boolean(keyword.trim() || tagFilter || sourceFilter || unreadOnly || mutedSiteKeys.length > 0)
  const enabledSourceCount = useMemo(() => sources.filter((source) => source.enabled).length, [sources])
  const unhealthySourceCount = useMemo(
    () => sourceStatus.filter((item) => item.health === 'warn' || item.health === 'error' || item.health === 'stale').length,
    [sourceStatus],
  )

  const threadComments = useMemo(
    () => selectedArticle?.thread?.comments ?? [],
    [selectedArticle?.thread?.comments],
  )
  const selectedArticleImageURL = useMemo(
    () => normalizeImageURL(selectedArticle?.image_url),
    [normalizeImageURL, selectedArticle?.image_url],
  )
  const selectedArticleReplyCountLabel = useMemo(
    () => formatReplyCount(selectedArticle?.reply_count),
    [formatReplyCount, selectedArticle?.reply_count],
  )

  const hasHiddenThreadComments =
    Boolean(selectedArticle?.thread) && !expandedThreadComments && threadComments.length > threadPreviewCommentLimit
  const orderedThreadComments = useMemo(
    () => (threadCommentsNewestFirst ? [...threadComments].reverse() : threadComments),
    [threadComments, threadCommentsNewestFirst],
  )
  const visibleThreadComments = expandedThreadComments
    ? orderedThreadComments
    : orderedThreadComments.slice(0, threadPreviewCommentLimit)

  return {
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
  }
}
