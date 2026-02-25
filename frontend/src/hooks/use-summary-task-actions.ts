import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { SummaryTask } from '../lib/app-domain'
import { isSummaryTaskPending, upsertSummaryTaskState } from '../lib/summary-task-utils'

type UseSummaryTaskActionsParams = {
  setSummaryTasks: Dispatch<SetStateAction<SummaryTask[]>>
  summaryTaskNotifiedRef: MutableRefObject<Set<string>>
}

export function useSummaryTaskActions({ setSummaryTasks, summaryTaskNotifiedRef }: UseSummaryTaskActionsParams) {
  const upsertSummaryTask = useCallback((task: SummaryTask) => {
    setSummaryTasks((previous) => upsertSummaryTaskState(previous, task))
  }, [setSummaryTasks])

  const removeSummaryTask = useCallback((taskKey: string) => {
    setSummaryTasks((previous) => previous.filter((task) => task.key !== taskKey))
    summaryTaskNotifiedRef.current.delete(taskKey)
  }, [setSummaryTasks, summaryTaskNotifiedRef])

  const clearCompletedSummaryTasks = useCallback(() => {
    setSummaryTasks((previous) => {
      const next = previous.filter((task) => isSummaryTaskPending(task.status))
      const keys = new Set(next.map((task) => task.key))
      for (const key of summaryTaskNotifiedRef.current) {
        if (!keys.has(key)) {
          summaryTaskNotifiedRef.current.delete(key)
        }
      }
      return next
    })
  }, [setSummaryTasks, summaryTaskNotifiedRef])

  return {
    upsertSummaryTask,
    removeSummaryTask,
    clearCompletedSummaryTasks,
  }
}
