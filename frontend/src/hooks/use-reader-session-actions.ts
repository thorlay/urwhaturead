import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { ReaderSession, ReaderView } from '../lib/app-domain'
import type { ArticleDetail } from '../types'

type FinalizeReason = 'close' | 'navigate'

type UseReaderSessionActionsParams = {
  readerSessionRef: MutableRefObject<ReaderSession | null>
  setReadArticleIDs: Dispatch<SetStateAction<number[]>>
  upsertReadArticleID: (previous: number[], articleID: number) => number[]
  readMarkMinScrollProgress: number
  closeDetailMoreMenu: () => void
  setShowFloatingReader: Dispatch<SetStateAction<boolean>>
  articleRequestSeqRef: MutableRefObject<number>
  summaryRequestSeqRef: MutableRefObject<number>
  setLoadingArticle: Dispatch<SetStateAction<boolean>>
  setArticleError: Dispatch<SetStateAction<string | null>>
  setSelectedArticle: Dispatch<SetStateAction<ArticleDetail | null>>
  setSelectedArticleID: Dispatch<SetStateAction<number | null>>
  setSelectedFeedBriefing: Dispatch<SetStateAction<boolean>>
  setArticleSummary: Dispatch<SetStateAction<string>>
  setArticleSummaryMeta: Dispatch<SetStateAction<string>>
  setArticleSummaryError: Dispatch<SetStateAction<string | null>>
  setLoadingArticleSummary: Dispatch<SetStateAction<boolean>>
  setExpandedThreadComments: Dispatch<SetStateAction<boolean>>
  setThreadCommentsNewestFirst: Dispatch<SetStateAction<boolean>>
  setReaderView: Dispatch<SetStateAction<ReaderView>>
  floatingDetailRef: RefObject<HTMLElement | null>
}

export function useReaderSessionActions({
  readerSessionRef,
  setReadArticleIDs,
  upsertReadArticleID,
  readMarkMinScrollProgress,
  closeDetailMoreMenu,
  setShowFloatingReader,
  articleRequestSeqRef,
  summaryRequestSeqRef,
  setLoadingArticle,
  setArticleError,
  setSelectedArticle,
  setSelectedArticleID,
  setSelectedFeedBriefing,
  setArticleSummary,
  setArticleSummaryMeta,
  setArticleSummaryError,
  setLoadingArticleSummary,
  setExpandedThreadComments,
  setThreadCommentsNewestFirst,
  setReaderView,
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
    setShowFloatingReader(false)
    closeDetailMoreMenu()
  }, [closeDetailMoreMenu, finalizeReaderSession, setShowFloatingReader])

  const openFeedBriefing = useCallback(() => {
    finalizeReaderSession('close')
    ++articleRequestSeqRef.current
    ++summaryRequestSeqRef.current
    closeDetailMoreMenu()
    setLoadingArticle(false)
    setArticleError(null)
    setSelectedArticle(null)
    setSelectedArticleID(null)
    setSelectedFeedBriefing(true)
    setArticleSummary('')
    setArticleSummaryMeta('')
    setArticleSummaryError(null)
    setLoadingArticleSummary(false)
    setExpandedThreadComments(false)
    setThreadCommentsNewestFirst(false)
    setReaderView('stream')
    setShowFloatingReader(true)

    if (floatingDetailRef.current) {
      floatingDetailRef.current.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [
    articleRequestSeqRef,
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
    setReaderView,
    setSelectedArticle,
    setSelectedArticleID,
    setSelectedFeedBriefing,
    setShowFloatingReader,
    setThreadCommentsNewestFirst,
    summaryRequestSeqRef,
  ])

  return {
    markArticleRead,
    startReaderSession,
    finalizeReaderSession,
    closeFloatingReader,
    openFeedBriefing,
  }
}
