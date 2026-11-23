import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MarkdownBlock } from '@/components/rich-content-blocks'

export type ReaderArticleSummaryCardProps = {
  selectedArticleID: number | null
  loadingArticleSummary: boolean
  onSummarizeArticle: (force: boolean) => Promise<void>
  articleSummaryError: string | null
  articleSummary: string
  articleSummaryMeta: string
  selectedSummaryTask: { error?: string } | null
}

export function ReaderArticleSummaryCard({
  selectedArticleID,
  loadingArticleSummary,
  onSummarizeArticle,
  articleSummaryError,
  articleSummary,
  articleSummaryMeta,
  selectedSummaryTask,
}: ReaderArticleSummaryCardProps) {
  const hasAIArticleSummary = Boolean(articleSummary.trim())
  const shouldShowAIInspector = hasAIArticleSummary || loadingArticleSummary || Boolean(articleSummaryError || selectedSummaryTask?.error)
  if (!shouldShowAIInspector) return null

  return (
    <section className="ai-summary-card detail-section">
      <div className="ai-summary-card-head">
        <div>
          <p className="ai-summary-card-kicker">
            <Sparkles aria-hidden="true" />
            AI 摘要
          </p>
          <h4>{hasAIArticleSummary ? '文章摘要' : '生成阅读判断中'}</h4>
        </div>
      </div>
      {articleSummaryMeta && <p className="hint">{articleSummaryMeta}</p>}
      {articleSummary ? (
        <MarkdownBlock content={articleSummary} />
      ) : (
        <div className="ai-summary-empty">
          <p className="hint">
            {loadingArticleSummary
              ? '摘要正在生成中。'
              : articleSummaryError || selectedSummaryTask?.error || 'AI 摘要生成失败。'}
          </p>
          {selectedArticleID && selectedArticleID > 0 && !loadingArticleSummary && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onSummarizeArticle(false)}
            >
              <Sparkles aria-hidden="true" />
              重新生成 AI 摘要
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
