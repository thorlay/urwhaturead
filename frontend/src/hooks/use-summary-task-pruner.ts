import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { SummaryTask } from '../lib/app-domain'
import { pruneSummaryTasks } from '../lib/summary-task-utils'

type UseSummaryTaskPrunerParams = {
  setSummaryTasks: Dispatch<SetStateAction<SummaryTask[]>>
  summaryTaskNotifiedRef: MutableRefObject<Set<string>>
}

export function useSummaryTaskPruner({
  setSummaryTasks,
  summaryTaskNotifiedRef,
}: UseSummaryTaskPrunerParams) {
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSummaryTasks((previous) => {
        const next = pruneSummaryTasks(previous)
        const keys = new Set(next.map((task) => task.key))
        for (const key of summaryTaskNotifiedRef.current) {
          if (!keys.has(key)) {
            summaryTaskNotifiedRef.current.delete(key)
          }
        }
        return next
      })
    }, 60 * 1000)
    return () => window.clearInterval(timer)
  }, [setSummaryTasks, summaryTaskNotifiedRef])
}
