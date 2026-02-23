import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { createFeedBriefing } from '../api'
import type { FeedBriefingSnapshot, Notice, SummaryTask } from '../lib/app-domain'
import type { FeedBriefingInputItem } from '../types'

type UseFeedBriefingActionsParams = {
  activeFeedBriefingAnchorArticleIDs: number[]
  activeFeedBriefingSourceIDs: number[]
  activeFeedBriefingScopeLabel: string
  activeFeedBriefingTaskKey: string
  activeFeedBriefingKeyword: string
  tagFilter: string
  aiModel: string
  setFeedBriefingTaskKey: Dispatch<SetStateAction<string>>
  setFeedBriefingScopeLabel: Dispatch<SetStateAction<string>>
  setFeedBriefingAnchorArticleIDs: Dispatch<SetStateAction<number[]>>
  setLoadingFeedBriefing: Dispatch<SetStateAction<boolean>>
  setFeedBriefingError: Dispatch<SetStateAction<string | null>>
  setFeedBriefing: Dispatch<SetStateAction<string>>
  setFeedBriefingItems: Dispatch<SetStateAction<FeedBriefingInputItem[]>>
  setFeedBriefingArticleCount: Dispatch<SetStateAction<number>>
  setFeedBriefingGeneratedAt: Dispatch<SetStateAction<string>>
  setFeedBriefingMeta: Dispatch<SetStateAction<string>>
  setSelectedFeedBriefing: Dispatch<SetStateAction<boolean>>
  setFeedBriefingSnapshots: Dispatch<SetStateAction<Record<string, FeedBriefingSnapshot>>>
  setNotice: Dispatch<SetStateAction<Notice | null>>
  upsertSummaryTask: (task: SummaryTask) => void
  toErrorMessage: (error: unknown) => string
}

