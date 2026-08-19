import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import { getArticle, summarizeArticle, trackArticleThread } from '../api'
import type { Notice, ReaderSession, SummaryTask } from '../lib/app-domain'
import {
  formatAIStopReason,
  isTrackableForumLink,
  normalizeSourceKind,
  resolveReadDwellThresholdMs,
  toErrorMessage,
} from '../lib/app-utils'
import {
  buildSummaryTaskKey,
  isArticleSummaryReadyResponse,
  normalizeSummaryTaskStatus,
} from '../lib/summary-task-utils'
import type { ArticleDetail, Source } from '../types'

type SummaryTaskIdentity = {
  title: string
  sourceName: string
  sourceID?: number
}

type UseReaderArticleActionsParams = {
  aiModel: string
  selectedArticleID: number | null
  sourceByID: Map<number, Source>
  readerSessionRef: MutableRefObject<ReaderSession | null>
  articleRequestSeqRef: MutableRefObject<number>
  summaryRequestSeqRef: MutableRefObject<number>
  summaryTaskNotifiedRef: MutableRefObject<Set<string>>
  closeDetailMoreMenu: () => void
  finalizeReaderSession: (reason: 'close' | 'navigate') => void
  startReaderSession: (articleID: number, minDwellMs: number) => void
  loadCachedSummary: (articleID: number, model: string, requestID?: number) => Promise<void>
  resolveSummaryTaskIdentity: (articleID?: number) => SummaryTaskIdentity
  upsertSummaryTask: (task: SummaryTask) => void
  setLoadingArticle: Dispatch<SetStateAction<boolean>>
  setReaderView: Dispatch<SetStateAction<'stream' | 'detail'>>
  setShowFloatingReader: Dispatch<SetStateAction<boolean>>
  setArticleError: Dispatch<SetStateAction<string | null>>
  setSelectedFeedBriefing: Dispatch<SetStateAction<boolean>>
  setSelectedArticleID: Dispatch<SetStateAction<number | null>>
  setArticleSummary: Dispatch<SetStateAction<string>>
  setArticleSummaryMeta: Dispatch<SetStateAction<string>>
  setArticleSummaryError: Dispatch<SetStateAction<string | null>>
  setLoadingArticleSummary: Dispatch<SetStateAction<boolean>>
  setExpandedThreadComments: Dispatch<SetStateAction<boolean>>
  setThreadCommentsNewestFirst: Dispatch<SetStateAction<boolean>>
  setSelectedArticle: Dispatch<SetStateAction<ArticleDetail | null>>
  floatingDetailRef: RefObject<HTMLElement | null>
  setNotice: Dispatch<SetStateAction<Notice | null>>
  loadSources: () => Promise<void>
  refreshStatusIfVisible: () => Promise<void>
}

