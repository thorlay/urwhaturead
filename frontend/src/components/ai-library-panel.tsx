import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MarkdownBlock } from '@/components/rich-content-blocks'
import { formatAIStopReason } from '../lib/app-utils'
import type { ArticleSummaryLibraryItem, FeedBriefingLibraryItem, Source } from '../types'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, ExternalLink, Pin, PinOff, RefreshCw, Search } from 'lucide-react'

type AILibraryView = 'articles' | 'briefings'
type AILibraryRange = '24h' | '7d' | '30d' | 'all'
type AILibraryStatusFilter = 'all' | 'complete' | 'truncated'
type AILibraryPinnedFilter = 'all' | 'pinned'

type AILibraryPanelProps = {
  aiModel: string
  search: string
  loading: boolean
  error: string | null
  activeView: AILibraryView
  timeRange: AILibraryRange
  sourceFilter: string
  statusFilter: AILibraryStatusFilter
  pinnedFilter: AILibraryPinnedFilter
  pinnedKeys: string[]
  articleSummaries: ArticleSummaryLibraryItem[]
  feedBriefings: FeedBriefingLibraryItem[]
  sources: Source[]
  formatTimeAgo: (input: string) => string
  onChangeSearch: (value: string) => void
  onApplySearch: () => void
  onRefresh: () => void
  onChangeView: (view: AILibraryView) => void
  onChangeTimeRange: (range: AILibraryRange) => void
  onChangeSourceFilter: (value: string) => void
  onChangeStatusFilter: (value: AILibraryStatusFilter) => void
  onChangePinnedFilter: (value: AILibraryPinnedFilter) => void
  onTogglePinnedKey: (key: string) => void
  onOpenArticleSummary: (articleID: number) => Promise<void>
  onOpenFeedBriefing: (item: FeedBriefingLibraryItem) => void
}

type LibrarySection<T> = {
  key: string
  label: string
  items: T[]
}

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

function splitPinnedSections<T extends { generated_at: string }>(
  items: T[],
  isPinned: (item: T) => boolean,
): LibrarySection<T>[] {
  const pinnedItems = items.filter(isPinned)
  const regularItems = items.filter((item) => !isPinned(item))
  const sections: LibrarySection<T>[] = []
  if (pinnedItems.length > 0) {
    sections.push({
      key: 'pinned',
      label: '已固定',
      items: pinnedItems,
    })
  }
  return sections.concat(groupByRecency(regularItems))
}