export function useFeedBriefingActions({
  activeFeedBriefingAnchorArticleIDs,
  activeFeedBriefingSourceIDs,
  activeFeedBriefingScopeLabel,
  activeFeedBriefingTaskKey,
  activeFeedBriefingKeyword,
  tagFilter,
  aiModel,
  setFeedBriefingTaskKey,
  setFeedBriefingScopeLabel,
  setFeedBriefingAnchorArticleIDs,
  setLoadingFeedBriefing,
  setFeedBriefingError,
  setFeedBriefing,
  setFeedBriefingItems,
  setFeedBriefingArticleCount,
  setFeedBriefingGeneratedAt,
  setFeedBriefingMeta,
  setSelectedFeedBriefing,
  setFeedBriefingSnapshots,
  setNotice,
  upsertSummaryTask,
  toErrorMessage,
}: UseFeedBriefingActionsParams) {
  const applyFeedBriefingSnapshot = useCallback(
    (snapshot: FeedBriefingSnapshot) => {
      setFeedBriefing(snapshot.summary)
      setFeedBriefingMeta(snapshot.meta)
      setFeedBriefingItems(snapshot.items)
      setFeedBriefingArticleCount(snapshot.articleCount)
      setFeedBriefingTaskKey(snapshot.taskKey)
      setFeedBriefingScopeLabel(snapshot.scopeLabel)
      setFeedBriefingGeneratedAt(snapshot.generatedAt)
      setFeedBriefingAnchorArticleIDs(snapshot.anchorArticleIDs)
      setFeedBriefingError(snapshot.error)
      setSelectedFeedBriefing(false)
    },
    [
      setFeedBriefing,
      setFeedBriefingAnchorArticleIDs,
      setFeedBriefingArticleCount,
      setFeedBriefingError,
      setFeedBriefingGeneratedAt,
      setFeedBriefingItems,
      setFeedBriefingMeta,
      setFeedBriefingScopeLabel,
      setFeedBriefingTaskKey,
      setSelectedFeedBriefing,
    ],
  )

  const saveFeedBriefingSnapshot = useCallback((snapshot: FeedBriefingSnapshot) => {
    setFeedBriefingSnapshots((previous) => ({
      ...previous,
      [snapshot.taskKey]: snapshot,
    }))
  }, [setFeedBriefingSnapshots])

  const resetFeedBriefingState = useCallback(() => {
    setFeedBriefing('')
    setFeedBriefingMeta('')
    setFeedBriefingItems([])
    setFeedBriefingArticleCount(0)
    setFeedBriefingTaskKey('')
    setFeedBriefingScopeLabel('')
    setFeedBriefingGeneratedAt('')
    setFeedBriefingAnchorArticleIDs([])
    setFeedBriefingError(null)
    setLoadingFeedBriefing(false)
    setSelectedFeedBriefing(false)
  }, [
    setFeedBriefing,
    setFeedBriefingAnchorArticleIDs,
    setFeedBriefingArticleCount,
    setFeedBriefingError,
    setFeedBriefingGeneratedAt,
    setFeedBriefingItems,
    setFeedBriefingMeta,
    setFeedBriefingScopeLabel,
    setFeedBriefingTaskKey,
    setLoadingFeedBriefing,
    setSelectedFeedBriefing,
  ])

  const onGenerateFeedBriefing = useCallback(
    async (refresh = false) => {
      const articleIDs = activeFeedBriefingAnchorArticleIDs
      if (articleIDs.length === 0) {
        setNotice({ kind: 'error', text: '当前没有可用文章，无法生成 AI 速览。' })
        return
      }
      const sourceIDs = activeFeedBriefingSourceIDs
      const taskScopeLabel = activeFeedBriefingScopeLabel
      const taskKey = activeFeedBriefingTaskKey
      setFeedBriefingTaskKey(taskKey)
      setFeedBriefingScopeLabel(taskScopeLabel)
      setFeedBriefingAnchorArticleIDs(articleIDs)
      upsertSummaryTask({
        kind: 'feed_briefing',
        key: taskKey,
        sourceIDs,
        sourceID: sourceIDs.length === 1 ? sourceIDs[0] : undefined,
        title: 'AI 聚合速览',
        sourceName: taskScopeLabel,
        model: aiModel,
        status: 'running',
        updatedAt: new Date().toISOString(),
        error: '',
      })

      try {
        setLoadingFeedBriefing(true)
        setFeedBriefingError(null)
        const response = await createFeedBriefing({
          limit: Math.min(articleIDs.length, 30),
          tag: tagFilter || undefined,
          keyword: activeFeedBriefingKeyword || undefined,
          model: aiModel,
          source_ids: sourceIDs.length > 0 ? sourceIDs : undefined,
          article_ids: articleIDs,
          refresh,
        })
        setFeedBriefing(response.data.summary)
        setFeedBriefingItems(response.data.input_items ?? [])
        setFeedBriefingArticleCount(response.data.article_count ?? 0)
        setFeedBriefingTaskKey(taskKey)
        setFeedBriefingGeneratedAt(response.data.generated_at || new Date().toISOString())
        saveFeedBriefingSnapshot({
          taskKey,
          summary: response.data.summary,
          meta: `${response.data.cache_hit ? '缓存命中' : '新生成'} · ${response.data.provider} · ${response.data.model} · ${response.data.article_count} 篇`,
          items: response.data.input_items ?? [],
          articleCount: response.data.article_count ?? 0,
          scopeLabel: taskScopeLabel,
          generatedAt: response.data.generated_at || new Date().toISOString(),
          anchorArticleIDs: articleIDs,
          error: null,
        })
        upsertSummaryTask({
          kind: 'feed_briefing',
          key: taskKey,
          sourceIDs,
          sourceID: sourceIDs.length === 1 ? sourceIDs[0] : undefined,
          title: 'AI 聚合速览',
          sourceName: taskScopeLabel,
          model: response.data.model || aiModel,
          status: 'succeeded',
          updatedAt: response.data.generated_at || new Date().toISOString(),
          error: '',
        })
        setFeedBriefingMeta(
          `${response.data.cache_hit ? '缓存命中' : '新生成'} · ${response.data.provider} · ${response.data.model} · ${response.data.article_count} 篇`,
        )
        setNotice({
          kind: 'info',
          text: response.data.cache_hit ? '已加载缓存速览。' : 'AI 聚合速览已生成。',
        })
      } catch (error) {
        const message = toErrorMessage(error)
        setFeedBriefingTaskKey(taskKey)
        setFeedBriefingError(message)
        saveFeedBriefingSnapshot({
          taskKey,
          summary: '',
          meta: '',
          items: [],
          articleCount: 0,
          scopeLabel: taskScopeLabel,
          generatedAt: new Date().toISOString(),
          anchorArticleIDs: articleIDs,
          error: message,
        })
        upsertSummaryTask({
          kind: 'feed_briefing',
          key: taskKey,
          sourceIDs,
          sourceID: sourceIDs.length === 1 ? sourceIDs[0] : undefined,
          title: 'AI 聚合速览',
          sourceName: taskScopeLabel,
          model: aiModel,
          status: 'failed',
          updatedAt: new Date().toISOString(),
          error: message,
        })
        setNotice({
          kind: 'error',
          text: `AI 聚合速览失败: ${message}`,
        })
      } finally {
        setLoadingFeedBriefing(false)
      }
    },
    [
      activeFeedBriefingAnchorArticleIDs,
      activeFeedBriefingKeyword,
      activeFeedBriefingScopeLabel,
      activeFeedBriefingSourceIDs,
      activeFeedBriefingTaskKey,
      aiModel,
      saveFeedBriefingSnapshot,
      setFeedBriefing,
      setFeedBriefingAnchorArticleIDs,
      setFeedBriefingArticleCount,
      setFeedBriefingError,
      setFeedBriefingGeneratedAt,
      setFeedBriefingItems,
      setFeedBriefingMeta,
      setFeedBriefingScopeLabel,
      setFeedBriefingTaskKey,
      setLoadingFeedBriefing,
      setNotice,
      tagFilter,
      toErrorMessage,
      upsertSummaryTask,
    ],
  )

  return {
    applyFeedBriefingSnapshot,
    saveFeedBriefingSnapshot,
    resetFeedBriefingState,
    onGenerateFeedBriefing,
  }
}