export function useReaderArticleActions({
  aiModel,
  selectedArticleID,
  sourceByID,
  readerSessionRef,
  articleRequestSeqRef,
  summaryRequestSeqRef,
  summaryTaskNotifiedRef,
  closeDetailMoreMenu,
  finalizeReaderSession,
  startReaderSession,
  loadCachedSummary,
  resolveSummaryTaskIdentity,
  upsertSummaryTask,
  setLoadingArticle,
  setReaderView,
  setShowFloatingReader,
  setArticleError,
  setSelectedFeedBriefing,
  setSelectedArticleID,
  setArticleSummary,
  setArticleSummaryMeta,
  setArticleSummaryError,
  setLoadingArticleSummary,
  setExpandedThreadComments,
  setThreadCommentsNewestFirst,
  setSelectedArticle,
  floatingDetailRef,
  setNotice,
  loadSources,
  refreshStatusIfVisible,
}: UseReaderArticleActionsParams) {
  const openArticle = useCallback(
    async (articleID: number) => {
      const activeSession = readerSessionRef.current
      if (activeSession && activeSession.articleID !== articleID) {
        finalizeReaderSession('navigate')
      }

      const articleRequestID = ++articleRequestSeqRef.current
      const summaryRequestID = ++summaryRequestSeqRef.current
      try {
        setLoadingArticle(true)
        closeDetailMoreMenu()
        setReaderView('stream')
        setShowFloatingReader(true)
        setArticleError(null)
        setSelectedFeedBriefing(false)
        setSelectedArticleID(articleID)
        setArticleSummary('')
        setArticleSummaryMeta('')
        setArticleSummaryError(null)
        setLoadingArticleSummary(false)
        setExpandedThreadComments(false)
        setThreadCommentsNewestFirst(false)

        if (floatingDetailRef.current) {
          floatingDetailRef.current.scrollTo({ top: 0, behavior: 'auto' })
        }

        const detail = await getArticle(articleID)
        if (articleRequestID !== articleRequestSeqRef.current) {
          return
        }
        setSelectedArticle(detail)
        setExpandedThreadComments(isTrackableForumLink(detail.link))
        setThreadCommentsNewestFirst(normalizeSourceKind(sourceByID.get(detail.source_id)?.kind) === 'thread')
        startReaderSession(articleID, resolveReadDwellThresholdMs(detail))
        void loadCachedSummary(articleID, aiModel, summaryRequestID)
      } catch (error) {
        if (articleRequestID !== articleRequestSeqRef.current) {
          return
        }
        const message = toErrorMessage(error)
        setArticleError(message)
        setNotice({
          kind: 'error',
          text: `加载文章详情失败: ${message}`,
        })
      } finally {
        if (articleRequestID === articleRequestSeqRef.current) {
          setLoadingArticle(false)
        }
      }
    },
    [
      aiModel,
      articleRequestSeqRef,
      closeDetailMoreMenu,
      finalizeReaderSession,
      floatingDetailRef,
      loadCachedSummary,
      readerSessionRef,
      setArticleError,
      setArticleSummary,
      setArticleSummaryError,
      setArticleSummaryMeta,
      setExpandedThreadComments,
      setLoadingArticle,
      setLoadingArticleSummary,
      setNotice,
      setReaderView,
      setSelectedArticle,
      setSelectedArticleID,
      setSelectedFeedBriefing,
      setShowFloatingReader,
      setThreadCommentsNewestFirst,
      sourceByID,
      startReaderSession,
      summaryRequestSeqRef,
    ],
  )

  const onSummarizeArticle = useCallback(
    async (refresh = false) => {
      if (!selectedArticleID || selectedArticleID <= 0) {
        setNotice({ kind: 'error', text: '当前文章不支持 AI 摘要。' })
        return
      }

      const requestID = ++summaryRequestSeqRef.current
      const articleID = selectedArticleID

      try {
        setLoadingArticleSummary(true)
        setArticleSummaryError(null)
        const response = await summarizeArticle(articleID, refresh, aiModel)
        if (requestID !== summaryRequestSeqRef.current) {
          return
        }
        if (isArticleSummaryReadyResponse(response)) {
          setArticleSummary(response.data.summary)
          setArticleSummaryMeta(
            `${response.data.cache_hit ? '缓存命中' : '新生成'} · ${response.data.provider} · ${response.data.model} · ${formatAIStopReason(
              response.data.stop_reason,
              response.data.truncated,
            )}`,
          )
          setNotice({ kind: 'info', text: response.data.cache_hit ? '已加载缓存摘要。' : 'AI 摘要已生成。' })
          return
        }

        if (response.data.status === 'failed') {
          throw new Error(response.data.error || 'AI 摘要生成失败')
        }

        const taskModel = response.data.model?.trim() || aiModel
        const taskKey = buildSummaryTaskKey(articleID, taskModel)
        const identity = resolveSummaryTaskIdentity(articleID)
        summaryTaskNotifiedRef.current.delete(taskKey)
        upsertSummaryTask({
          kind: 'article_summary',
          key: taskKey,
          articleID,
          title: identity.title,
          sourceName: identity.sourceName,
          sourceID: identity.sourceID,
          model: taskModel,
          status: normalizeSummaryTaskStatus(response.data.status),
          updatedAt: response.data.updated_at || new Date().toISOString(),
          error: response.data.error,
        })
        setArticleSummaryMeta(`后台生成中 · ${response.data.status} · ${taskModel}`)
      } catch (error) {
        if (requestID !== summaryRequestSeqRef.current) {
          return
        }
        const message = toErrorMessage(error)
        setArticleSummaryError(message)
        const identity = resolveSummaryTaskIdentity(articleID)
        const taskKey = buildSummaryTaskKey(articleID, aiModel)
        upsertSummaryTask({
          kind: 'article_summary',
          key: taskKey,
          articleID,
          title: identity.title,
          sourceName: identity.sourceName,
          sourceID: identity.sourceID,
          model: aiModel,
          status: 'failed',
          updatedAt: new Date().toISOString(),
          error: message,
        })
        setNotice({ kind: 'error', text: `AI 摘要失败: ${message}` })
      } finally {
        if (requestID === summaryRequestSeqRef.current) {
          setLoadingArticleSummary(false)
        }
      }
    },
    [
      aiModel,
      resolveSummaryTaskIdentity,
      selectedArticleID,
      setArticleSummary,
      setArticleSummaryError,
      setArticleSummaryMeta,
      setLoadingArticleSummary,
      setNotice,
      summaryRequestSeqRef,
      summaryTaskNotifiedRef,
      upsertSummaryTask,
    ],
  )

  const onTrackThread = useCallback(async () => {
    if (!selectedArticleID) {
      setNotice({ kind: 'error', text: '请先选择文章。' })
      return
    }
    try {
      const response = await trackArticleThread(selectedArticleID)
      setNotice({
        kind: 'info',
        text: response.created
          ? `已开始持续跟踪评论：${response.source.name}`
          : `该帖子已在跟踪中：${response.source.name}`,
      })
      await loadSources()
      await refreshStatusIfVisible()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `持续跟踪失败: ${toErrorMessage(error)}`,
      })
    }
  }, [loadSources, refreshStatusIfVisible, selectedArticleID, setNotice])

  return {
    openArticle,
    onSummarizeArticle,
    onTrackThread,
  }
}
