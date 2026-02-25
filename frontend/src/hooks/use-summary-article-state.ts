import { useCallback, useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { getArticleSummary } from '../api'
import { isSummaryTaskPending, summaryTaskStatusLabel } from '../lib/summary-task-utils'
import type { SummaryTask } from '../lib/app-domain'
import type { ArticleDetail, FeedItem } from '../types'

type SummaryTaskIdentity = {
  title: string
  sourceName: string
  sourceID?: number
}

type UseSummaryArticleStateParams = {
  selectedSummaryTask: SummaryTask | null
  setArticleSummaryMeta: Dispatch<SetStateAction<string>>
  summaryRequestSeqRef: MutableRefObject<number>
  setArticleSummary: Dispatch<SetStateAction<string>>
  setArticleSummaryError: Dispatch<SetStateAction<string | null>>
  feed: FeedItem[]
  selectedArticle: ArticleDetail | null
  toErrorMessage: (error: unknown) => string
}

export function useSummaryArticleState({
  selectedSummaryTask,
  setArticleSummaryMeta,
  summaryRequestSeqRef,
  setArticleSummary,
  setArticleSummaryError,
  feed,
  selectedArticle,
  toErrorMessage,
}: UseSummaryArticleStateParams) {
  useEffect(() => {
    if (!selectedSummaryTask) return
    if (!isSummaryTaskPending(selectedSummaryTask.status)) return
    setArticleSummaryMeta(`后台生成中 · ${summaryTaskStatusLabel(selectedSummaryTask.status)} · ${selectedSummaryTask.model}`)
  }, [selectedSummaryTask, setArticleSummaryMeta])

  const loadCachedSummary = useCallback(
    async (articleID: number, model: string, requestID?: number) => {
      const activeRequestID = requestID ?? ++summaryRequestSeqRef.current
      try {
        const cachedSummary = await getArticleSummary(articleID, model)
        if (activeRequestID !== summaryRequestSeqRef.current) {
          return
        }
        if (cachedSummary?.data?.summary) {
          setArticleSummary(cachedSummary.data.summary)
          setArticleSummaryMeta(`缓存命中 · ${cachedSummary.data.provider} · ${cachedSummary.data.model}`)
          setArticleSummaryError(null)
        }
      } catch (error) {
        if (activeRequestID !== summaryRequestSeqRef.current) {
          return
        }
        setArticleSummaryError(`读取缓存摘要失败: ${toErrorMessage(error)}`)
      }
    },
    [setArticleSummary, setArticleSummaryError, setArticleSummaryMeta, summaryRequestSeqRef, toErrorMessage],
  )

  const resolveSummaryTaskIdentity = useCallback(
    (articleID?: number): SummaryTaskIdentity => {
      const resolvedArticleID = typeof articleID === 'number' && articleID > 0 ? articleID : null
      if (resolvedArticleID !== null && selectedArticle?.id === resolvedArticleID) {
        return {
          title: selectedArticle.title,
          sourceName: selectedArticle.source_name,
          sourceID: selectedArticle.source_id,
        }
      }
      const item = resolvedArticleID !== null ? feed.find((entry) => entry.id === resolvedArticleID) : null
      if (item) {
        return {
          title: item.title,
          sourceName: item.source_name,
          sourceID: item.source_id,
        }
      }
      return {
        title: resolvedArticleID !== null ? `文章 #${resolvedArticleID}` : '未知文章',
        sourceName: '未知来源',
        sourceID: undefined,
      }
    },
    [feed, selectedArticle],
  )

  return {
    loadCachedSummary,
    resolveSummaryTaskIdentity,
  }
}
