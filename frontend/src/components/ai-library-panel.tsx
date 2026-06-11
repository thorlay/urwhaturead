import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MarkdownBlock, PlainTextBlock, SafeHTMLBlock } from '@/components/rich-content-blocks'
import { formatAIStopReason, normalizeImageURL } from '../lib/app-utils'
import type { ArticleDetail, ArticleSummaryLibraryItem, FeedBriefingLibraryItem, Source } from '../types'
import { ChevronDown, ChevronUp, ExternalLink, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'

type AILibraryView = 'articles' | 'briefings'
type AILibraryRange = '24h' | '7d' | '30d' | 'all'
type AILibraryStatusFilter = 'all' | 'complete' | 'truncated'
type AILibraryReviewMode = 'recent' | 'date' | 'source'

type AILibraryPanelProps = {
  search: string
  loading: boolean
  error: string | null
  activeView: AILibraryView
  timeRange: AILibraryRange
  sourceFilter: string
  statusFilter: AILibraryStatusFilter
  articleSummaries: ArticleSummaryLibraryItem[]
  feedBriefings: FeedBriefingLibraryItem[]
  readerArticle: ArticleDetail | null
  readerArticleLoading: boolean
  readerArticleError: string | null
  sources: Source[]
  formatTimeAgo: (input: string) => string
  onChangeSearch: (value: string) => void
  onApplySearch: () => void
  onRefresh: () => void
  onChangeView: (view: AILibraryView) => void
  onChangeTimeRange: (range: AILibraryRange) => void
  onChangeSourceFilter: (value: string) => void
  onChangeStatusFilter: (value: AILibraryStatusFilter) => void
  onOpenArticleSummary: (articleID: number) => Promise<void>
  onCloseArticleReader: () => void
  onOpenFeedBriefing: (item: FeedBriefingLibraryItem) => void
}

type LibrarySection<T> = {
  key: string
  label: string
  items: T[]
}

type DeepReadRecommendation = {
  title: string
  url: string
  reason: string
  audience: string
}

type BriefingArticleRef = FeedBriefingLibraryItem['article_refs'][number]

const INTERNAL_ARTICLE_LINK_PREFIX = 'quick-article://'

function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\n{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function previewText(input: string, max = 180): string {
  const plain = stripMarkdown(input)
  if (plain.length <= max) {
    return plain
  }
  return `${plain.slice(0, max).trimEnd()}...`
}

function withinRange(input: string, range: AILibraryRange): boolean {
  if (range === 'all') {
    return true
  }
  const created = new Date(input).getTime()
  if (!Number.isFinite(created)) {
    return true
  }
  const age = Date.now() - created
  const hour = 60 * 60 * 1000
  if (range === '24h') {
    return age <= 24 * hour
  }
  if (range === '7d') {
    return age <= 7 * 24 * hour
  }
  return age <= 30 * 24 * hour
}

function groupByRecency<T extends { generated_at: string }>(items: T[]): LibrarySection<T>[] {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const buckets: LibrarySection<T>[] = [
    { key: 'today', label: '今天', items: [] },
    { key: 'week', label: '最近 7 天', items: [] },
    { key: 'older', label: '更早', items: [] },
  ]

  items.forEach((item) => {
    const created = new Date(item.generated_at).getTime()
    if (!Number.isFinite(created)) {
      buckets[2].items.push(item)
      return
    }
    const age = now - created
    if (age <= day) {
      buckets[0].items.push(item)
      return
    }
    if (age <= 7 * day) {
      buckets[1].items.push(item)
      return
    }
    buckets[2].items.push(item)
  })

  return buckets.filter((bucket) => bucket.items.length > 0)
}

function groupBriefingsByDate(items: FeedBriefingLibraryItem[]): LibrarySection<FeedBriefingLibraryItem>[] {
  const sections = new Map<string, LibrarySection<FeedBriefingLibraryItem>>()
  items.forEach((item) => {
    const dateKey = generatedDateKey(item.generated_at)
    const existing = sections.get(dateKey)
    if (existing) {
      existing.items.push(item)
      return
    }
    sections.set(dateKey, {
      key: `date-${dateKey}`,
      label: formatDateSectionLabel(dateKey),
      items: [item],
    })
  })
  return Array.from(sections.values())
}

function groupBriefingsBySource(items: FeedBriefingLibraryItem[]): LibrarySection<FeedBriefingLibraryItem>[] {
  const sections = new Map<string, LibrarySection<FeedBriefingLibraryItem>>()
  items.forEach((item) => {
    const scope = item.scope_label || '当前阅读流'
    const existing = sections.get(scope)
    if (existing) {
      existing.items.push(item)
      return
    }
    sections.set(scope, {
      key: `source-${safeDOMID(scope)}`,
      label: scope,
      items: [item],
    })
  })
  return Array.from(sections.values())
}

function generatedDateKey(input: string): string {
  const date = new Date(input)
  if (!Number.isFinite(date.getTime())) {
    return 'unknown'
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateSectionLabel(dateKey: string): string {
  if (dateKey === 'unknown') {
    return '日期未知'
  }
  const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10))
  const date = new Date(year, month - 1, day)
  const today = startOfLocalDay(new Date())
  const target = startOfLocalDay(date)
  const diffDays = Math.round((today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000))
  const formatted = new Intl.DateTimeFormat('zh-Hans-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(date)
  if (diffDays === 0) {
    return `今天 · ${formatted}`
  }
  if (diffDays === 1) {
    return `昨天 · ${formatted}`
  }
  if (diffDays === 2) {
    return `前天 · ${formatted}`
  }
  return `${dateKey} · ${formatted}`
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function parseIDList(input: string): number[] {
  return input
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0)
}

function visibleAIStopReason(reason?: string, truncated?: boolean): string {
  const label = formatAIStopReason(reason, truncated)
  if (label === '正常结束' || label === '已完成') {
    return ''
  }
  return label
}

function joinMetaParts(parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ')
}

function parseDeepReadRecommendations(summary: string): DeepReadRecommendation[] {
  const lines = summary.split('\n')
  const startIndex = findDeepReadSectionIndex(lines)
  if (startIndex < 0) return []

  const recommendations: DeepReadRecommendation[] = []
  for (const rawLine of lines.slice(startIndex + 1)) {
    const plainLine = stripMarkdown(rawLine)
    if (!plainLine) continue
    if (/^(?:#{1,6}\s*)?(?:\d+[).、]\s*)?(?:今日判断|内容类型|重点主题|长文论点|风险|争议|不确定性)/.test(plainLine)) break

    const recommendation = parseDeepReadLine(rawLine)
    if (recommendation) {
      recommendations.push(recommendation)
    }
    if (recommendations.length >= 6) break
  }
  return recommendations
}

function summaryWithoutDeepReadSection(summary: string): string {
  const lines = summary.split('\n')
  const startIndex = findDeepReadSectionIndex(lines)
  if (startIndex < 0) return summary

  const endIndex = findNextBriefingSectionIndex(lines, startIndex + 1)
  const nextLines = [...lines.slice(0, startIndex), ...lines.slice(endIndex)]
  return nextLines.join('\n').trim()
}

function findDeepReadSectionIndex(lines: string[]): number {
  return lines.findIndex((line) => /(?:^|\s)(?:6[).、]\s*)?值得深读/.test(stripMarkdown(line)))
}

function findNextBriefingSectionIndex(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    const plainLine = stripMarkdown(lines[index])
    if (/^(?:\d+[).、]\s*)?(?:今日判断|内容类型|重点主题|长文论点|风险|争议|不确定性)/.test(plainLine)) {
      return index
    }
  }
  return lines.length
}

function parseDeepReadLine(rawLine: string): DeepReadRecommendation | null {
  const line = rawLine
    .trim()
    .replace(/^\s*(?:[-*+]\s+|\d+[).、]\s*)/, '')
    .trim()
  if (!line.includes('｜') && !/^https?:\/\//.test(line)) return null

  const markdownLink = line.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/)
  const bareURL = line.match(/https?:\/\/[^\s<>\])）｜|]+/)
  const url = markdownLink?.[2] ?? bareURL?.[0] ?? ''
  if (!url) return null

  const parts = line
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/, '$1')
    .split('｜')
    .map((part) => stripMarkdown(part).trim())
    .filter(Boolean)

  const title = cleanDeepReadTitle(parts[0] ?? markdownLink?.[1] ?? '原文')
  const urlPartIndex = parts.findIndex((part) => part.includes(url) || part === markdownLink?.[1] || part === '原文')
  const detailParts = parts.filter((_, index) => index !== 0 && index !== urlPartIndex)

  return {
    title,
    url,
    reason: detailParts[0] ?? '',
    audience: detailParts[1] ?? '',
  }
}

