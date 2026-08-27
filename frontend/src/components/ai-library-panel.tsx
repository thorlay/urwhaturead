import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, FileText, RefreshCw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MarkdownBlock } from '@/components/rich-content-blocks'
import { AIArticleReader } from '@/components/ai-library/ai-article-reader'
import { BriefingDocument } from '@/components/ai-library/briefing-document'
import { extractBriefingLead, previewText } from '@/components/ai-library/briefing-utils'
import { formatAIStopReason } from '../lib/app-utils'
import type { ArticleDetail, ArticleSummaryLibraryItem, FeedBriefingLibraryItem, Source } from '../types'

type AILibraryView = 'articles' | 'briefings'
type AILibraryRange = '24h' | '7d' | '30d' | 'all'
type AILibraryStatusFilter = 'all' | 'complete' | 'truncated'

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
  favoriteArticleIDSet: Set<number>
  sources: Source[]
  formatTimeAgo: (input: string) => string
  onChangeSearch: (value: string) => void
  onApplySearch: (keywordOverride?: string) => void
  onRefresh: () => void
  onChangeView: (view: AILibraryView) => void
  onChangeTimeRange: (range: AILibraryRange) => void
  onChangeSourceFilter: (value: string) => void
  onChangeStatusFilter: (value: AILibraryStatusFilter) => void
  onOpenArticleSummary: (articleID: number) => Promise<void>
  onCloseArticleReader: () => void
  onToggleFavoriteArticle: (articleID: number) => void
  onOpenFeedBriefing: (item: FeedBriefingLibraryItem) => void
}

type DateSection = { key: string; label: string; shortLabel: string; count: number }
type BriefingAnchor = { id: string; key: string; item: FeedBriefingLibraryItem }

const READ_BRIEFINGS_STORAGE_KEY = 'quick.ai-library.read-briefings.v1'

function withinRange(input: string, range: AILibraryRange): boolean {
  if (range === 'all') return true
  const created = new Date(input).getTime()
  if (!Number.isFinite(created)) return true
  const age = Date.now() - created
  const hour = 60 * 60 * 1000
  if (range === '24h') return age <= 24 * hour
  if (range === '7d') return age <= 7 * 24 * hour
  return age <= 30 * 24 * hour
}

