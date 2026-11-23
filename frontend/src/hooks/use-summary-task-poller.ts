import { useEffect, useEffectEvent, type MutableRefObject } from 'react'
import { getArticleSummary, getArticleSummaryStatus } from '../api'
import type { ArticleSummaryResponse } from '../types'
import type { Notice, SummaryTask, SummaryTaskStatus } from '../lib/app-domain'
import { isSameModel, normalizeSummaryTaskStatus } from '../lib/summary-task-utils'
import { formatAIStopReason, toErrorMessage } from '../lib/app-utils'

type SummaryTaskIdentity = {
  title: string
  sourceName: string
  sourceID?: number
}

type UseSummaryTaskPollerParams = {
  aiModel: string
  pendingArticleSummaryTasks: SummaryTask[]
  resolveSummaryTaskIdentity: (articleID?: number) => SummaryTaskIdentity
  selectedArticleID: number | null
  upsertSummaryTask: (task: SummaryTask) => void
  setArticleSummary: (value: string) => void
  setArticleSummaryMeta: (value: string) => void
  setArticleSummaryError: (value: string | null) => void
  setNotice: (notice: Notice) => void
  summaryTaskNotifiedRef: MutableRefObject<Set<string>>
}

type SummaryTaskPollResult = {
  task: SummaryTask
  status: SummaryTaskStatus
  updatedAt: string
  error?: string
  cached: ArticleSummaryResponse | null
}

export function useSummaryTaskPoller(params: UseSummaryTaskPollerParams) {
  const {
    aiModel,
    pendingArticleSummaryTasks,
    resolveSummaryTaskIdentity,
    selectedArticleID,
    upsertSummaryTask,
    setArticleSummary,
    setArticleSummaryMeta,
    setArticleSummaryError,
    setNotice,
    summaryTaskNotifiedRef,
  } = params

  const applyResults = useEffectEvent((results: SummaryTaskPollResult[]) => {
    let nextNotice: Notice | null = null
    for (const result of results) {
      // Removed or replaced tasks must not be resurrected by a late response.
      if (!pendingArticleSummaryTasks.includes(result.task)) continue
      if (typeof result.task.articleID !== 'number' || result.task.articleID <= 0) {
        continue
      }
      const articleID = result.task.articleID
      const identity = resolveSummaryTaskIdentity(articleID)
      const updatedTask: SummaryTask = {
        ...result.task,
        title: identity.title,
        sourceName: identity.sourceName,
        sourceID: identity.sourceID,
        status: result.status,
        updatedAt: result.updatedAt,
        error: result.error,
      }
      upsertSummaryTask(updatedTask)

      if (result.status === 'succeeded' && result.cached?.data?.summary) {
        if (selectedArticleID === articleID && isSameModel(result.task.model, aiModel)) {
          setArticleSummary(result.cached.data.summary)
          setArticleSummaryMeta(
            `${result.cached.data.cache_hit ? '缓存命中' : '新生成'} · ${result.cached.data.provider} · ${
              result.cached.data.model
            } · ${formatAIStopReason(result.cached.data.stop_reason, result.cached.data.truncated)}`,
          )
          setArticleSummaryError(null)
        }
        if (!summaryTaskNotifiedRef.current.has(result.task.key)) {
          summaryTaskNotifiedRef.current.add(result.task.key)
          if (!nextNotice) {
            nextNotice = {
              kind: 'info',
              text: `AI 摘要已完成：${identity.title}`,
            }
          }
        }
        continue
      }

      if (result.status === 'failed' && !summaryTaskNotifiedRef.current.has(result.task.key)) {
        summaryTaskNotifiedRef.current.add(result.task.key)
        if (!nextNotice) {
          nextNotice = {
            kind: 'error',
            text: `AI 摘要失败：${identity.title} · ${result.error || '未知错误'}`,
          }
        }
      }
    }

    if (nextNotice) {
      setNotice(nextNotice)
    }
  })

  const pollSummaryTasks = useEffectEvent(async (signal: AbortSignal) => {
    const tasksSnapshot = pendingArticleSummaryTasks
    const results = await Promise.all(
      tasksSnapshot.map(async (task) => {
        if (typeof task.articleID !== 'number' || task.articleID <= 0) {
          return {
            task,
            status: 'failed' as SummaryTaskStatus,
            updatedAt: new Date().toISOString(),
            error: '任务状态无效，请重试',
            cached: null as ArticleSummaryResponse | null,
          }
        }
        try {
          const statusResponse = await getArticleSummaryStatus(task.articleID, task.model, signal)
          const nextStatus = normalizeSummaryTaskStatus(statusResponse.data.status)
          const updatedAt = statusResponse.data.updated_at || new Date().toISOString()

          if (nextStatus === 'failed') {
            return {
              task,
              status: nextStatus,
              updatedAt,
              error: statusResponse.data.error || 'AI 摘要生成失败',
              cached: null as ArticleSummaryResponse | null,
            }
          }
          if (nextStatus === 'idle') {
            return {
              task,
              status: 'failed' as SummaryTaskStatus,
              updatedAt,
              error: '任务状态已丢失，请重试',
              cached: null as ArticleSummaryResponse | null,
            }
          }

          if (nextStatus !== 'succeeded') {
            return {
              task,
              status: nextStatus,
              updatedAt,
              error: statusResponse.data.error,
              cached: null as ArticleSummaryResponse | null,
            }
          }

          const cached = await getArticleSummary(task.articleID, task.model, signal)
          if (!cached?.data?.summary) {
            return {
              task,
              status: 'running' as SummaryTaskStatus,
              updatedAt,
              error: '',
              cached: null as ArticleSummaryResponse | null,
            }
          }

          return {
            task,
            status: 'succeeded' as SummaryTaskStatus,
            updatedAt: cached.data.generated_at || updatedAt,
            error: '',
            cached,
          }
        } catch (error) {
          return {
            task,
            status: 'failed' as SummaryTaskStatus,
            updatedAt: new Date().toISOString(),
            error: toErrorMessage(error),
            cached: null as ArticleSummaryResponse | null,
          }
        }
      }),
    )

    if (!signal.aborted) applyResults(results)
  })

  const hasPendingTasks = pendingArticleSummaryTasks.length > 0
  useEffect(() => {
    if (!hasPendingTasks) return

    const controller = new AbortController()
    let timer: number | undefined
    // Schedule after completion, so slow responses cannot overlap. Task updates
    // and article selection changes do not reset the polling delay.
    async function poll() {
      try {
        await pollSummaryTasks(controller.signal)
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), 2500)
      }
    }
    void poll()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [hasPendingTasks])
}
