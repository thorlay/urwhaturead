import { MarkdownBlock } from '@/components/rich-content-blocks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ArticleSummaryLibraryItem, FeedBriefingLibraryItem } from '../types'

type AILibraryPanelProps = {
  aiModel: string
  search: string
  loading: boolean
  error: string | null
  articleSummaries: ArticleSummaryLibraryItem[]
  feedBriefings: FeedBriefingLibraryItem[]
  formatTimeAgo: (input: string) => string
  onChangeSearch: (value: string) => void
  onApplySearch: () => void
  onRefresh: () => void
  onOpenArticleSummary: (articleID: number) => Promise<void>
}

export function AILibraryPanel(props: AILibraryPanelProps) {
  const {
    aiModel,
    search,
    loading,
    error,
    articleSummaries,
    feedBriefings,
    formatTimeAgo,
    onChangeSearch,
    onApplySearch,
    onRefresh,
    onOpenArticleSummary,
  } = props

  return (
    <main className="ai-library-page">
      <section className="panel ai-library-panel">
        <div className="ai-library-head">
          <div>
            <h2>AI 内容库</h2>
            <p className="hint">集中回看已经生成过的文章摘要和 AI 速览，默认只展示成功结果。</p>
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

        {error && <div className="inline-error"><span>AI 内容加载失败: {error}</span></div>}

        <div className="ai-library-grid">
          <section className="ai-library-section">
            <div className="ai-library-section-head">
              <h3>文章摘要</h3>
              <span className="hint">{articleSummaries.length} 条</span>
            </div>
            <div className="ai-library-list">
              {articleSummaries.length === 0 && !loading && <p className="hint">暂无文章摘要。</p>}
              {articleSummaries.map((item) => (
                <details key={`article-summary-${item.article_id}-${item.generated_at}`} className="ai-library-item">
                  <summary className="ai-library-item-head">
                    <div className="ai-library-item-main">
                      <p className="ai-library-item-title">{item.title}</p>
                      <p className="ai-library-item-meta">
                        {item.source_name} · {formatTimeAgo(item.generated_at)} · {item.model}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void onOpenArticleSummary(item.article_id)
                      }}
                    >
                      打开文章
                    </Button>
                  </summary>
                  <div className="ai-library-item-body">
                    <p className="hint">
                      {item.provider} · 输入 {item.input_chars} 字符
                      {item.truncated ? ' · 已截断' : ''}
                    </p>
                    <p className="ai-library-plain-summary">{item.summary}</p>
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section className="ai-library-section">
            <div className="ai-library-section-head">
              <h3>AI 速览</h3>
              <span className="hint">{feedBriefings.length} 条</span>
            </div>
            <div className="ai-library-list">
              {feedBriefings.length === 0 && !loading && <p className="hint">暂无 AI 速览。</p>}
              {feedBriefings.map((item) => (
                <details key={`feed-briefing-${item.digest_key}`} className="ai-library-item">
                  <summary className="ai-library-item-head">
                    <div className="ai-library-item-main">
                      <p className="ai-library-item-title">{item.scope_label || '当前阅读流'}</p>
                      <p className="ai-library-item-meta">
                        {formatTimeAgo(item.generated_at)} · {item.model} · {item.article_count} 条信息
                      </p>
                    </div>
                  </summary>
                  <div className="ai-library-item-body">
                    <p className="hint">
                      {item.provider}
                      {item.tag ? ` · 标签 ${item.tag}` : ''}
                      {item.keyword ? ` · 关键词 ${item.keyword}` : ''}
                      {item.truncated ? ' · 已截断' : ''}
                    </p>
                    <MarkdownBlock content={item.summary} />
                  </div>
                </details>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}
