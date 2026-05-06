import type { FeedBriefingInputItem, Source } from '../types'

export type Notice = {
  kind: 'info' | 'error'
  text: string
}

export type AppTab = 'reader' | 'ai' | 'sources'
export type ReaderView = 'stream' | 'detail'

export type SourceGroup = {
  key: string
  label: string
  clickTotal: number
  sources: Source[]
}

export type AppliedSourceGroupFilter = {
  key: string
  label: string
}

export type SourceContextMenuState = {
  source: Source
  x: number
  y: number
}

export type SidebarTagFilterMode = 'or' | 'and'

export type SummaryTaskStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'
export type SummaryTaskKind = 'article_summary' | 'feed_briefing'

export type SummaryTask = {
  kind: SummaryTaskKind
  key: string
  articleID?: number
  sourceIDs?: number[]
  title: string
  sourceName: string
  sourceID?: number
  model: string
  status: SummaryTaskStatus
  updatedAt: string
  error?: string
}

export type FeedBriefingSnapshot = {
  taskKey: string
  summary: string
  meta: string
  items: FeedBriefingInputItem[]
  articleCount: number
  scopeLabel: string
  generatedAt: string
  anchorArticleIDs: number[]
  error: string | null
}

export type ReaderSession = {
  articleID: number
  openedAt: number
  maxScrollProgress: number
  minDwellMs: number
}

export const threadPreviewCommentLimit = 3
export const trackedSidebarPreviewLimit = 10
export const aiModelStorageKey = 'quick.ai.model'
export const nonAdminLockedAIModel = 'gemini-3-flash-preview'
export const readArticleStorageKey = 'quick.reader.read_article_ids'
export const favoriteArticleStorageKey = 'quick.reader.favorite_article_ids'
export const readMarkMinScrollProgress = 0.3
export const sidebarTagCollapseCount = 8

export const aiModelOptions = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.5-pro-preview-06-05',
  'gemini-2.5-flash-preview-09-2025',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
]