function generatedDateKey(input: string): string {
  const date = new Date(input)
  if (!Number.isFinite(date.getTime())) return 'unknown'
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function formatDateLabel(dateKey: string): string {
  if (dateKey === 'unknown') return '日期未知'
  const date = new Date(`${dateKey}T00:00:00`)
  const diffDays = Math.round((startOfLocalDay(new Date()).getTime() - date.getTime()) / 86_400_000)
  const dateText = new Intl.DateTimeFormat('zh-Hans-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(date)
  if (diffDays === 0) return `今天 · ${dateText}`
  if (diffDays === 1) return `昨天 · ${dateText}`
  if (diffDays === 2) return `前天 · ${dateText}`
  return dateText
}

function formatShortDateLabel(dateKey: string): string {
  if (dateKey === 'unknown') return '未知'
  const date = new Date(`${dateKey}T00:00:00`)
  const diffDays = Math.round((startOfLocalDay(new Date()).getTime() - date.getTime()) / 86_400_000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  return new Intl.DateTimeFormat('zh-Hans-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

function buildDateSections(items: Array<{ generated_at: string }>): DateSection[] {
  const counts = new Map<string, number>()
  items.forEach((item) => {
    const key = generatedDateKey(item.generated_at)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return Array.from(counts.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, count]) => ({ key, count, label: formatDateLabel(key), shortLabel: formatShortDateLabel(key) }))
}

function loadReadBriefings(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const values = JSON.parse(window.localStorage.getItem(READ_BRIEFINGS_STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return new Set()
  }
}

function briefingKey(item: FeedBriefingLibraryItem): string {
  return `${item.digest_key}:${item.generated_at}`
}

function articleKey(item: ArticleSummaryLibraryItem): string {
  return `${item.article_id}:${item.generated_at}`
}

function DateRail(props: {
  sections: DateSection[]
  activeDate: string
  readCounts: Map<string, number>
  onSelectDate: (date: string) => void
}) {
  if (props.sections.length === 0) return null
  return (
    <aside className="ai-date-rail" aria-label="简报日期">
      <div className="ai-date-rail-label">历史</div>
      <nav>
        {props.sections.map((section) => {
          const readCount = props.readCounts.get(section.key) ?? 0
          return (
            <Button key={section.key} type="button" variant="ghost" className={section.key === props.activeDate ? 'active' : ''} onClick={() => props.onSelectDate(section.key)} aria-current={section.key === props.activeDate ? 'date' : undefined}>
              <span>{section.shortLabel}</span>
              <small>{readCount > 0 ? `${readCount}/${section.count}` : section.count}</small>
            </Button>
          )
        })}
      </nav>
    </aside>
  )
}

function BriefingRail(props: {
  anchors: BriefingAnchor[]
  activeID: string
  readBriefings: Set<string>
  className: string
  onSelect: (id: string) => void
}) {
  if (props.anchors.length < 2) return null
  return (
    <aside className={`ai-briefing-rail ${props.className}`} aria-label="今日简报导航">
      <div className="ai-briefing-rail-label">今日来源</div>
      <nav>
        {props.anchors.map(({ id, key, item }) => (
          <Button
            key={id}
            type="button"
            variant="ghost"
            className={`${id === props.activeID ? 'active' : ''} ${props.readBriefings.has(key) ? 'is-read' : ''}`}
            aria-current={id === props.activeID ? 'location' : undefined}
            onClick={() => props.onSelect(id)}
          >
            <span>{item.scope_label || '当前阅读流'}</span>
            <small>{item.article_count || item.article_refs.length} 篇</small>
          </Button>
        ))}
      </nav>
    </aside>
  )
}

function ArticleSummaryDocument(props: {
  item: ArticleSummaryLibraryItem
  expanded: boolean
  formatTimeAgo: (input: string) => string
  onToggle: () => void
  onOpenArticle: () => void
}) {
  const stopReason = formatAIStopReason(props.item.stop_reason, props.item.truncated)
  return (
    <article className={`ai-summary-document ${props.expanded ? 'is-expanded' : ''}`}>
      <header className="ai-summary-document-head">
        <Button type="button" variant="ghost" className="ai-summary-title" onClick={props.onToggle} aria-expanded={props.expanded}>
          <strong>{props.item.title}</strong>
          <span>{props.item.source_name} · {props.formatTimeAgo(props.item.generated_at)}{props.item.truncated ? ' · 输出不完整' : ''}</span>
        </Button>
        <Button type="button" variant="ghost" size="sm" className="ai-summary-open" onClick={props.onOpenArticle}>
          阅读文章<ChevronRight aria-hidden="true" />
        </Button>
      </header>
      {props.expanded ? (
        <div className="ai-summary-prose"><MarkdownBlock content={props.item.summary} /></div>
      ) : (
        <Button type="button" variant="ghost" className="ai-summary-preview" onClick={props.onToggle}>{previewText(props.item.summary, 240)}</Button>
      )}
      {stopReason && stopReason !== '正常结束' && stopReason !== '已完成' && <p className="ai-summary-status">{stopReason}</p>}
    </article>
  )
}

export function AILibraryPanel(props: AILibraryPanelProps) {
  const {
    search, loading, error, activeView, timeRange, sourceFilter, statusFilter, articleSummaries, feedBriefings,
    readerArticle, readerArticleLoading, readerArticleError, favoriteArticleIDSet, formatTimeAgo,
    onChangeSearch, onApplySearch, onRefresh, onChangeView, onChangeTimeRange, onChangeSourceFilter,
    onChangeStatusFilter, onOpenArticleSummary, onCloseArticleReader, onToggleFavoriteArticle, onOpenFeedBriefing,
  } = props

  const [showFilters, setShowFilters] = useState(false)
  const [activeDate, setActiveDate] = useState('')
  const [collapsedBriefings, setCollapsedBriefings] = useState<Record<string, boolean>>({})
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null)
  const [readBriefings, setReadBriefings] = useState(loadReadBriefings)
  const [activeBriefingID, setActiveBriefingID] = useState('')
  const articleRefs = useRef<Record<string, HTMLElement | null>>({})

  const articleSourceOptions = useMemo(() => Array.from(new Set(articleSummaries.map((item) => item.source_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')), [articleSummaries])
  const briefingScopeOptions = useMemo(() => Array.from(new Set(feedBriefings.map((item) => item.scope_label || '当前阅读流').filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')), [feedBriefings])

  const filteredArticles = useMemo(() => articleSummaries.filter((item) => {
    if (!withinRange(item.generated_at, timeRange)) return false
    if (sourceFilter !== 'all' && item.source_name !== sourceFilter) return false
    if (statusFilter === 'complete' && item.truncated) return false
    if (statusFilter === 'truncated' && !item.truncated) return false
    return true
  }), [articleSummaries, sourceFilter, statusFilter, timeRange])

  const filteredBriefings = useMemo(() => feedBriefings.filter((item) => {
    if (!withinRange(item.generated_at, timeRange)) return false
    if (sourceFilter !== 'all' && (item.scope_label || '当前阅读流') !== sourceFilter) return false
    if (statusFilter === 'complete' && item.truncated) return false
    if (statusFilter === 'truncated' && !item.truncated) return false
    return true
  }), [feedBriefings, sourceFilter, statusFilter, timeRange])

  const activeItems = activeView === 'briefings' ? filteredBriefings : filteredArticles
  const dateSections = useMemo(() => buildDateSections(activeItems), [activeItems])
  const selectedDate = dateSections.some((section) => section.key === activeDate) ? activeDate : dateSections[0]?.key || ''
  const selectedBriefings = filteredBriefings.filter((item) => generatedDateKey(item.generated_at) === selectedDate)
  const selectedArticles = filteredArticles.filter((item) => generatedDateKey(item.generated_at) === selectedDate)
  const selectedCount = activeView === 'briefings' ? selectedBriefings.length : selectedArticles.length
  const sourceOptions = activeView === 'briefings' ? briefingScopeOptions : articleSourceOptions
  const filterCount = (search.trim() ? 1 : 0) + (sourceFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (timeRange !== '30d' ? 1 : 0)
  const activeDateIndex = dateSections.findIndex((section) => section.key === selectedDate)

  const readCounts = useMemo(() => {
    const counts = new Map<string, number>()
    filteredBriefings.forEach((item) => {
      if (!readBriefings.has(briefingKey(item))) return
      const date = generatedDateKey(item.generated_at)
      counts.set(date, (counts.get(date) ?? 0) + 1)
    })
    return counts
  }, [filteredBriefings, readBriefings])

  const selectedReadCount = selectedBriefings.filter((item) => readBriefings.has(briefingKey(item))).length
  const selectedArticleCount = new Set(selectedBriefings.flatMap((item) => item.article_refs.map((article) => article.id))).size
  const selectedSourceCount = new Set(selectedBriefings.map((item) => item.scope_label || '当前阅读流')).size
  const lead = selectedBriefings[0] ? extractBriefingLead(selectedBriefings[0].summary) : ''
  const briefingAnchors = selectedBriefings.map((item, index) => ({
    id: `ai-briefing-${selectedDate || 'unknown'}-${index + 1}`,
    key: briefingKey(item),
    item,
  }))
  const briefingAnchorIDs = briefingAnchors.map((anchor) => anchor.id).join('|')
  const resolvedActiveBriefingID = briefingAnchors.some((anchor) => anchor.id === activeBriefingID)
    ? activeBriefingID
    : briefingAnchors[0]?.id ?? ''

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(READ_BRIEFINGS_STORAGE_KEY, JSON.stringify(Array.from(readBriefings)))
  }, [readBriefings])

  useEffect(() => {
    const anchorIDs = briefingAnchorIDs ? briefingAnchorIDs.split('|') : []
    if (activeView !== 'briefings' || anchorIDs.length === 0) return
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]) setActiveBriefingID(visible[0].target.id)
    }, { rootMargin: '-18% 0px -62% 0px', threshold: [0, 0.01] })
    anchorIDs.forEach((id) => {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    })
    return () => observer.disconnect()
  }, [activeView, briefingAnchorIDs])

  const switchView = (view: AILibraryView) => {
    onChangeView(view)
    onChangeSourceFilter('all')
    setActiveDate('')
  }

  const clearFilters = () => {
    onChangeSearch('')
    onChangeSourceFilter('all')
    onChangeStatusFilter('all')
    onChangeTimeRange('30d')
    onApplySearch('')
  }

  const toggleRead = (key: string) => setReadBriefings((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const toggleArticle = (key: string) => setExpandedArticle((current) => {
    const next = current === key ? null : key
    if (next) requestAnimationFrame(() => articleRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    return next
  })

  const scrollToBriefing = (id: string) => {
    setActiveBriefingID(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <main className="ai-library-page">
      <section className="ai-library-panel">
        <header className="ai-library-masthead">
          <div>
            <p className="ai-library-eyebrow">个人简报</p>
            <h2>{activeView === 'briefings' ? '每日 AI 简报' : '文章摘要归档'}</h2>
            <p>{activeView === 'briefings' ? '按日期回看 AI 对阅读流做出的判断。' : '查找曾经生成过摘要的文章。'}</p>
          </div>
          <div className="ai-library-masthead-actions">
            <Tabs value={activeView} onValueChange={(value) => switchView(value as AILibraryView)} className="ai-library-view-switch">
              <TabsList>
                <TabsTrigger value="briefings"><BookOpen aria-hidden="true" />简报</TabsTrigger>
                <TabsTrigger value="articles"><FileText aria-hidden="true" />摘要</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button type="button" variant="outline" size="sm" className={`ai-toolbar-button ${showFilters || filterCount > 0 ? 'active' : ''}`} onClick={() => setShowFilters((current) => !current)}>
              <Search aria-hidden="true" />搜索{filterCount > 0 && <span>{filterCount}</span>}
            </Button>
            <Button type="button" variant="outline" size="icon" className="ai-icon-button" onClick={onRefresh} disabled={loading} aria-label="刷新 AI 内容"><RefreshCw aria-hidden="true" className={loading ? 'is-spinning' : ''} /></Button>
          </div>
        </header>

        {showFilters && (
          <form className="ai-library-filter-drawer" onSubmit={(event) => { event.preventDefault(); onApplySearch() }}>
            <label className="ai-search-field">
              <Search aria-hidden="true" />
              <Input value={search} onChange={(event) => onChangeSearch(event.target.value)} placeholder="搜索主题、来源或摘要内容" autoFocus />
              {search && <Button type="button" variant="ghost" size="icon" onClick={() => onChangeSearch('')} aria-label="清除搜索"><X aria-hidden="true" /></Button>}
            </label>
            <Select value={sourceFilter} onChange={(event) => onChangeSourceFilter(event.target.value)} aria-label={activeView === 'briefings' ? '简报范围' : '文章来源'}>
              <option value="all">全部{activeView === 'briefings' ? '范围' : '来源'}</option>
              {sourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
            <Select value={statusFilter} onChange={(event) => onChangeStatusFilter(event.target.value as AILibraryStatusFilter)} aria-label="生成状态">
              <option value="all">全部状态</option><option value="complete">完整输出</option><option value="truncated">输出不完整</option>
            </Select>
            <Tabs value={timeRange} onValueChange={(value) => onChangeTimeRange(value as AILibraryRange)} className="ai-range-switch" aria-label="时间范围">
              <TabsList>
              {([['24h', '24h'], ['7d', '7天'], ['30d', '30天'], ['all', '全部']] as const).map(([value, label]) => (
                <TabsTrigger key={value} value={value}>{label}</TabsTrigger>
              ))}
              </TabsList>
            </Tabs>
            <Button type="submit" size="sm" className="ai-filter-apply">应用</Button>
            {filterCount > 0 && <Button type="button" variant="ghost" size="sm" className="ai-filter-clear" onClick={clearFilters}>清除</Button>}
          </form>
        )}

        {error && <div className="inline-error ai-library-error">{error}</div>}

        <div className="ai-library-workspace">
          <DateRail sections={dateSections} activeDate={selectedDate} readCounts={readCounts} onSelectDate={setActiveDate} />
          <div className="ai-library-reading-column">
            {selectedDate && (
              <header className="ai-daily-header">
                <div className="ai-daily-date-row">
                  <div><p><CalendarDays aria-hidden="true" />{formatDateLabel(selectedDate)}</p><h3>{activeView === 'briefings' ? '今日简报' : '摘要归档'}</h3></div>
                  <div className="ai-date-navigation">
                    <Button type="button" variant="ghost" size="icon" disabled={activeDateIndex < 0 || activeDateIndex >= dateSections.length - 1} onClick={() => setActiveDate(dateSections[activeDateIndex + 1]?.key ?? selectedDate)} aria-label="前一天"><ChevronLeft aria-hidden="true" /></Button>
                    <Select value={selectedDate} onChange={(event) => setActiveDate(event.target.value)} aria-label="选择日期">{dateSections.map((section) => <option key={section.key} value={section.key}>{section.label}</option>)}</Select>
                    <Button type="button" variant="ghost" size="icon" disabled={activeDateIndex <= 0} onClick={() => setActiveDate(dateSections[activeDateIndex - 1]?.key ?? selectedDate)} aria-label="后一天"><ChevronRight aria-hidden="true" /></Button>
                  </div>
                </div>
                {activeView === 'briefings' ? (
                  <div className="ai-daily-overview">
                    <p className="ai-daily-stats">{selectedBriefings.length} 份简报 · {selectedArticleCount} 篇文章 · {selectedSourceCount} 个阅读视角 · 已读 {selectedReadCount}/{selectedBriefings.length}</p>
                    {lead && <p className="ai-daily-lead">{lead}</p>}
                  </div>
                ) : <p className="ai-daily-stats">{selectedArticles.length} 篇摘要</p>}
              </header>
            )}

            {activeView === 'briefings' && (
              <BriefingRail anchors={briefingAnchors} activeID={resolvedActiveBriefingID} readBriefings={readBriefings} className="ai-briefing-rail-mobile" onSelect={scrollToBriefing} />
            )}

            {loading && activeItems.length === 0 && <div className="ai-library-loading" aria-label="正在加载 AI 内容"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" /></div>}

            {!loading && selectedCount === 0 && (
              <div className="ai-library-empty">
                <h3>{filterCount > 0 ? '没有符合条件的内容' : activeView === 'briefings' ? '还没有每日简报' : '还没有文章摘要'}</h3>
                <p>{filterCount > 0 ? '调整搜索条件或时间范围后再试。' : activeView === 'briefings' ? '在阅读流中生成或为来源开启定时 AI 速览后，这里会按日期保存结果。' : '在文章详情中生成摘要后，这里会自动收录。'}</p>
                {filterCount > 0 && <Button type="button" variant="link" onClick={clearFilters}>清除筛选</Button>}
              </div>
            )}

            {activeView === 'briefings' && selectedBriefings.length > 0 && (
              <div className="ai-briefing-stream">
                {briefingAnchors.map(({ id, key, item }) => {
                  return <div key={key} id={id} className="ai-briefing-anchor"><BriefingDocument item={item} articleSummaries={articleSummaries} collapsed={collapsedBriefings[key] ?? false} read={readBriefings.has(key)} formatTimeAgo={formatTimeAgo} onToggleCollapsed={() => setCollapsedBriefings((current) => ({ ...current, [key]: !(current[key] ?? false) }))} onToggleRead={() => toggleRead(key)} onOpenArticle={(articleID) => void onOpenArticleSummary(articleID)} onOpenReadingContext={() => onOpenFeedBriefing(item)} /></div>
                })}
              </div>
            )}

            {activeView === 'articles' && selectedArticles.length > 0 && (
              <div className="ai-summary-stream">
                {selectedArticles.map((item) => {
                  const key = articleKey(item)
                  return <div key={key} ref={(node) => { articleRefs.current[key] = node }}><ArticleSummaryDocument item={item} expanded={expandedArticle === key} formatTimeAgo={formatTimeAgo} onToggle={() => toggleArticle(key)} onOpenArticle={() => void onOpenArticleSummary(item.article_id)} /></div>
                })}
              </div>
            )}
          </div>
          {activeView === 'briefings' && (
            <BriefingRail anchors={briefingAnchors} activeID={resolvedActiveBriefingID} readBriefings={readBriefings} className="ai-briefing-rail-desktop" onSelect={scrollToBriefing} />
          )}
        </div>
      </section>

      <AIArticleReader article={readerArticle} loading={readerArticleLoading} error={readerArticleError} formatTimeAgo={formatTimeAgo} onClose={onCloseArticleReader} isFavorite={Boolean(readerArticle && favoriteArticleIDSet.has(readerArticle.id))} onToggleFavorite={onToggleFavoriteArticle} />
    </main>
  )
}
