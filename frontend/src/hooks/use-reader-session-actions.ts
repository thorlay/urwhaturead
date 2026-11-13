import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { ReaderSession } from '../lib/app-domain'
import type { ArticleDetail } from '../types'

type FinalizeReason = 'close' | 'navigate'

type UseReaderSessionActionsParams = {
  readerSessionRef: MutableRefObject<ReaderSession | null>
  setReadArticleIDs: Dispatch<SetStateAction<number[]>>
  upsertReadArticleID: (previous: number[], articleID: number) => number[]
  readMarkMinScrollProgress: number
  closeDetailMoreMenu: () => void
  closeReader: () => void
  openReaderBriefing: (mode?: 'split' | 'immersive') => void
  setLoadingArticle: Dispatch<SetStateAction<boolean>>
  setArticleError: Dispatch<SetStateAction<string | null>>
  setSelectedArticle: Dispatch<SetStateAction<ArticleDetail | null>>
  setArticleSummary: Dispatch<SetStateAction<string>>
  setArticleSummaryMeta: Dispatch<SetStateAction<string>>
  setArticleSummaryError: Dispatch<SetStateAction<string | null>>
  setLoadingArticleSummary: Dispatch<SetStateAction<boolean>>
  setExpandedThreadComments: Dispatch<SetStateAction<boolean>>
  setThreadCommentsNewestFirst: Dispatch<SetStateAction<boolean>>
  floatingDetailRef: RefObject<HTMLElement | null>
}

export function useReaderSessionActions({
  readerSessionRef,
  setReadArticleIDs,
  upsertReadArticleID,
  readMarkMinScrollProgress,
  closeDetailMoreMenu,
  closeReader,
  openReaderBriefing,
  setLoadingArticle,
  setArticleError,
  setSelectedArticle,
  setArticleSummary,
  setArticleSummaryMeta,
  setArticleSummaryError,
  setLoadingArticleSummary,
  setExpandedThreadComments,
  setThreadCommentsNewestFirst,
  floatingDetailRef,
}: UseReaderSessionActionsParams) {
  const markArticleRead = useCallback(
    (articleID: number) => {
      setReadArticleIDs((previous) => upsertReadArticleID(previous, articleID))
    },
    [setReadArticleIDs, upsertReadArticleID],
  )

  const startReaderSession = useCallback(
    (articleID: number, minDwellMs: number) => {
      readerSessionRef.current = {
        articleID,
        openedAt: Date.now(),
        maxScrollProgress: 0,
        minDwellMs,
      }
    },
    [readerSessionRef],
  )

  const finalizeReaderSession = useCallback(
    (reason: FinalizeReason) => {
      const session = readerSessionRef.current
      if (!session) return
      readerSessionRef.current = null

      if (reason === 'navigate') {
        markArticleRead(session.articleID)
        return
      }

      const dwellMs = Date.now() - session.openedAt
      if (dwellMs >= session.minDwellMs || session.maxScrollProgress >= readMarkMinScrollProgress) {
        markArticleRead(session.articleID)
      }
    },
    [markArticleRead, readMarkMinScrollProgress, readerSessionRef],
  )

  const closeFloatingReader = useCallback(() => {
    finalizeReaderSession('close')
    closeReader()
    closeDetailMoreMenu()
  }, [closeDetailMoreMenu, finalizeReaderSession, closeReader])

  const openFeedBriefing = useCallback(() => {
    finalizeReaderSession('close')
    closeDetailMoreMenu()
    setLoadingArticle(false)
    setArticleError(null)
    setSelectedArticle(null)
    setArticleSummary('')
    setArticleSummaryMeta('')
    setArticleSummaryError(null)
    setLoadingArticleSummary(false)
    setExpandedThreadComments(false)
    setThreadCommentsNewestFirst(false)
    openReaderBriefing()

    if (floatingDetailRef.current) {
      floatingDetailRef.current.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [
    closeDetailMoreMenu,
    finalizeReaderSession,
    floatingDetailRef,
    setArticleError,
    setArticleSummary,
    setArticleSummaryError,
    setArticleSummaryMeta,
    setExpandedThreadComments,
    setLoadingArticle,
    setLoadingArticleSummary,
    setSelectedArticle,
    openReaderBriefing,
    setThreadCommentsNewestFirst,
  ])

  return {
    markArticleRead,
    startReaderSession,
    finalizeReaderSession,
    closeFloatingReader,
    openFeedBriefing,
  }
}
