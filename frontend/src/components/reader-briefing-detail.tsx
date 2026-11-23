import { ArrowLeft, Maximize2, RotateCcw, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MarkdownBlock } from '@/components/rich-content-blocks'
import type { FeedBriefingInputItem } from '../types'

export type ReaderBriefingDetailProps = {
  readerView: 'stream' | 'detail'
  handleReturn: () => void
  returnLabel: string
  closeFloatingReader: () => void
  openImmersiveReader: () => void
  aiModel: string
  feedBriefingScopeLabel: string
  feedBriefingFreshnessLabel: string
  onGenerateFeedBriefing: (refresh: boolean) => Promise<void>
  loadingFeedBriefing: boolean
  feedBriefingMeta: string
  feedBriefingNewArticleCount: number
  feedBriefingError: string | null
  feedBriefing: string
  feedBriefingItems: FeedBriefingInputItem[]
  feedBriefingArticleCount: number
  formatTimeAgo: (input: string) => string
}

export function ReaderBriefingDetail({
  readerView,
  handleReturn,
  returnLabel,
  closeFloatingReader,
  openImmersiveReader,
  aiModel,
  feedBriefingScopeLabel,
  feedBriefingFreshnessLabel,
  onGenerateFeedBriefing,
  loadingFeedBriefing,
  feedBriefingMeta,
  feedBriefingNewArticleCount,
  feedBriefingError,
  feedBriefing,
  feedBriefingItems,
  feedBriefingArticleCount,
  formatTimeAgo,
}: ReaderBriefingDetailProps) {
  return (
    <article className="detail-content">
      <header className="detail-header">
        <p className="detail-meta">
          AI 聚合速览
          {feedBriefingScopeLabel ? ` · ${feedBriefingScopeLabel}` : ''}
          {feedBriefingFreshnessLabel ? ` · ${feedBriefingFreshnessLabel}` : ''}
        </p>
        <h3 className="detail-title">{feedBriefingScopeLabel === '论文精选' ? '论文精选' : feedBriefingScopeLabel === '论坛讨论简报' ? '论坛讨论简报' : 'AI 聚合速览'}</h3>
      </header>

      <div className="detail-toolbar detail-toolbar-sticky">
        <div className="detail-toolbar-actions detail-toolbar-main-actions">
          <div className="detail-mode-actions">
            {readerView === 'detail' ? (
              <Button type="button" variant="outline" size="sm" onClick={handleReturn}>
                <ArrowLeft aria-hidden="true" />
                {returnLabel}
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" size="sm" onClick={closeFloatingReader}>
                  <X aria-hidden="true" />
                  关闭
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={openImmersiveReader}>
                  <Maximize2 aria-hidden="true" />
                  沉浸阅读
                </Button>
              </>
            )}
          </div>
          <div className="summary-actions">
            <span className="hint ai-model-hint">{aiModel}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onGenerateFeedBriefing(false)}
              disabled={loadingFeedBriefing}
            >
              <Sparkles aria-hidden="true" />
              {loadingFeedBriefing ? '生成中...' : '更新速览'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void onGenerateFeedBriefing(true)}
              disabled={loadingFeedBriefing}
            >
              <RotateCcw aria-hidden="true" />
              强制重算
            </Button>
          </div>
        </div>
      </div>

      {feedBriefingMeta && <p className="hint">{feedBriefingMeta}</p>}
      {feedBriefingNewArticleCount > 0 && (
        <p className="hint">速览生成后新增 {feedBriefingNewArticleCount} 条信息，建议更新速览。</p>
      )}
      {feedBriefingError && <p className="hint">生成失败: {feedBriefingError}</p>}
      {loadingFeedBriefing && !feedBriefing && (
        <div className="ai-briefing-loading">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </div>
      )}
      {feedBriefing && <MarkdownBlock content={feedBriefing.replace(/\[A(\d{1,3})\]/g, (citation, rawIndex: string) => {
        const ref = feedBriefingItems[Number(rawIndex) - 1]
        return ref && /^https?:\/\//i.test(ref.link) ? `[${feedBriefingScopeLabel === '论坛讨论简报' ? '原帖' : '原文'} ${Number(rawIndex)}](${ref.link})` : citation
      })} />}
      {feedBriefingItems.length > 0 && (
        <section className="ai-briefing-inputs">
          <p className="hint">
            本次总结基于 {feedBriefingArticleCount || feedBriefingItems.length} 条信息，以下展示前 {feedBriefingItems.length} 条：
          </p>
          <div className="ai-briefing-input-list">
            {feedBriefingItems.map((item) => (
              <a
                key={`briefing-detail-input-${item.id}`}
                className="ai-briefing-input-item"
                href={item.link}
                target="_blank"
                rel="noreferrer"
              >
                <span className="ai-briefing-input-source">{item.source_name}</span>
                <span className="ai-briefing-input-title">{item.title}</span>
                {item.published_at && <span className="ai-briefing-input-time">{formatTimeAgo(item.published_at)}</span>}
              </a>
            ))}
          </div>
        </section>
      )}
    </article>
  )
}