function cleanDeepReadTitle(value: string): string {
  return value
    .replace(/^\s*(?:[-*+]\s+|\d+[).、]\s*)/, '')
    .replace(/^\s*\[[A-Z]\d{1,3}\]\s*/, '')
    .replace(/\s*[|｜]\s*$/, '')
    .trim()
}

function canonicalArticleURL(input: string): string {
  const raw = input.trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    const normalized = url.toString()
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
  } catch {
    return raw.toLowerCase().replace(/\/$/, '')
  }
}

function normalizeMatchText(input: string): string {
  return stripMarkdown(input)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()
}

function findMatchingArticleRef(
  recommendation: DeepReadRecommendation,
  articleRefs: BriefingArticleRef[],
): { article: BriefingArticleRef; index: number } | null {
  const recommendationURL = canonicalArticleURL(recommendation.url)
  if (recommendationURL) {
    const byURL = articleRefs.findIndex((article) => canonicalArticleURL(article.link) === recommendationURL)
    if (byURL >= 0) {
      return { article: articleRefs[byURL], index: byURL }
    }
  }

  const recommendationTitle = normalizeMatchText(recommendation.title)
  if (!recommendationTitle) {
    return null
  }
  const byTitle = articleRefs.findIndex((article) => {
    const title = normalizeMatchText(article.title)
    return title === recommendationTitle || title.includes(recommendationTitle) || recommendationTitle.includes(title)
  })
  return byTitle >= 0 ? { article: articleRefs[byTitle], index: byTitle } : null
}

