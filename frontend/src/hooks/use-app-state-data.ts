import { useState } from 'react'
import type { ArticleDetail, FeedBriefingInputItem, FeedItem, Source, SourceStatus } from '../types'
import {
  aiModelOptions,
  aiModelStorageKey,
  type FeedBriefingSnapshot,
  readArticleStorageKey,
  type SummaryTask,
} from '../lib/app-domain'
import { parseStoredReadArticleIDs } from '../lib/app-utils'

export function useAppStateData() {
  const [sources, setSources] = useState<Source[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [selectedArticle, setSelectedArticle] = useState<ArticleDetail | null>(null)
  const [selectedArticleID, setSelectedArticleID] = useState<number | null>(null)
  const [articleSummary, setArticleSummary] = useState('')
  const [articleSummaryMeta, setArticleSummaryMeta] = useState('')
  const [summaryTasks, setSummaryTasks] = useState<SummaryTask[]>([])
  const [loadingArticleSummary, setLoadingArticleSummary] = useState(false)
  const [articleSummaryError, setArticleSummaryError] = useState<string | null>(null)
  const [feedBriefing, setFeedBriefing] = useState('')
  const [feedBriefingMeta, setFeedBriefingMeta] = useState('')
  const [feedBriefingItems, setFeedBriefingItems] = useState<FeedBriefingInputItem[]>([])
  const [feedBriefingArticleCount, setFeedBriefingArticleCount] = useState(0)
  const [feedBriefingScopeLabel, setFeedBriefingScopeLabel] = useState('')
  const [feedBriefingGeneratedAt, setFeedBriefingGeneratedAt] = useState('')
  const [feedBriefingAnchorArticleIDs, setFeedBriefingAnchorArticleIDs] = useState<number[]>([])
  const [feedBriefingTaskKey, setFeedBriefingTaskKey] = useState('')
  const [feedBriefingSnapshots, setFeedBriefingSnapshots] = useState<Record<string, FeedBriefingSnapshot>>({})
  const [loadingFeedBriefing, setLoadingFeedBriefing] = useState(false)
  const [feedBriefingError, setFeedBriefingError] = useState<string | null>(null)
  const [sourceStatus, setSourceStatus] = useState<SourceStatus[]>([])
  const [aiModel, setAIModel] = useState(() => {
    if (typeof window === 'undefined') {
      return aiModelOptions[0]
    }
    const cached = window.localStorage.getItem(aiModelStorageKey)?.trim()
    if (cached) {
      return cached
    }
    return aiModelOptions[0]
  })
  const [readArticleIDs, setReadArticleIDs] = useState<number[]>(() => {
    if (typeof window === 'undefined') {
      return []
    }
    return parseStoredReadArticleIDs(window.localStorage.getItem(readArticleStorageKey))
  })

  return {
    sources,
    setSources,
    feed,
    setFeed,
    selectedArticle,
    setSelectedArticle,
    selectedArticleID,
    setSelectedArticleID,
    articleSummary,
    setArticleSummary,
    articleSummaryMeta,
    setArticleSummaryMeta,
    summaryTasks,
    setSummaryTasks,
    loadingArticleSummary,
    setLoadingArticleSummary,
    articleSummaryError,
    setArticleSummaryError,
    feedBriefing,
    setFeedBriefing,
    feedBriefingMeta,
    setFeedBriefingMeta,
    feedBriefingItems,
    setFeedBriefingItems,
    feedBriefingArticleCount,
    setFeedBriefingArticleCount,
    feedBriefingScopeLabel,
    setFeedBriefingScopeLabel,
    feedBriefingGeneratedAt,
    setFeedBriefingGeneratedAt,
    feedBriefingAnchorArticleIDs,
    setFeedBriefingAnchorArticleIDs,
    feedBriefingTaskKey,
    setFeedBriefingTaskKey,
    feedBriefingSnapshots,
    setFeedBriefingSnapshots,
    loadingFeedBriefing,
    setLoadingFeedBriefing,
    feedBriefingError,
    setFeedBriefingError,
    sourceStatus,
    setSourceStatus,
    aiModel,
    setAIModel,
    readArticleIDs,
    setReadArticleIDs,
  }
}

export type AppStateData = ReturnType<typeof useAppStateData>