export function AILibraryPanel(props: AILibraryPanelProps) {
  const {
    aiModel,
    search,
    loading,
    error,
    activeView,
    timeRange,
    sourceFilter,
    statusFilter,
    pinnedFilter,
    pinnedKeys,
    articleSummaries,
    feedBriefings,
    sources,
    formatTimeAgo,
    onChangeSearch,
    onApplySearch,
    onRefresh,
    onChangeView,
    onChangeTimeRange,
    onChangeSourceFilter,
    onChangeStatusFilter,
    onChangePinnedFilter,
    onTogglePinnedKey,
    onOpenArticleSummary,
    onOpenFeedBriefing,
  } = props

  const articleSourceOptions = Array.from(new Set(articleSummaries.map((item) => item.source_name).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN'),
  )
  const briefingScopeOptions = Array.from(new Set(feedBriefings.map((item) => item.scope_label || '当前阅读流').filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN'),
  )

  const pinnedKeySet = useMemo(() => new Set(pinnedKeys), [pinnedKeys])
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
    if (pinnedFilter === 'pinned' && !pinnedKeySet.has(`article:${item.article_id}:${item.generated_at}`)) {
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
    if (pinnedFilter === 'pinned' && !pinnedKeySet.has(`briefing:${item.digest_key}:${item.generated_at}`)) {
      return false
    }
    return true
  })
  const articleSections = splitPinnedSections(filteredArticles, (item) => pinnedKeySet.has(`article:${item.article_id}:${item.generated_at}`))
  const briefingSections = splitPinnedSections(
    filteredBriefings,
    (item) => pinnedKeySet.has(`briefing:${item.digest_key}:${item.generated_at}`),
  )
  const activeCount = activeView === 'articles' ? filteredArticles.length : filteredBriefings.length
  const sourceOptions = activeView === 'articles' ? articleSourceOptions : briefingScopeOptions
  const sourceLabel = activeView === 'articles' ? '来源' : '范围'
  const flatArticleItems = useMemo(() => articleSections.flatMap((section) => section.items), [articleSections])
  const flatBriefingItems = useMemo(() => briefingSections.flatMap((section) => section.items), [briefingSections])
  const [selectedArticleKey, setSelectedArticleKey] = useState<string | null>(null)
  const [selectedBriefingKey, setSelectedBriefingKey] = useState<string | null>(null)
  const [articleSelectionInitialized, setArticleSelectionInitialized] = useState(false)
  const [briefingSelectionInitialized, setBriefingSelectionInitialized] = useState(false)
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null)
  const [expandedBriefingArticles, setExpandedBriefingArticles] = useState<Record<string, boolean>>({})
  const entryRefs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    if (flatArticleItems.length === 0) {
      setSelectedArticleKey(null)
      setArticleSelectionInitialized(false)
      return
    }
    if (selectedArticleKey) {
      const hasCurrent = flatArticleItems.some((item) => `${item.article_id}:${item.generated_at}` === selectedArticleKey)
      if (hasCurrent) {
        return
      }
      const first = flatArticleItems[0]
      setSelectedArticleKey(`${first.article_id}:${first.generated_at}`)
      setArticleSelectionInitialized(true)
      return
    }
    if (!articleSelectionInitialized) {
      const first = flatArticleItems[0]
      setSelectedArticleKey(`${first.article_id}:${first.generated_at}`)
      setArticleSelectionInitialized(true)
    }
  }, [articleSelectionInitialized, flatArticleItems, selectedArticleKey])

  useEffect(() => {
    if (flatBriefingItems.length === 0) {
      setSelectedBriefingKey(null)
      setBriefingSelectionInitialized(false)
      return
    }
    if (selectedBriefingKey) {
      const hasCurrent = flatBriefingItems.some((item) => `${item.digest_key}:${item.generated_at}` === selectedBriefingKey)
      if (hasCurrent) {
        return
      }
      const first = flatBriefingItems[0]
      setSelectedBriefingKey(`${first.digest_key}:${first.generated_at}`)
      setBriefingSelectionInitialized(true)
      return
    }
    if (!briefingSelectionInitialized) {
      const first = flatBriefingItems[0]
      setSelectedBriefingKey(`${first.digest_key}:${first.generated_at}`)
      setBriefingSelectionInitialized(true)
    }
  }, [briefingSelectionInitialized, flatBriefingItems, selectedBriefingKey])

  const sourceNameByID = useMemo(() => new Map(sources.map((source) => [source.id, source.name])), [sources])
  const toggleArticleSelection = (key: string) => {
    setArticleSelectionInitialized(true)
    setSelectedArticleKey((current) => {
      return current === key ? null : key
    })
  }
  const toggleBriefingSelection = (key: string) => {
    setBriefingSelectionInitialized(true)
    setSelectedBriefingKey((current) => {
      const next = current === key ? null : key
      if (next) {
        setPendingScrollKey(key)
      }
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
      if (event.key === 'p') {
        event.preventDefault()
        if (activeView === 'articles' && selectedArticleKey) {
          onTogglePinnedKey(`article:${selectedArticleKey}`)
          return
        }
        if (activeView === 'briefings' && selectedBriefingKey) {
          onTogglePinnedKey(`briefing:${selectedBriefingKey}`)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeView, onTogglePinnedKey, selectedArticleKey, selectedBriefingKey, selectedArticleIndex, selectedBriefingIndex, flatArticleItems, flatBriefingItems])

  useEffect(() => {
    if (!pendingScrollKey) {
      return
    }
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
              <p className="hint">回看已经生成过的聚合速览和文章摘要，按阅读流的方式继续浏览。</p>
            </div>
            <div className="ai-library-head-meta">
              <span className="topbar-model-chip" title={aiModel}>
                <span className="topbar-model-label">当前模型</span>
                <span className="topbar-model-value">{aiModel || '-'}</span>
              </span>
            </div>
          </div>

          <div className="ai-library-toolbar">
            <Input
              value={search}
              onChange={(event) => onChangeSearch(event.target.value)}
              placeholder="搜索标题、来源、摘要内容"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onApplySearch()
                }
              }}
            />
            <Button type="button" onClick={onApplySearch} disabled={loading}>
              <Search aria-hidden="true" />
              搜索
            </Button>
            <Button type="button" variant="outline" onClick={onRefresh} disabled={loading}>
              <RefreshCw aria-hidden="true" />
              {loading ? '更新中...' : '刷新'}
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

            <div className="ai-library-filter-row">
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
              <label className="ai-library-select-label">
                <span>固定</span>
                <select className="ai-library-select" value={pinnedFilter} onChange={(event) => onChangePinnedFilter(event.target.value as AILibraryPinnedFilter)}>
                  <option value="all">全部</option>
                  <option value="pinned">只看固定</option>
                </select>
              </label>
            </div>
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
            {timeRange !== 'all' ? ` · 已按 ${timeRange} 过滤` : ''}
            {sourceFilter !== 'all' ? ` · ${sourceLabel} ${sourceFilter}` : ''}
            {statusFilter !== 'all' ? ` · ${statusFilter === 'truncated' ? '只看输出触顶/截断' : '只看正常结束'}` : ''}
            {pinnedFilter === 'pinned' ? ' · 只看固定' : ''}
            {search.trim() ? ` · 关键词 “${search.trim()}”` : ''}
            {pinnedKeys.length > 0 ? ` · 已固定 ${pinnedKeys.length} 条` : ''}
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
                              <span>{item.model}</span>
                            </p>
                          </div>
                          <div className="ai-library-entry-actions">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => onTogglePinnedKey(`article:${articleKey}`)}
                            >
                              {pinnedKeySet.has(`article:${articleKey}`) ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                              {pinnedKeySet.has(`article:${articleKey}`) ? '取消固定' : '固定'}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleArticleSelection(articleKey)}
                            >
                              {isArticleSelected(item) ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                              {isArticleSelected(item) ? '收起' : '展开'}
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={() => void onOpenArticleSummary(item.article_id)}>
                              <ExternalLink aria-hidden="true" />
                              打开文章
                            </Button>
                          </div>
                        </div>
                        {isArticleSelected(item) ? (
                          <div className="ai-library-entry-expanded">
                            <div className="ai-library-entry-nav">
                              <Button type="button" variant="ghost" size="sm" onClick={() => selectAdjacentArticle(-1)} disabled={selectedArticleIndex <= 0}>
                                <ArrowLeft aria-hidden="true" />
                                上一条
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => selectAdjacentArticle(1)}
                                disabled={selectedArticleIndex < 0 || selectedArticleIndex >= flatArticleItems.length - 1}
                              >
                                <ArrowRight aria-hidden="true" />
                                下一条
                              </Button>
                            </div>
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
                    return (
                      <article
                        ref={attachEntryRef(briefingKey)}
                        key={`feed-briefing-${item.digest_key}`}
                        className={`ai-library-entry ai-library-entry-briefing ${isBriefingSelected(item) ? 'active' : ''}`}
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
                                <span>{item.model}</span>
                                <span>{item.article_count} 条信息</span>
                              </p>
                            </div>
                            <div className="ai-library-entry-actions">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => onTogglePinnedKey(`briefing:${item.digest_key}:${item.generated_at}`)}
                              >
                                {pinnedKeySet.has(`briefing:${item.digest_key}:${item.generated_at}`) ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                                {pinnedKeySet.has(`briefing:${item.digest_key}:${item.generated_at}`) ? '取消固定' : '固定'}
                              </Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => toggleBriefingSelection(briefingKey)}>
                                {isBriefingSelected(item) ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                                {isBriefingSelected(item) ? '收起' : '展开'}
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => onOpenFeedBriefing(item)}>
                                <ExternalLink aria-hidden="true" />
                                打开速览
                              </Button>
                            </div>
                          </div>
                          {isBriefingSelected(item) ? (
                            <div className="ai-library-entry-expanded">
                              <div className="ai-library-entry-nav">
                                <Button type="button" variant="ghost" size="sm" onClick={() => selectAdjacentBriefing(-1)} disabled={selectedBriefingIndex <= 0}>
                                  <ArrowLeft aria-hidden="true" />
                                  上一条
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => selectAdjacentBriefing(1)}
                                  disabled={selectedBriefingIndex < 0 || selectedBriefingIndex >= flatBriefingItems.length - 1}
                                >
                                  <ArrowRight aria-hidden="true" />
                                  下一条
                                </Button>
                              </div>
                              <div className="ai-library-detail-body">
                                <MarkdownBlock content={item.summary} />
                              </div>
                              <div className="ai-library-detail-context">
                                <div className="ai-library-detail-stats">
                                  <div className="ai-library-detail-stat">
                                    <span className="ai-library-detail-stat-label">关联来源</span>
                                    <strong>{parseIDList(item.source_ids).length}</strong>
                                  </div>
                                  <div className="ai-library-detail-stat">
                                    <span className="ai-library-detail-stat-label">关联文章</span>
                                    <strong>{item.article_count || parseIDList(item.article_ids).length}</strong>
                                  </div>
                                </div>
                                {parseIDList(item.source_ids).length > 0 && (
                                  <div className="ai-library-detail-source-list">
                                    <p className="hint">来源明细</p>
                                    <div className="ai-library-detail-source-pills">
                                      {parseIDList(item.source_ids).map((sourceID) => (
                                        <span key={sourceID} className="ai-library-detail-source-pill">
                                          {sourceNameByID.get(sourceID) ?? `来源 ${sourceID}`}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {item.article_refs.length > 0 && (
                                  <div className="ai-library-detail-article-list">
                                    <p className="hint">关联文章</p>
                                    <div className="ai-library-detail-article-items">
                                      {visibleArticleRefs.map((article) => {
                                        const relatedSummary = articleSummaries.find((summary) => summary.article_id === article.id)
                                        const isSummarized = Boolean(relatedSummary)
                                        return (
                                          <div key={`${item.digest_key}-${article.id}`} className="ai-library-detail-article-item">
                                            <button
                                              type="button"
                                              className="ai-library-detail-article-link"
                                              onClick={() => {
                                                if (isSummarized && relatedSummary) {
                                                  onChangeSourceFilter('all')
                                                  onChangeStatusFilter('all')
                                                  onChangePinnedFilter('all')
                                                  onChangeTimeRange('all')
                                                  onChangeView('articles')
                                                  toggleArticleSelection(`${relatedSummary.article_id}:${relatedSummary.generated_at}`)
                                                  return
                                                }
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
                                          </div>
                                        )
                                      })}
                                    </div>
                                    {item.article_refs.length > 5 && (
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
                                        {articleRefsExpanded ? '收起关联文章' : `展开全部 ${item.article_refs.length} 条关联文章`}
                                      </button>
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
    </main>
  )
}
