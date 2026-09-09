import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { createFeedBriefing, getFeedBriefingResult, getFeedBriefingStatus } from '../api'
import type { FeedBriefingSnapshot, Notice, SummaryTask } from '../lib/app-domain'
import type { FeedBriefingInputItem, FeedBriefingResponse, FeedBriefingTaskResponse } from '../types'

const feedBriefingPollIntervalMs = 2500
const feedBriefingPollAttempts = 120

function isFeedBriefingResult(
  response: FeedBriefingResponse | FeedBriefingTaskResponse,
): response is FeedBriefingResponse {
  return 'summary' in response.data
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

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

export type FeedBriefingGenerationRequest = {
  articleIDs: number[]
  sourceIDs?: number[]
  scopeLabel: string
  taskKey: string
  title?: string
  tag?: string
  keyword?: string
  refresh?: boolean
  selectOnSuccess?: boolean
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

  const generateFeedBriefing = useCallback(
    async (request: FeedBriefingGenerationRequest) => {
      const articleIDs = request.articleIDs
      if (articleIDs.length === 0) {
        setNotice({ kind: 'error', text: '当前没有可用文章，无法生成 AI 速览。' })
        return false
      }
      const sourceIDs = request.sourceIDs ?? []
      const taskScopeLabel = request.scopeLabel
      const taskKey = request.taskKey
      const taskTitle = request.title || 'AI 聚合速览'
      setFeedBriefingTaskKey(taskKey)
      setFeedBriefingScopeLabel(taskScopeLabel)
      setFeedBriefingAnchorArticleIDs(articleIDs)
      upsertSummaryTask({
        kind: 'feed_briefing',
        key: taskKey,
        sourceIDs,
        sourceID: sourceIDs.length === 1 ? sourceIDs[0] : undefined,
        title: taskTitle,
        sourceName: taskScopeLabel,
        model: aiModel,
        status: 'queued',
        updatedAt: new Date().toISOString(),
        error: '',
      })

      try {
        setLoadingFeedBriefing(true)
        setFeedBriefingError(null)
        const payload = {
          limit: Math.min(articleIDs.length, 30),
          tag: request.tag || undefined,
          keyword: request.keyword || undefined,
          model: aiModel,
          source_ids: sourceIDs.length > 0 ? sourceIDs : undefined,
          article_ids: articleIDs,
          refresh: request.refresh ?? false,
          async: true,
        }
        const accepted = await createFeedBriefing(payload)
        let response: FeedBriefingResponse
        if (isFeedBriefingResult(accepted)) {
          response = accepted
        } else {
          const digestKey = accepted.data.digest_key
          upsertSummaryTask({
            kind: 'feed_briefing',
            key: taskKey,
            sourceIDs,
            sourceID: sourceIDs.length === 1 ? sourceIDs[0] : undefined,
            title: taskTitle,
            sourceName: taskScopeLabel,
            model: accepted.data.model || aiModel,
            status: accepted.data.status,
            updatedAt: accepted.data.updated_at || new Date().toISOString(),
            error: accepted.data.error || '',
          })

          let completed: FeedBriefingResponse | null = null
          for (let attempt = 0; attempt < feedBriefingPollAttempts; attempt += 1) {
            if (attempt > 0) {
              await wait(feedBriefingPollIntervalMs)
            }
            const statusResponse = await getFeedBriefingStatus(digestKey)
            const status = statusResponse.data.status
            upsertSummaryTask({
              kind: 'feed_briefing',
              key: taskKey,
              sourceIDs,
              sourceID: sourceIDs.length === 1 ? sourceIDs[0] : undefined,
              title: taskTitle,
              sourceName: taskScopeLabel,
              model: statusResponse.data.model || aiModel,
              status,
              updatedAt: statusResponse.data.updated_at || new Date().toISOString(),
              error: statusResponse.data.error || '',
            })
            if (status === 'failed') {
              throw new Error(statusResponse.data.error || 'AI 速览生成失败')
            }
            if (status === 'succeeded') {
              completed = await getFeedBriefingResult(digestKey)
              if (completed) {
                break
              }
            }
          }
          if (!completed) {
            throw new Error('AI 速览生成超时，任务仍可能在后台继续执行')
          }
          response = completed
        }
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
          title: taskTitle,
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
          text: response.data.cache_hit ? `已加载缓存${taskTitle}。` : `${taskTitle}已生成。`,
        })
        if (request.selectOnSuccess) {
          setSelectedFeedBriefing(true)
        }
        return true
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
          title: taskTitle,
          sourceName: taskScopeLabel,
          model: aiModel,
          status: 'failed',
          updatedAt: new Date().toISOString(),
          error: message,
        })
        setNotice({
          kind: 'error',
          text: `${taskTitle}失败: ${message}`,
        })
        return false
      } finally {
        setLoadingFeedBriefing(false)
      }
    },
    [
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
      setSelectedFeedBriefing,
      toErrorMessage,
      upsertSummaryTask,
    ],
  )

  const onGenerateFeedBriefing = useCallback(
    async (refresh = false) => {
      await generateFeedBriefing({
        articleIDs: activeFeedBriefingAnchorArticleIDs,
        sourceIDs: activeFeedBriefingSourceIDs,
        scopeLabel: activeFeedBriefingScopeLabel,
        taskKey: activeFeedBriefingTaskKey,
        tag: tagFilter,
        keyword: activeFeedBriefingKeyword,
        refresh,
      })
    },
    [
      activeFeedBriefingAnchorArticleIDs,
      activeFeedBriefingKeyword,
      activeFeedBriefingScopeLabel,
      activeFeedBriefingSourceIDs,
      activeFeedBriefingTaskKey,
      generateFeedBriefing,
      tagFilter,
    ],
  )

  return {
    applyFeedBriefingSnapshot,
    saveFeedBriefingSnapshot,
    resetFeedBriefingState,
    generateFeedBriefing,
    onGenerateFeedBriefing,
  }
}
