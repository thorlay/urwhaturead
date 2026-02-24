import { useCallback, useMemo } from 'react'
import type { SummaryTask } from '../lib/app-domain'
import {
  isPollableArticleSummaryTask,
  isSummaryTaskPending,
  parseTimestamp,
  summaryTaskStatusPriority,
} from '../lib/summary-task-utils'

type UseSummaryTaskViewParams = {
  summaryTasks: SummaryTask[]
  sourceFilterIDs: number[]
  visibleFeedArticleIDs: number[]
  selectedArticleID: number | null
}

export function useSummaryTaskView({
  summaryTasks,
  sourceFilterIDs,
  visibleFeedArticleIDs,
  selectedArticleID,
}: UseSummaryTaskViewParams) {
  const summaryTaskByArticleID = useMemo(() => {
    const map = new Map<number, SummaryTask>()
    for (const task of summaryTasks) {
      if (task.kind !== 'article_summary' || typeof task.articleID !== 'number' || task.articleID <= 0) {
        continue
      }
      const previous = map.get(task.articleID)
      if (!previous) {
        map.set(task.articleID, task)
        continue
      }
      const pendingGap = Number(isSummaryTaskPending(task.status)) - Number(isSummaryTaskPending(previous.status))
      if (pendingGap > 0) {
        map.set(task.articleID, task)
        continue
      }
      if (pendingGap < 0) {
        continue
      }
      if (summaryTaskStatusPriority(task.status) > summaryTaskStatusPriority(previous.status)) {
        map.set(task.articleID, task)
        continue
      }
      const currentUpdated = parseTimestamp(task.updatedAt)
      const previousUpdated = parseTimestamp(previous.updatedAt)
      if (currentUpdated >= previousUpdated) {
        map.set(task.articleID, task)
      }
    }
    return map
  }, [summaryTasks])

  const scopedSummaryTasks = useMemo(() => {
    if (sourceFilterIDs.length === 0) {
      return summaryTasks
    }
    const sourceIDSet = new Set(sourceFilterIDs)
    const visibleFeedArticleIDSet = new Set(visibleFeedArticleIDs)
    return summaryTasks.filter((task) => {
      if (task.kind === 'feed_briefing') {
        if (!task.sourceIDs || task.sourceIDs.length === 0) {
          return false
        }
        return task.sourceIDs.some((sourceID) => sourceIDSet.has(sourceID))
      }
      if (typeof task.sourceID === 'number' && task.sourceID > 0) {
        return sourceIDSet.has(task.sourceID)
      }
      return typeof task.articleID === 'number' && visibleFeedArticleIDSet.has(task.articleID)
    })
  }, [sourceFilterIDs, summaryTasks, visibleFeedArticleIDs])

  const visibleSummaryTasks = useMemo(
    () =>
      [...scopedSummaryTasks]
        .sort((left, right) => {
          const statusGap = summaryTaskStatusPriority(right.status) - summaryTaskStatusPriority(left.status)
          if (statusGap !== 0) {
            return statusGap
          }
          const updatedGap = parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt)
          if (updatedGap !== 0) {
            return updatedGap
          }
          const rightID = typeof right.articleID === 'number' ? right.articleID : 0
          const leftID = typeof left.articleID === 'number' ? left.articleID : 0
          return rightID - leftID
        })
        .slice(0, 8),
    [scopedSummaryTasks],
  )

  const summaryTaskStats = useMemo(() => {
    const stats = {
      running: 0,
      queued: 0,
      failed: 0,
      succeeded: 0,
    }
    for (const task of scopedSummaryTasks) {
      if (task.status === 'running') stats.running += 1
      else if (task.status === 'queued') stats.queued += 1
      else if (task.status === 'failed') stats.failed += 1
      else if (task.status === 'succeeded') stats.succeeded += 1
    }
    return stats
  }, [scopedSummaryTasks])

  const pendingArticleSummaryTasks = useMemo(
    () => summaryTasks.filter((task) => isPollableArticleSummaryTask(task) && isSummaryTaskPending(task.status)),
    [summaryTasks],
  )

  const selectedSummaryTask = selectedArticleID ? summaryTaskByArticleID.get(selectedArticleID) ?? null : null

  const getSummaryTaskStatus = useCallback(
    (articleID: number) => summaryTaskByArticleID.get(articleID)?.status ?? null,
    [summaryTaskByArticleID],
  )

  return {
    visibleSummaryTasks,
    summaryTaskStats,
    pendingArticleSummaryTasks,
    selectedSummaryTask,
    getSummaryTaskStatus,
  }
}
