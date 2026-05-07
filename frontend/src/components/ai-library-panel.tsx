import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MarkdownBlock } from '@/components/rich-content-blocks'
import type { ArticleSummaryLibraryItem, FeedBriefingLibraryItem, Source } from '../types'

type AILibraryView = 'articles' | 'briefings'
type AILibraryRange = '24h' | '7d' | '30d' | 'all'

type AILibraryPanelProps = {
  aiModel: string
  search: string
  loading: boolean
  error: string | null
  activeView: AILibraryView
  timeRange: AILibraryRange
  sourceFilter: string
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

export function AILibraryPanel(props: AILibraryPanelProps) {
  const {
    aiModel,
    search,
    loading,
    error,
    activeView,
    timeRange,
    sourceFilter,
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
    onOpenArticleSummary,
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
    return true
  })
  const articleSections = groupByRecency(filteredArticles)
  const briefingSections = groupByRecency(filteredBriefings)
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
      const next = current === key ? null : key
      if (next) {
        setPendingScrollKey(key)
      }
      return next
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
              <p className="ai-library-kicker">AI Archive</p>
              <h2>AI 内容库</h2>
              <p className="hint">回看你已经生成过的文章摘要和聚合速览。这里更像阅读档案馆，不是任务日志。</p>
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
              搜索
            </Button>
            <Button type="button" variant="outline" onClick={onRefresh} disabled={loading}>
              {loading ? '更新中...' : '刷新'}
            </Button>
          </div>

          <div className="ai-library-controls">
            <div className="ai-library-segmented" role="tablist" aria-label="AI 内容分类">
              <button
                type="button"
                className={`ai-library-segment ${activeView === 'articles' ? 'active' : ''}`}
                onClick={() => onChangeView('articles')}
              >
                文章摘要
                <span>{filteredArticles.length}</span>
              </button>
              <button
                type="button"
                className={`ai-library-segment ${activeView === 'briefings' ? 'active' : ''}`}
                onClick={() => onChangeView('briefings')}
              >
                AI 速览
                <span>{filteredBriefings.length}</span>
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
                  {section.items.map((item) => (
                    <article
                      ref={attachEntryRef(`${item.article_id}:${item.generated_at}`)}
                      key={`article-summary-${item.article_id}-${item.generated_at}`}
                      className={`ai-library-entry ${isArticleSelected(item) ? 'active' : ''}`}
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
                              onClick={() => toggleArticleSelection(`${item.article_id}:${item.generated_at}`)}
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
                              onClick={() => toggleArticleSelection(`${item.article_id}:${item.generated_at}`)}
                            >
                              {isArticleSelected(item) ? '收起' : '展开'}
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={() => void onOpenArticleSummary(item.article_id)}>
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
                        <p className="ai-library-entry-foot hint">
                          {item.provider} · 输入 {item.input_chars} 字符
                          {item.truncated ? ' · 已截断' : ''}
                        </p>
                      </div>
                    </article>
                  ))}
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
                  {section.items.map((item) => (
                    <article
                      ref={attachEntryRef(`${item.digest_key}:${item.generated_at}`)}
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
                              onClick={() => toggleBriefingSelection(`${item.digest_key}:${item.generated_at}`)}
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
                              onClick={() => toggleBriefingSelection(`${item.digest_key}:${item.generated_at}`)}
                            >
                              {isBriefingSelected(item) ? '收起' : '展开'}
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={() => onOpenFeedBriefing(item)}>
                              打开速览
                            </Button>
                          </div>
                        </div>
                        {isBriefingSelected(item) ? (
                          <div className="ai-library-entry-expanded">
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
                            </div>
                          </div>
                        ) : (
                          <div className="ai-library-inset ai-library-inset-briefing">
                            <p className="ai-library-entry-preview">{previewText(item.summary, 240)}</p>
                          </div>
                        )}
                        <p className="ai-library-entry-foot hint">
                          {item.provider}
                          {item.tag ? ` · 标签 ${item.tag}` : ''}
                          {item.keyword ? ` · 关键词 ${item.keyword}` : ''}
                          {item.truncated ? ' · 已截断' : ''}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
