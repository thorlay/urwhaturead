import { useEffect, type MutableRefObject } from 'react'
import { getArticleSummary, getArticleSummaryStatus } from '../api'
import type { ArticleSummaryResponse } from '../types'
import type { Notice, SummaryTask, SummaryTaskStatus } from '../lib/app-domain'
import { isSameModel, normalizeSummaryTaskStatus } from '../lib/summary-task-utils'
import { toErrorMessage } from '../lib/app-utils'

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

  useEffect(() => {
    if (pendingArticleSummaryTasks.length === 0) {
      return
    }

    let cancelled = false

    async function pollSummaryTasks() {
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
            const statusResponse = await getArticleSummaryStatus(task.articleID, task.model)
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

            const cached = await getArticleSummary(task.articleID, task.model)
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

      if (cancelled) {
        return
      }

      let nextNotice: Notice | null = null
      for (const result of results) {
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
              `${result.cached.data.cache_hit ? '缓存命中' : '新生成'} · ${result.cached.data.provider} · ${result.cached.data.model}`,
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
    }

    void pollSummaryTasks()
    const timer = window.setInterval(() => {
      void pollSummaryTasks()
    }, 2500)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [
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
  ])
}
