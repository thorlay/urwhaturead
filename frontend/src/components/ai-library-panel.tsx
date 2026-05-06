import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ArticleSummaryLibraryItem, FeedBriefingLibraryItem } from '../types'

type AILibraryView = 'articles' | 'briefings'
type AILibraryRange = '24h' | '7d' | '30d' | 'all'

type AILibraryPanelProps = {
  aiModel: string
  search: string
  loading: boolean
  error: string | null
  activeView: AILibraryView
  timeRange: AILibraryRange
  articleSummaries: ArticleSummaryLibraryItem[]
  feedBriefings: FeedBriefingLibraryItem[]
  formatTimeAgo: (input: string) => string
  onChangeSearch: (value: string) => void
  onApplySearch: () => void
  onRefresh: () => void
  onChangeView: (view: AILibraryView) => void
  onChangeTimeRange: (range: AILibraryRange) => void
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

export function AILibraryPanel(props: AILibraryPanelProps) {
  const {
    aiModel,
    search,
    loading,
    error,
    activeView,
    timeRange,
    articleSummaries,
    feedBriefings,
    formatTimeAgo,
    onChangeSearch,
    onApplySearch,
    onRefresh,
    onChangeView,
    onChangeTimeRange,
    onOpenArticleSummary,
    onOpenFeedBriefing,
  } = props

  const filteredArticles = articleSummaries.filter((item) => withinRange(item.generated_at, timeRange))
  const filteredBriefings = feedBriefings.filter((item) => withinRange(item.generated_at, timeRange))
  const articleSections = groupByRecency(filteredArticles)
  const briefingSections = groupByRecency(filteredBriefings)
  const activeCount = activeView === 'articles' ? filteredArticles.length : filteredBriefings.length

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
                <div className="ai-library-list">
                  {section.items.map((item) => (
                    <article key={`article-summary-${item.article_id}-${item.generated_at}`} className="ai-library-card">
                      <div className="ai-library-card-head">
                        <div className="ai-library-card-main">
                          <p className="ai-library-card-title">{item.title}</p>
                          <p className="ai-library-card-meta">
                            <span>{item.source_name}</span>
                            <span>{formatTimeAgo(item.generated_at)}</span>
                            <span>{item.model}</span>
                          </p>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={() => void onOpenArticleSummary(item.article_id)}>
                          打开文章
                        </Button>
                      </div>
                      <p className="ai-library-card-preview">{previewText(item.summary, 220)}</p>
                      <p className="ai-library-card-foot hint">
                        {item.provider} · 输入 {item.input_chars} 字符
                        {item.truncated ? ' · 已截断' : ''}
                      </p>
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
                <div className="ai-library-list">
                  {section.items.map((item) => (
                    <article key={`feed-briefing-${item.digest_key}`} className="ai-library-card ai-library-card-briefing">
                      <div className="ai-library-card-head">
                        <div className="ai-library-card-main">
                          <p className="ai-library-card-title">{item.scope_label || '当前阅读流'}</p>
                          <p className="ai-library-card-meta">
                            <span>{formatTimeAgo(item.generated_at)}</span>
                            <span>{item.model}</span>
                            <span>{item.article_count} 条信息</span>
                          </p>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={() => onOpenFeedBriefing(item)}>
                          打开速览
                        </Button>
                      </div>
                      <p className="ai-library-card-preview">{previewText(item.summary, 240)}</p>
                      <p className="ai-library-card-foot hint">
                        {item.provider}
                        {item.tag ? ` · 标签 ${item.tag}` : ''}
                        {item.keyword ? ` · 关键词 ${item.keyword}` : ''}
                        {item.truncated ? ' · 已截断' : ''}
                      </p>
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
