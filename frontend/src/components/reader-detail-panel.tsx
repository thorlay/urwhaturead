import { useState, type RefObject } from 'react'
import { ArrowLeft, CircleAlert, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useReaderArticleScroll } from '../hooks/use-reader-article-scroll'
import { useReaderReadingPreferences } from '../hooks/use-reader-reading-preferences'
import type { ArticleDetail } from '../types'
import { ReaderArticleToolbar, type ReaderArticleToolbarProps } from './reader-article-toolbar'
import { DiscussionAnalysisPanel } from './discussion-analysis-panel'
import { ReaderArticleBody, ReaderArticleCover, type ReaderArticleBodyProps } from './reader-article-body'
import { ReaderArticleComments, type ReaderArticleCommentsProps } from './reader-article-comments'
import { ReaderArticleSummaryCard, type ReaderArticleSummaryCardProps } from './reader-article-summary-card'
import { ReaderBriefingDetail, type ReaderBriefingDetailProps } from './reader-briefing-detail'
import { ReaderReadingSettings } from './reader-reading-settings'

export type ReaderDetailPanelProps = Omit<ReaderArticleToolbarProps, 'articleLink' | 'onReturn' | 'returnLabel'>
  & Omit<ReaderBriefingDetailProps, 'handleReturn' | 'returnLabel'>
  & ReaderArticleSummaryCardProps
  & Omit<ReaderArticleBodyProps, 'selectedArticle'>
  & Omit<ReaderArticleCommentsProps, 'thread' | 'sortByVotes' | 'onResetVoteSort' | 'onSortByVotes'>
  & {
    floatingDetailRef: RefObject<HTMLElement | null>
    showFloatingReader: boolean
    selectedArticle: ArticleDetail | null
    selectedFeedBriefing: boolean
    loadingArticle: boolean
    articleError: string | null
    openArticle: (articleID: number) => Promise<void>
    returnToReaderStream: () => void
    returnToAILibrary?: (() => void) | null
    returnToAILibraryLabel?: string
    selectedArticleReplyCountLabel: string
    selectedArticleImageURL: string | null
    hasDetailMoreActions: boolean
    hasHiddenThreadComments: boolean
  }

export function ReaderDetailPanel(props: ReaderDetailPanelProps) {
  const {
    floatingDetailRef,
    showFloatingReader,
    readerView,
    selectedArticle,
    selectedFeedBriefing,
    loadingArticle,
    articleError,
    selectedArticleID,
    openArticle,
    returnToReaderStream,
    returnToAILibrary,
    returnToAILibraryLabel,
    formatTimeAgo,
  } = props

  const { readingPreferences, setReadingPreferences, readingPreferenceClassName } = useReaderReadingPreferences(readerView)
  // Keep the vote selection across temporary gaps while switching articles.
  const [voteSortArticleID, setVoteSortArticleID] = useState<number | null>(null)
  const sortByVotes = selectedArticleID != null && voteSortArticleID === selectedArticleID
  useReaderArticleScroll(floatingDetailRef, readerView, selectedArticle?.id)

  if (!showFloatingReader && readerView !== 'detail') {
    return null
  }

  const handleReturn = returnToAILibrary ?? returnToReaderStream
  const returnLabel = returnToAILibraryLabel ?? '返回列表'

  return (
    <section
      ref={floatingDetailRef}
      className={`panel detail reader-panel ${readerView === 'detail' ? 'detail-page' : 'detail-floating'} ${readingPreferenceClassName}`}
    >
      {returnToAILibrary && readerView === 'detail' && !selectedArticle && (
        <div className="detail-origin-return">
          <Button type="button" variant="ghost" size="sm" onClick={handleReturn}>
            <ArrowLeft aria-hidden="true" />
            {returnLabel}
          </Button>
          <span className="hint">继续回看 AI 速览</span>
        </div>
      )}

      {!selectedArticle && !selectedFeedBriefing && !loadingArticle && !articleError && (
        <div className="hint-group">
          <p className="hint">请先从列表选择一篇文章</p>
          <p className="hint">快捷键: j/k 切换文章，o 打开原文</p>
        </div>
      )}

      {loadingArticle && (
        <div className="detail-content">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </div>
      )}

      {articleError && selectedArticleID && selectedArticleID > 0 && !loadingArticle && (
        <div className="inline-error">
          <span>文章详情加载失败: {articleError}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void openArticle(selectedArticleID)}>
            重试
          </Button>
        </div>
      )}

      {selectedFeedBriefing && !loadingArticle && (
        <ReaderBriefingDetail {...props} handleReturn={handleReturn} returnLabel={returnLabel} />
      )}

      {selectedArticle && !loadingArticle && (
        <article className="detail-content detail-article">
          <ReaderArticleToolbar
            {...props}
            articleLink={selectedArticle.link}
            onReturn={handleReturn}
            returnLabel={returnLabel}
          />

          <header className="detail-header">
            <p className="detail-meta">
              {selectedArticle.source_name} · {formatTimeAgo(selectedArticle.published_at ?? selectedArticle.created_at)}
            </p>
            <h3 className="detail-title">{selectedArticle.title}</h3>
            {selectedArticle.author && <p className="detail-author">作者: {selectedArticle.author}</p>}
          </header>
          {selectedArticle.enrichment_status === 'loading' && (
            <p className="article-enrichment-status" aria-live="polite">
              <LoaderCircle className="is-spinning" aria-hidden="true" />
              正在补充原文与评论…
            </p>
          )}
          {selectedArticle.enrichment_status === 'failed' && (
            <p className="article-enrichment-status is-warning" role="status">
              <CircleAlert aria-hidden="true" />
              附加内容暂时无法加载，当前正文仍可阅读。
            </p>
          )}
          <ReaderArticleCover {...props} selectedArticle={selectedArticle} />

          {readerView === 'detail' && (
            <ReaderReadingSettings
              readingPreferences={readingPreferences}
              setReadingPreferences={setReadingPreferences}
            />
          )}

          {selectedArticle && <DiscussionAnalysisPanel article={selectedArticle} />}
          <ReaderArticleSummaryCard {...props} />
          <ReaderArticleBody {...props} selectedArticle={selectedArticle} />

          <ReaderArticleComments
            {...props}
            thread={selectedArticle.thread}
            sortByVotes={sortByVotes}
            onResetVoteSort={() => setVoteSortArticleID(null)}
            onSortByVotes={() => setVoteSortArticleID(selectedArticleID)}
          />

        </article>
      )}
    </section>
  )
}
