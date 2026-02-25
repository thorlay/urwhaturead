import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppTab, FeedBriefingSnapshot, Notice, ReaderView, SummaryTask } from '../lib/app-domain'

type UseSummaryTaskStripActionsParams = {
  feedBriefingSnapshots: Record<string, FeedBriefingSnapshot>
  applyFeedBriefingSnapshot: (snapshot: FeedBriefingSnapshot) => void
  setNotice: Dispatch<SetStateAction<Notice | null>>
  setActiveTab: Dispatch<SetStateAction<AppTab>>
  openFeedBriefing: () => void
  setReaderView: Dispatch<SetStateAction<ReaderView>>
  openArticle: (articleID: number) => Promise<void>
  removeSummaryTask: (taskKey: string) => void
}

export function useSummaryTaskStripActions({
  feedBriefingSnapshots,
  applyFeedBriefingSnapshot,
  setNotice,
  setActiveTab,
  openFeedBriefing,
  setReaderView,
  openArticle,
  removeSummaryTask,
}: UseSummaryTaskStripActionsParams) {
  const onOpenSummaryTask = useCallback(
    (task: SummaryTask) => {
      if (task.kind === 'feed_briefing') {
        const snapshot = feedBriefingSnapshots[task.key]
        if (snapshot) {
          applyFeedBriefingSnapshot(snapshot)
        } else {
          setNotice({ kind: 'info', text: '该 AI 速览未在本地缓存，请重新生成一次。' })
        }
        setActiveTab('reader')
        openFeedBriefing()
        return
      }
      if (typeof task.articleID !== 'number' || task.articleID <= 0) {
        return
      }
      setActiveTab('reader')
      setReaderView('stream')
      void openArticle(task.articleID)
    },
    [
      applyFeedBriefingSnapshot,
      feedBriefingSnapshots,
      openArticle,
      openFeedBriefing,
      setActiveTab,
      setNotice,
      setReaderView,
    ],
  )

  const onDismissSummaryTask = useCallback(
    (taskKey: string) => {
      removeSummaryTask(taskKey)
    },
    [removeSummaryTask],
  )

  return {
    onOpenSummaryTask,
    onDismissSummaryTask,
  }
}
