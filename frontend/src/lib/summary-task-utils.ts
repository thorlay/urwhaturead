import type { ArticleSummaryResponse, Source } from '../types'
import type { SummaryTask, SummaryTaskKind, SummaryTaskStatus } from './app-domain'

const maxSummaryTaskEntries = 80
const summaryTaskRetentionMs = 30 * 60 * 1000

export function isArticleSummaryReadyResponse(response: unknown): response is ArticleSummaryResponse {
  const data = (response as { data?: { summary?: unknown } } | null)?.data
  return typeof data?.summary === 'string' && data.summary.trim() !== ''
}

export function buildSummaryTaskKey(articleID: number, model: string): string {
  return `${articleID}|${model.trim().toLowerCase()}`
}

export function resolveFeedBriefingScopeLabel(sourceIDs: number[], sourceByID: Map<number, Source>, tag: string): string {
  if (sourceIDs.length === 1) {
    return sourceByID.get(sourceIDs[0])?.name || `来源 #${sourceIDs[0]}`
  }
  if (sourceIDs.length > 1) {
    return `${sourceIDs.length} 个来源`
  }
  const normalizedTag = tag.trim()
  if (normalizedTag) {
    return `标签: ${normalizedTag}`
  }
  return '当前阅读流'
}

export function buildFeedBriefingTaskKey(params: {
  model: string
  sourceIDs: number[]
  tag: string
  keyword: string
  unreadOnly: boolean
  mutedSiteKeys: string[]
}): string {
  const modelKey = params.model.trim().toLowerCase()
  const sourceKey = params.sourceIDs.length > 0 ? params.sourceIDs.join(',') : 'all'
  const tagKey = params.tag.trim().toLowerCase() || '-'
  const keywordKey = params.keyword.trim().toLowerCase() || '-'
  const unreadKey = params.unreadOnly ? 'unread:1' : 'unread:0'
  const mutedKey = params.mutedSiteKeys.length > 0 ? params.mutedSiteKeys.join(',') : '-'
  return `briefing|${modelKey}|${sourceKey}|${tagKey}|${keywordKey}|${unreadKey}|${mutedKey}`
}

export function normalizeSummaryTaskStatus(status: string): SummaryTaskStatus {
  const normalized = status.trim().toLowerCase()
  if (normalized === 'queued' || normalized === 'running' || normalized === 'succeeded' || normalized === 'failed') {
    return normalized
  }
  return 'idle'
}

export function isSummaryTaskPending(status: SummaryTaskStatus): boolean {
  return status === 'queued' || status === 'running'
}

export function isPollableArticleSummaryTask(task: SummaryTask): task is SummaryTask & { kind: 'article_summary'; articleID: number } {
  return task.kind === 'article_summary' && typeof task.articleID === 'number' && task.articleID > 0
}

export function summaryTaskKindLabel(kind: SummaryTaskKind): string {
  if (kind === 'feed_briefing') {
    return 'AI 速览'
  }
  return '文章摘要'
}

export function summaryTaskStatusLabel(status: SummaryTaskStatus): string {
  switch (status) {
    case 'queued':
      return '排队中'
    case 'running':
      return '生成中'
    case 'succeeded':
      return '已完成'
    case 'failed':
      return '失败'
    default:
      return '空闲'
  }
}

export function summaryTaskStatusPriority(status: SummaryTaskStatus): number {
  switch (status) {
    case 'running':
      return 5
    case 'queued':
      return 4
    case 'failed':
      return 3
    case 'succeeded':
      return 2
    default:
      return 1
  }
}

export function parseTimestamp(input?: string): number {
  if (!input) return 0
  const value = Date.parse(input)
  if (!Number.isFinite(value)) return 0
  return value
}

export function pruneSummaryTasks(tasks: SummaryTask[]): SummaryTask[] {
  const now = Date.now()
  const kept = tasks.filter((task) => {
    if (isSummaryTaskPending(task.status)) return true
    return now - parseTimestamp(task.updatedAt) <= summaryTaskRetentionMs
  })
  if (kept.length <= maxSummaryTaskEntries) {
    return kept
  }
  return kept.slice(0, maxSummaryTaskEntries)
}

export function upsertSummaryTaskState(previous: SummaryTask[], task: SummaryTask): SummaryTask[] {
  const merged = [task, ...previous.filter((entry) => entry.key !== task.key)]
  merged.sort((left, right) => parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt))
  return pruneSummaryTasks(merged)
}

export function isSameModel(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}
