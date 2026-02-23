import { useEffect, type MutableRefObject } from 'react'
import { getFeedBriefingCache } from '../api'
import type { AppTab, FeedBriefingSnapshot, SummaryTask } from '../lib/app-domain'

type UseFeedBriefingCacheRestoreParams = {
  activeTab: AppTab
  loadingFeed: boolean
  loadingFeedBriefing: boolean
  activeFeedBriefingAnchorArticleIDs: number[]
  hasFeedBriefingEntry: boolean
  feedBriefingTaskKey: string
  activeFeedBriefingTaskKey: string
  feedBriefingSnapshots: Record<string, FeedBriefingSnapshot>
  applyFeedBriefingSnapshot: (snapshot: FeedBriefingSnapshot) => void
  activeFeedBriefingKeyword: string
  tagFilter: string
  aiModel: string
  activeFeedBriefingSourceIDs: number[]
  activeFeedBriefingScopeLabel: string
  saveFeedBriefingSnapshot: (snapshot: FeedBriefingSnapshot) => void
  upsertSummaryTask: (task: SummaryTask) => void
  feedBriefingCacheAttemptedRef: MutableRefObject<Map<string, number>>
}

export function useFeedBriefingCacheRestore(params: UseFeedBriefingCacheRestoreParams) {
  const {
    activeTab,
    loadingFeed,
    loadingFeedBriefing,
    activeFeedBriefingAnchorArticleIDs,
    hasFeedBriefingEntry,
    feedBriefingTaskKey,
    activeFeedBriefingTaskKey,
    feedBriefingSnapshots,
    applyFeedBriefingSnapshot,
    activeFeedBriefingKeyword,
    tagFilter,
    aiModel,
    activeFeedBriefingSourceIDs,
    activeFeedBriefingScopeLabel,
    saveFeedBriefingSnapshot,
    upsertSummaryTask,
    feedBriefingCacheAttemptedRef,
  } = params

  useEffect(() => {
    if (activeTab !== 'reader') {
      return
    }
    if (loadingFeed || loadingFeedBriefing) {
      return
    }
    if (activeFeedBriefingAnchorArticleIDs.length === 0) {
      return
    }
    if (hasFeedBriefingEntry && feedBriefingTaskKey === activeFeedBriefingTaskKey) {
      return
    }
    if (hasFeedBriefingEntry && feedBriefingTaskKey && feedBriefingTaskKey !== activeFeedBriefingTaskKey) {
      return
    }

    const localSnapshot = feedBriefingSnapshots[activeFeedBriefingTaskKey]
    if (localSnapshot) {
      applyFeedBriefingSnapshot(localSnapshot)
      return
    }

    const now = Date.now()
    const lastAttemptAt = feedBriefingCacheAttemptedRef.current.get(activeFeedBriefingTaskKey) ?? 0
    if (now - lastAttemptAt < 30_000) {
      return
    }
    feedBriefingCacheAttemptedRef.current.set(activeFeedBriefingTaskKey, now)

    let cancelled = false

    async function restoreFeedBriefingFromCache() {
      try {
        const cached = await getFeedBriefingCache({
          limit: Math.min(activeFeedBriefingAnchorArticleIDs.length, 30),
          tag: tagFilter || undefined,
          keyword: activeFeedBriefingKeyword || undefined,
          model: aiModel,
          source_ids: activeFeedBriefingSourceIDs.length > 0 ? activeFeedBriefingSourceIDs : undefined,
          article_ids: activeFeedBriefingAnchorArticleIDs,
        })
        if (cancelled || !cached?.data?.summary) {
          return
        }

        const generatedAt = cached.data.generated_at || new Date().toISOString()
        const snapshot: FeedBriefingSnapshot = {
          taskKey: activeFeedBriefingTaskKey,
          summary: cached.data.summary,
          meta: `${cached.data.cache_hit ? '缓存命中' : '新生成'} · ${cached.data.provider} · ${cached.data.model} · ${cached.data.article_count} 篇`,
          items: cached.data.input_items ?? [],
          articleCount: cached.data.article_count ?? 0,
          scopeLabel: activeFeedBriefingScopeLabel,
          generatedAt,
          anchorArticleIDs: activeFeedBriefingAnchorArticleIDs,
          error: null,
        }
        saveFeedBriefingSnapshot(snapshot)
        applyFeedBriefingSnapshot(snapshot)
        upsertSummaryTask({
          kind: 'feed_briefing',
          key: activeFeedBriefingTaskKey,
          sourceIDs: activeFeedBriefingSourceIDs,
          sourceID: activeFeedBriefingSourceIDs.length === 1 ? activeFeedBriefingSourceIDs[0] : undefined,
          title: 'AI 聚合速览',
          sourceName: activeFeedBriefingScopeLabel,
          model: cached.data.model || aiModel,
          status: 'succeeded',
          updatedAt: generatedAt,
          error: '',
        })
      } catch {
        // Silent fail: auto-restore should not interrupt reading flow.
      }
    }

    void restoreFeedBriefingFromCache()
    return () => {
      cancelled = true
    }
  }, [
    activeFeedBriefingAnchorArticleIDs,
    activeFeedBriefingKeyword,
    activeFeedBriefingScopeLabel,
    activeFeedBriefingSourceIDs,
    activeFeedBriefingTaskKey,
    activeTab,
    aiModel,
    applyFeedBriefingSnapshot,
    feedBriefingSnapshots,
    feedBriefingTaskKey,
    hasFeedBriefingEntry,
    loadingFeed,
    loadingFeedBriefing,
    saveFeedBriefingSnapshot,
    tagFilter,
    upsertSummaryTask,
    feedBriefingCacheAttemptedRef,
  ])
}