function safeDOMID(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]+/g, '-')
}

function articleRefDOMID(briefingKey: string, articleID: number): string {
  return `ai-briefing-ref-${safeDOMID(briefingKey)}-${articleID}`
}

function linkBriefingArticleReferences(summary: string, articleRefs: BriefingArticleRef[]): string {
  if (!summary || articleRefs.length === 0) {
    return summary
  }
  return summary.replace(/\[A(\d{1,3})\]/g, (match, rawIndex: string, offset: number, source: string) => {
    if (isInsideMarkdownLink(source, offset, match.length)) {
      return match
    }
    const index = Number.parseInt(rawIndex, 10)
    if (!Number.isFinite(index) || index < 1 || index > articleRefs.length) {
      return match
    }
    return `[${match}](${INTERNAL_ARTICLE_LINK_PREFIX}${index})`
  })
}

function isInsideMarkdownLink(source: string, offset: number, length: number): boolean {
  return source[offset - 1] === '[' || source[offset + length] === ']'
}

function LinkedBriefingMarkdown(props: {
  content: string
  articleRefs: BriefingArticleRef[]
  onOpenArticle: (articleID: number) => void
}) {
  const content = useMemo(
    () => linkBriefingArticleReferences(props.content, props.articleRefs),
    [props.articleRefs, props.content],
  )
  if (!content.trim()) {
    return null
  }

  return (
    <div className="markdown-block ai-library-linked-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ href, children, ...linkProps }) => {
            if (href?.startsWith(INTERNAL_ARTICLE_LINK_PREFIX)) {
              const articleIndex = Number.parseInt(href.slice(INTERNAL_ARTICLE_LINK_PREFIX.length), 10)
              const article = props.articleRefs[articleIndex - 1]
              if (article) {
                return (
                  <button
                    type="button"
                    className="ai-library-inline-article-link"
                    title={article.title}
                    onClick={() => props.onOpenArticle(article.id)}
                  >
                    {children}
                  </button>
                )
              }
            }
            return (
              <a {...linkProps} href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function AIArticleReader(props: {
  article: ArticleDetail | null
  loading: boolean
  error: string | null
  formatTimeAgo: (input: string) => string
  onClose: () => void
}) {
  const { article, loading, error, formatTimeAgo, onClose } = props
  const imageURL = normalizeImageURL(article?.image_url)
  const hasExternal = Boolean(article?.external?.content?.trim())
  const hasThread = Boolean(article?.thread)
  const threadComments = article?.thread?.comments ?? []

  if (!loading && !error && !article) {
    return null
  }

  return (
    <div className="ai-article-reader-shell" role="dialog" aria-modal="true" aria-label="AI 页面文章阅读">
      <div className="ai-article-reader-backdrop" onClick={onClose} />
      <article className="ai-article-reader-panel">
        <header className="ai-article-reader-top">
          <button type="button" className="ai-article-reader-close" onClick={onClose}>
            <X aria-hidden="true" />
            返回 AI 速览
          </button>
          {article?.link && (
            <a className="ai-article-reader-source-link" href={article.link} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              打开原文
            </a>
          )}
        </header>

        {loading && (
          <div className="ai-article-reader-loading">
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
          </div>
        )}

        {error && !loading && (
          <div className="inline-error">
            <span>{error}</span>
          </div>
        )}

        {article && !loading && (
          <div className="ai-article-reader-content">
            <div className="ai-article-reader-heading">
              <p className="ai-article-reader-meta">
                {article.source_name} · {formatTimeAgo(article.published_at ?? article.created_at)}
                {article.reply_count ? ` · ${article.reply_count} 回复` : ''}
              </p>
              <h2>{article.title}</h2>
              {article.author && <p className="hint">作者: {article.author}</p>}
            </div>

            {imageURL && (
              <figure className="ai-article-reader-image">
                <img src={imageURL} alt="" loading="eager" decoding="async" referrerPolicy="no-referrer" />
              </figure>
            )}

            <section className="ai-article-reader-body">
              {hasExternal && article.external ? (
                <>
                  {article.external.title && <p className="hint">{article.external.title}</p>}
                  <PlainTextBlock content={article.external.content} className="reading-block prose" />
                  {article.external.truncated && <p className="hint">原文较长，已截断显示。</p>}
                </>
              ) : article.content_html ? (
                <SafeHTMLBlock content={article.content_html} baseURL={article.link} />
              ) : article.content ? (
                <PlainTextBlock content={article.content} className="reading-block prose" />
              ) : article.summary ? (
                <PlainTextBlock content={article.summary} className="reading-block prose" />
              ) : (
                <p className="hint">这篇文章暂时没有可展示正文。</p>
              )}
            </section>

            {hasThread && threadComments.length > 0 && (
              <section className="ai-article-reader-comments">
                <div className="ai-article-reader-section-head">
                  <h3>讨论</h3>
                  <span className="hint">{article.thread?.total_posts ?? threadComments.length} 条</span>
                </div>
                <div className="ai-article-reader-comment-list">
                  {threadComments.slice(0, 30).map((comment) => (
                    <div key={`${comment.post_number}-${comment.link}`} className="ai-article-reader-comment">
                      <p className="ai-article-reader-comment-meta">
                        {comment.author || '匿名'} · #{comment.post_number}
                        {comment.published_at ? ` · ${formatTimeAgo(comment.published_at)}` : ''}
                      </p>
                      <PlainTextBlock content={comment.content} />
                    </div>
                  ))}
                </div>
                {threadComments.length > 30 && <p className="hint">评论较多，仅展示前 30 条。</p>}
              </section>
            )}
          </div>
        )}
      </article>
    </div>
  )
}

function shouldIgnoreEntryToggle(event: ReactMouseEvent<HTMLElement>): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return Boolean(
    target.closest('button, a, input, textarea, select, summary, details') ||
      target.closest('.ai-library-entry-expanded'),
  )
}

export function AILibraryPanel(props: AILibraryPanelProps) {
  const {
    search,
    loading,
    error,
    activeView,
    timeRange,
    sourceFilter,
    statusFilter,
    articleSummaries,
    feedBriefings,
    readerArticle,
    readerArticleLoading,
    readerArticleError,
    formatTimeAgo,
    onChangeSearch,
    onApplySearch,
    onRefresh,
    onChangeView,
    onChangeTimeRange,
    onChangeSourceFilter,
    onChangeStatusFilter,
    onOpenArticleSummary,
    onCloseArticleReader,
    onOpenFeedBriefing,
  } = props

  const articleSourceOptions = Array.from(new Set(articleSummaries.map((item) => item.source_name).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN'),
  )
  const briefingScopeOptions = Array.from(new Set(feedBriefings.map((item) => item.scope_label || '当前阅读流').filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN'),
  )

  const filteredArticles = articleSummaries.filter((item) => {
    if (!withinRange(item.generated_at, timeRange)) {
      return false
    }
    if (sourceFilter !== 'all' && item.source_name !== sourceFilter) {
      return false
    }
    if (statusFilter === 'complete' && item.truncated) {
      return false
    }
    if (statusFilter === 'truncated' && !item.truncated) {
      return false
    }
    return true
  })
  const filteredBriefings = feedBriefings.filter((item) => {
    if (!withinRange(item.generated_at, timeRange)) {
      return false
    }
    const scope = item.scope_label || '当前阅读流'
    if (sourceFilter !== 'all' && scope !== sourceFilter) {
      return false
    }
    if (statusFilter === 'complete' && item.truncated) {
      return false
    }
    if (statusFilter === 'truncated' && !item.truncated) {
      return false
    }
    return true
  })
  const articleSections = groupByRecency(filteredArticles)
  const activeCount = activeView === 'articles' ? filteredArticles.length : filteredBriefings.length
  const sourceOptions = activeView === 'articles' ? articleSourceOptions : briefingScopeOptions
  const sourceLabel = activeView === 'articles' ? '来源' : '范围'
  const [selectedArticleKey, setSelectedArticleKey] = useState<string | null>(null)
  const [selectedBriefingKey, setSelectedBriefingKey] = useState<string | null>(null)
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null)
  const [expandedBriefingArticles, setExpandedBriefingArticles] = useState<Record<string, boolean>>({})
  const [showExtraFilters, setShowExtraFilters] = useState(false)
  const [highlightedArticleRefID, setHighlightedArticleRefID] = useState<string | null>(null)
  const [briefingReviewMode, setBriefingReviewMode] = useState<AILibraryReviewMode>('recent')
  const entryRefs = useRef<Record<string, HTMLElement | null>>({})
  const extraFilterCount = (sourceFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0)
  const briefingSections = useMemo(() => {
    if (briefingReviewMode === 'date') {
      return groupBriefingsByDate(filteredBriefings)
    }
    if (briefingReviewMode === 'source') {
      return groupBriefingsBySource(filteredBriefings)
    }
    return groupByRecency(filteredBriefings)
  }, [briefingReviewMode, filteredBriefings])
  const flatArticleItems = useMemo(() => articleSections.flatMap((section) => section.items), [articleSections])
  const flatBriefingItems = useMemo(() => briefingSections.flatMap((section) => section.items), [briefingSections])
  const briefingReviewModeLabel =
    briefingReviewMode === 'date' ? '按日期回看' : briefingReviewMode === 'source' ? '按来源回看' : '最近'

  useEffect(() => {
    if (flatArticleItems.length === 0) {
      setSelectedArticleKey(null)
      return
    }
    if (selectedArticleKey) {
      const hasCurrent = flatArticleItems.some((item) => `${item.article_id}:${item.generated_at}` === selectedArticleKey)
      if (hasCurrent) {
        return
      }
      setSelectedArticleKey(null)
    }
  }, [flatArticleItems, selectedArticleKey])

  useEffect(() => {
    if (flatBriefingItems.length === 0) {
      setSelectedBriefingKey(null)
      return
    }
    if (selectedBriefingKey) {
      const hasCurrent = flatBriefingItems.some((item) => `${item.digest_key}:${item.generated_at}` === selectedBriefingKey)
      if (hasCurrent) {
        return
      }
      setSelectedBriefingKey(null)
    }
  }, [flatBriefingItems, selectedBriefingKey])

  const toggleArticleSelection = (key: string) => {
    setSelectedArticleKey((current) => {
      const next = current === key ? null : key
      if (next) setPendingScrollKey(key)
      return next
    })
  }
  const toggleBriefingSelection = (key: string) => {
    setSelectedBriefingKey((current) => {
      const next = current === key ? null : key
      if (next) setPendingScrollKey(key)
      return next
    })
  }
  const isArticleSelected = (item: ArticleSummaryLibraryItem) =>
    selectedArticleKey === `${item.article_id}:${item.generated_at}`
  const isBriefingSelected = (item: FeedBriefingLibraryItem) =>
    selectedBriefingKey === `${item.digest_key}:${item.generated_at}`
  const attachEntryRef = (key: string) => (node: HTMLElement | null) => {
    entryRefs.current[key] = node
  }
  const revealBriefingArticleRef = (briefingKey: string, articleID: number) => {
    const targetID = articleRefDOMID(briefingKey, articleID)
    setExpandedBriefingArticles((current) => ({
      ...current,
      [briefingKey]: true,
    }))
    setHighlightedArticleRefID(targetID)
    window.setTimeout(() => {
      document.getElementById(targetID)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 0)
    window.setTimeout(() => {
      setHighlightedArticleRefID((current) => (current === targetID ? null : current))
    }, 1600)
  }

  const selectedArticleIndex = flatArticleItems.findIndex((item) => `${item.article_id}:${item.generated_at}` === selectedArticleKey)
  const selectedBriefingIndex = flatBriefingItems.findIndex((item) => `${item.digest_key}:${item.generated_at}` === selectedBriefingKey)

  const selectAdjacentArticle = (offset: -1 | 1) => {
    if (selectedArticleIndex < 0) return
    const next = flatArticleItems[selectedArticleIndex + offset]
    if (!next) return
    toggleArticleSelection(`${next.article_id}:${next.generated_at}`)
  }

  const selectAdjacentBriefing = (offset: -1 | 1) => {
    if (selectedBriefingIndex < 0) return
    const next = flatBriefingItems[selectedBriefingIndex + offset]
    if (!next) return
    toggleBriefingSelection(`${next.digest_key}:${next.generated_at}`)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (event.key === 'j') {
        event.preventDefault()
        if (activeView === 'articles') {
          selectAdjacentArticle(1)
        } else {
          selectAdjacentBriefing(1)
        }
        return
      }
      if (event.key === 'k') {
        event.preventDefault()
        if (activeView === 'articles') {
          selectAdjacentArticle(-1)
        } else {
          selectAdjacentBriefing(-1)
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeView, selectedArticleIndex, selectedBriefingIndex, flatArticleItems, flatBriefingItems])

  useEffect(() => {
    if (!pendingScrollKey) return
    const node = entryRefs.current[pendingScrollKey]
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    setPendingScrollKey(null)
  }, [pendingScrollKey, selectedArticleKey, selectedBriefingKey])

  return (
    <main className="ai-library-page">
      <section className="panel ai-library-panel">
        <div className="ai-library-hero">
          <div className="ai-library-head">
            <div>
              <p className="ai-library-kicker">AI Reading</p>
              <h2>AI 速览与摘要</h2>
              <p className="hint">优先回看 AI 对阅读流做出的判断，再展开详情。</p>
            </div>
          </div>

          <div className="ai-library-compact-controls">
            <div className="ai-library-toolbar">
              <Input
                value={search}
                onChange={(event) => onChangeSearch(event.target.value)}
                placeholder="搜索摘要、来源、主题..."
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onApplySearch()
                  }
                }}
              />
              <Button type="button" className="ai-library-search-button" variant="outline" onClick={onApplySearch} disabled={loading}>
                <Search aria-hidden="true" />
                <span className="ai-library-button-text">搜索</span>
              </Button>
              <Button type="button" className="ai-library-refresh-button" variant="outline" onClick={onRefresh} disabled={loading}>
                <RefreshCw aria-hidden="true" />
                <span className="ai-library-button-text">{loading ? '更新中...' : '刷新'}</span>
              </Button>
            </div>

            <div className="ai-library-controls">
              <div className="ai-library-segmented" role="tablist" aria-label="AI 内容分类">
                <button
                  type="button"
                  className={`ai-library-segment ${activeView === 'briefings' ? 'active' : ''}`}
                  onClick={() => onChangeView('briefings')}
                >
                  AI 速览
                  <span>{filteredBriefings.length}</span>
                </button>
                <button
                  type="button"
                  className={`ai-library-segment ${activeView === 'articles' ? 'active' : ''}`}
                  onClick={() => onChangeView('articles')}
                >
                  文章摘要
                  <span>{filteredArticles.length}</span>
                </button>
              </div>

              <div className="ai-library-range-pills" role="tablist" aria-label="时间范围">
                {[
                  ['24h', '24h'],
                  ['7d', '7 天'],
                  ['30d', '30 天'],
                  ['all', '全部'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`ai-library-pill ${timeRange === value ? 'active' : ''}`}
                    onClick={() => onChangeTimeRange(value as AILibraryRange)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className={`ai-library-filter-toggle ${showExtraFilters || extraFilterCount > 0 ? 'active' : ''}`}
                onClick={() => setShowExtraFilters((current) => !current)}
                aria-expanded={showExtraFilters || extraFilterCount > 0}
                aria-controls="ai-library-extra-filters"
              >
                <SlidersHorizontal aria-hidden="true" />
                筛选
                {extraFilterCount > 0 && <span>{extraFilterCount}</span>}
              </button>

              {(showExtraFilters || extraFilterCount > 0) && (
                <div className="ai-library-filter-row" id="ai-library-extra-filters">
                  <label className="ai-library-select-label">
                    <span>{sourceLabel}</span>
                    <select className="ai-library-select" value={sourceFilter} onChange={(event) => onChangeSourceFilter(event.target.value)}>
                      <option value="all">全部{sourceLabel}</option>
                      {sourceOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ai-library-select-label">
                    <span>状态</span>
                    <select className="ai-library-select" value={statusFilter} onChange={(event) => onChangeStatusFilter(event.target.value as AILibraryStatusFilter)}>
                      <option value="all">全部</option>
                      <option value="complete">正常结束</option>
                      <option value="truncated">输出触顶/截断</option>
                    </select>
                  </label>
                </div>
              )}
            </div>

            {activeView === 'briefings' && (
              <div className="ai-library-review-modes" role="tablist" aria-label="AI 速览回看方式">
                {[
                  ['recent', '最近'],
                  ['date', '按日期'],
                  ['source', '按来源'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`ai-library-review-mode ${briefingReviewMode === value ? 'active' : ''}`}
                    onClick={() => setBriefingReviewMode(value as AILibraryReviewMode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="inline-error">
            <span>{error}</span>
          </div>
        )}

        <div className="ai-library-summary-bar">
          <p className="hint">
            当前视图共 {activeCount} 条
            {activeView === 'briefings' ? ` · ${briefingReviewModeLabel}` : ''}
            {timeRange !== 'all' ? ` · 已按 ${timeRange} 过滤` : ''}
            {sourceFilter !== 'all' ? ` · ${sourceLabel} ${sourceFilter}` : ''}
            {statusFilter !== 'all' ? ` · ${statusFilter === 'truncated' ? '只看输出触顶/截断' : '只看正常结束'}` : ''}
            {search.trim() ? ` · 关键词 “${search.trim()}”` : ''}
          </p>
        </div>

        {activeView === 'articles' && (
          <div className="ai-library-stack">
            {articleSections.length === 0 && !loading && (
              <div className="ai-library-empty">
                <h3>还没有可回看的文章摘要</h3>
                <p className="hint">先在文章详情里生成摘要。生成成功后，这里会按时间聚合展示，方便后续搜索和回看。</p>
              </div>
            )}

            {articleSections.map((section) => (
              <section key={section.key} className="ai-library-group">
                <div className="ai-library-group-head">
                  <h3>{section.label}</h3>
                  <span className="hint">{section.items.length} 条</span>
                </div>
                <div className="ai-library-list ai-library-timeline">
                  {section.items.map((item) => {
                    const articleKey = `${item.article_id}:${item.generated_at}`
                    return (
                      <article
                        ref={attachEntryRef(articleKey)}
                        key={`article-summary-${item.article_id}-${item.generated_at}`}
                        className={`ai-library-entry ai-library-entry-clickable ${isArticleSelected(item) ? 'active' : ''}`}
                        aria-expanded={isArticleSelected(item)}
                        onClick={(event) => {
                          if (shouldIgnoreEntryToggle(event)) {
                            return
                          }
                          toggleArticleSelection(articleKey)
                        }}
                      >
                        <div className="ai-library-entry-rail" aria-hidden="true">
                          <span className="ai-library-entry-dot" />
                        </div>
                        <div className="ai-library-entry-body">
                          <div className="ai-library-entry-head">
                            <div className="ai-library-entry-main">
                              <button
                                type="button"
                                className="ai-library-entry-select"
                                onClick={() => toggleArticleSelection(articleKey)}
                              >
                                <span className="ai-library-entry-title">{item.title}</span>
                              </button>
                              <p className="ai-library-entry-meta">
                                <span className="ai-library-entry-kind">文章摘要</span>
                                <span>{item.source_name}</span>
                                <span>{formatTimeAgo(item.generated_at)}</span>
                              </p>
                              <div className="ai-library-entry-chips" aria-label="摘要属性">
                                {item.truncated && <span>输出触顶</span>}
                              </div>
                            </div>
                            <div className="ai-library-entry-actions">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="ai-library-entry-expand-icon"
                                aria-label={isArticleSelected(item) ? '收起摘要' : '展开摘要'}
                                onClick={() => toggleArticleSelection(articleKey)}
                              >
                                {isArticleSelected(item) ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => void onOpenArticleSummary(item.article_id)}>
                                <ExternalLink aria-hidden="true" />
                                打开文章
                              </Button>
                            </div>
                          </div>
                          {isArticleSelected(item) ? (
                            <div className="ai-library-entry-expanded">
                              <div className="ai-library-detail-body">
                                <MarkdownBlock content={item.summary} />
                              </div>
                            </div>
                          ) : (
                            <div className="ai-library-inset">
                              <p className="ai-library-entry-preview">{previewText(item.summary, 220)}</p>
                            </div>
                          )}
                          {visibleAIStopReason(item.stop_reason, item.truncated) && (
                            <p className="ai-library-entry-foot hint">
                              {joinMetaParts([`输入 ${item.input_chars} 字符`, visibleAIStopReason(item.stop_reason, item.truncated)])}
                            </p>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {activeView === 'briefings' && (
          <div className="ai-library-stack">
            {briefingSections.length === 0 && !loading && (
              <div className="ai-library-empty">
                <h3>还没有可回看的 AI 速览</h3>
                <p className="hint">先在阅读流里生成一条 AI 聚合速览。生成成功后，这里会保留历史结果，方便回到当时的阅读视角。</p>
              </div>
            )}

            {briefingSections.map((section) => (
              <section key={section.key} className="ai-library-group">
                <div className="ai-library-group-head">
                  <h3>{section.label}</h3>
                  <span className="hint">{section.items.length} 条</span>
                </div>
                <div className="ai-library-list ai-library-timeline">
                  {section.items.map((item) => {
                    const briefingKey = `${item.digest_key}:${item.generated_at}`
                    const articleRefsExpanded = expandedBriefingArticles[briefingKey] ?? false
                    const visibleArticleRefs = articleRefsExpanded || item.article_refs.length <= 5 ? item.article_refs : item.article_refs.slice(0, 5)
                    const deepReadRecommendations = parseDeepReadRecommendations(item.summary)
                    const visibleBriefingSummary =
                      deepReadRecommendations.length > 0 ? summaryWithoutDeepReadSection(item.summary) : item.summary
                    return (
                      <article
                        ref={attachEntryRef(briefingKey)}
                        key={`feed-briefing-${item.digest_key}`}
                        className={`ai-library-entry ai-library-entry-clickable ai-library-entry-briefing ${
                          isBriefingSelected(item) ? 'active' : ''
                        }`}
                        aria-expanded={isBriefingSelected(item)}
                        onClick={(event) => {
                          if (shouldIgnoreEntryToggle(event)) {
                            return
                          }
                          toggleBriefingSelection(briefingKey)
                        }}
                      >
                        <div className="ai-library-entry-rail" aria-hidden="true">
                          <span className="ai-library-entry-dot" />
                        </div>
                        <div className="ai-library-entry-body">
                          <div className="ai-library-entry-head">
                            <div className="ai-library-entry-main">
                              <button
                                type="button"
                                className="ai-library-entry-select"
                                onClick={() => toggleBriefingSelection(briefingKey)}
                              >
                                <span className="ai-library-entry-title">{item.scope_label || '当前阅读流'}</span>
                              </button>
                              <p className="ai-library-entry-meta">
                                <span className="ai-library-entry-kind">AI 速览</span>
                                <span>{formatTimeAgo(item.generated_at)}</span>
                                <span>{item.article_count} 条信息</span>
                              </p>
                              <div className="ai-library-entry-chips" aria-label="速览属性">
                                <span>{item.article_count || parseIDList(item.article_ids).length} 条文章</span>
                                {item.truncated && <span>输出触顶</span>}
                              </div>
                            </div>
                            <div className="ai-library-entry-actions">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="ai-library-entry-expand-icon"
                                aria-label={isBriefingSelected(item) ? '收起速览' : '展开速览'}
                                onClick={() => toggleBriefingSelection(briefingKey)}
                              >
                                {isBriefingSelected(item) ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => onOpenFeedBriefing(item)}>
                                <ExternalLink aria-hidden="true" />
                                打开速览
                              </Button>
                            </div>
                          </div>
                          {isBriefingSelected(item) ? (
                            <div className="ai-library-entry-expanded">
                              <div className="ai-library-detail-body">
                                {deepReadRecommendations.length > 0 && (
                                  <div className="ai-library-deep-read">
                                    <div className="ai-library-deep-read-head">
                                      <span>值得优先读</span>
                                      <small>{deepReadRecommendations.length} 条</small>
                                    </div>
                                    <div className="ai-library-deep-read-list">
                                      {deepReadRecommendations.map((recommendation, index) => {
                                        const matchedRef = findMatchingArticleRef(recommendation, item.article_refs)
                                        return (
                                          <div key={`${recommendation.url}-${index}`} className="ai-library-deep-read-item">
                                            <span className="ai-library-deep-read-index">{index + 1}</span>
                                            <span className="ai-library-deep-read-copy">
                                              <strong>{recommendation.title}</strong>
                                              {recommendation.reason && <span>{recommendation.reason}</span>}
                                              {recommendation.audience && <small>{recommendation.audience}</small>}
                                            </span>
                                            <span className="ai-library-deep-read-actions">
                                              {matchedRef && (
                                                <button
                                                  type="button"
                                                  className="ai-library-deep-read-ref"
                                                  onClick={() => revealBriefingArticleRef(briefingKey, matchedRef.article.id)}
                                                >
                                                  原文章 #{matchedRef.index + 1}
                                                </button>
                                              )}
                                              <a
                                                className="ai-library-deep-read-open"
                                                href={recommendation.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                aria-label={`打开原文：${recommendation.title}`}
                                              >
                                                <ExternalLink aria-hidden="true" />
                                              </a>
                                            </span>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}
                                <LinkedBriefingMarkdown
                                  content={visibleBriefingSummary}
                                  articleRefs={item.article_refs}
                                  onOpenArticle={(articleID) => {
                                    void onOpenArticleSummary(articleID)
                                  }}
                                />
                              </div>
                              <div className="ai-library-detail-context">
                                <p className="ai-library-detail-footnote">
                                  {joinMetaParts([
                                    `${item.article_count || parseIDList(item.article_ids).length} 条关联文章`,
                                    `${parseIDList(item.source_ids).length} 个来源`,
                                    item.tag ? `标签 ${item.tag}` : null,
                                    item.keyword ? `关键词 ${item.keyword}` : null,
                                    item.model,
                                  ])}
                                </p>
                                {item.article_refs.length > 0 && (
                                  <div className="ai-library-detail-article-list">
                                    <button
                                      type="button"
                                      className="ai-library-detail-article-toggle"
                                      onClick={() =>
                                        setExpandedBriefingArticles((current) => ({
                                          ...current,
                                          [briefingKey]: !articleRefsExpanded,
                                        }))
                                      }
                                    >
                                      {articleRefsExpanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                                      {articleRefsExpanded ? '收起关联文章' : `查看关联文章 ${item.article_refs.length} 条`}
                                    </button>
                                    {articleRefsExpanded && (
                                      <div className="ai-library-detail-article-items">
                                        {visibleArticleRefs.map((article) => {
                                          const relatedSummary = articleSummaries.find((summary) => summary.article_id === article.id)
                                          const isSummarized = Boolean(relatedSummary)
                                          const articleNumber = item.article_refs.findIndex((ref) => ref.id === article.id) + 1
                                          const refID = articleRefDOMID(briefingKey, article.id)
                                          return (
                                            <div
                                              id={refID}
                                              key={`${item.digest_key}-${article.id}`}
                                              className={`ai-library-detail-article-item ${highlightedArticleRefID === refID ? 'highlight' : ''}`}
                                            >
                                              <span className="ai-library-detail-article-index">#{articleNumber || '?'}</span>
                                              <span className="ai-library-detail-article-content">
                                                <button
                                                  type="button"
                                                  className="ai-library-detail-article-link"
                                                  onClick={() => {
                                                    void onOpenArticleSummary(article.id)
                                                  }}
                                                >
                                                  {article.title}
                                                </button>
                                                <p className="ai-library-detail-article-meta">
                                                  <span>{article.source_name || `来源 ${article.source_id}`}</span>
                                                  {article.published_at ? <span>{formatTimeAgo(article.published_at)}</span> : null}
                                                  <span>{isSummarized ? '已收录摘要' : '打开文章详情'}</span>
                                                </p>
                                              </span>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="ai-library-inset ai-library-inset-briefing">
                              <p className="ai-library-entry-preview">{previewText(item.summary, 240)}</p>
                            </div>
                          )}
                          {joinMetaParts([
                            item.tag ? `标签 ${item.tag}` : null,
                            item.keyword ? `关键词 ${item.keyword}` : null,
                            visibleAIStopReason(item.stop_reason, item.truncated),
                          ]) && (
                            <p className="ai-library-entry-foot hint">
                              {joinMetaParts([
                                item.tag ? `标签 ${item.tag}` : null,
                                item.keyword ? `关键词 ${item.keyword}` : null,
                                visibleAIStopReason(item.stop_reason, item.truncated),
                              ])}
                            </p>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
      <AIArticleReader
        article={readerArticle}
        loading={readerArticleLoading}
        error={readerArticleError}
        formatTimeAgo={formatTimeAgo}
        onClose={onCloseArticleReader}
      />
    </main>
  )
}
