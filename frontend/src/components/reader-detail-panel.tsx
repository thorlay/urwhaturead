import { useCallback, useMemo, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { MarkdownBlock, PlainTextBlock, SafeHTMLBlock } from '@/components/rich-content-blocks'
import type { ArticleDetail, FeedBriefingInputItem } from '../types'

type ThreadComment = {
  post_number: number
  author: string
  published_at?: string
  link: string
  content: string
}

type ReaderSummaryTask = {
  error?: string
} | null

export type ReaderDetailPanelProps = {
  floatingDetailRef: RefObject<HTMLElement | null>
  showFloatingReader: boolean
  readerView: 'stream' | 'detail'
  selectedArticle: ArticleDetail | null
  selectedFeedBriefing: boolean
  loadingArticle: boolean
  articleError: string | null
  selectedArticleID: number | null
  openArticle: (articleID: number) => Promise<void>
  feedBriefingScopeLabel: string
  feedBriefingFreshnessLabel: string
  returnToReaderStream: () => void
  closeFloatingReader: () => void
  openImmersiveReader: () => void
  aiModel: string
  onGenerateFeedBriefing: (refresh: boolean) => Promise<void>
  loadingFeedBriefing: boolean
  feedBriefingMeta: string
  feedBriefingNewArticleCount: number
  feedBriefingError: string | null
  feedBriefing: string
  feedBriefingItems: FeedBriefingInputItem[]
  feedBriefingArticleCount: number
  formatTimeAgo: (input: string) => string
  selectedArticleReplyCountLabel: string
  selectedArticleImageURL: string | null
  closeDetailMoreMenu: () => void
  isFavoriteArticle: boolean
  onToggleFavoriteArticle: (articleID: number) => void
  onSummarizeArticle: (force: boolean) => Promise<void>
  loadingArticleSummary: boolean
  hasDetailMoreActions: boolean
  detailMoreMenuRef: RefObject<HTMLDivElement | null>
  showDetailMoreMenu: boolean
  toggleDetailMoreMenu: () => void
  canTrackThread: boolean
  onTrackThread: () => Promise<void>
  canForceRecalcSummary: boolean
  articleSummaryError: string | null
  articleSummary: string
  articleSummaryMeta: string
  selectedSummaryTask: ReaderSummaryTask
  isThreadArticle: boolean
  threadPrimaryBody: string
  visibleThreadComments: ThreadComment[]
  threadComments: ThreadComment[]
  threadCommentsNewestFirst: boolean
  onToggleThreadCommentsNewestFirst: () => void
  threadPreviewCommentLimit: number
  expandedThreadComments: boolean
  onToggleExpandedThreadComments: () => void
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
    feedBriefingScopeLabel,
    feedBriefingFreshnessLabel,
    returnToReaderStream,
    closeFloatingReader,
    openImmersiveReader,
    aiModel,
    onGenerateFeedBriefing,
    loadingFeedBriefing,
    feedBriefingMeta,
    feedBriefingNewArticleCount,
    feedBriefingError,
    feedBriefing,
    feedBriefingItems,
    feedBriefingArticleCount,
    formatTimeAgo,
    selectedArticleReplyCountLabel,
    selectedArticleImageURL,
    closeDetailMoreMenu,
    isFavoriteArticle,
    onToggleFavoriteArticle,
    onSummarizeArticle,
    loadingArticleSummary,
    hasDetailMoreActions,
    detailMoreMenuRef,
    showDetailMoreMenu,
    toggleDetailMoreMenu,
    canTrackThread,
    onTrackThread,
    canForceRecalcSummary,
    articleSummaryError,
    articleSummary,
    articleSummaryMeta,
    selectedSummaryTask,
    isThreadArticle,
    threadPrimaryBody,
    visibleThreadComments,
    threadComments,
    threadCommentsNewestFirst,
    onToggleThreadCommentsNewestFirst,
    threadPreviewCommentLimit,
    expandedThreadComments,
    onToggleExpandedThreadComments,
    hasHiddenThreadComments,
  } = props

  type DetailView = 'read' | 'summary' | 'comments' | 'capture'
  const [detailViewPreference, setDetailViewPreference] = useState<{
    articleID: number | null
    view: DetailView
  }>({
    articleID: null,
    view: 'read',
  })

  const hasAIArticleSummary = Boolean(articleSummary.trim())
  const hasThreadCommentsView = Boolean(selectedArticle?.thread)
  const hasCapturedExternal = Boolean(selectedArticle?.external?.content)
  const hasArticleBody = Boolean(
    (isThreadArticle && threadPrimaryBody) ||
      selectedArticle?.content_html ||
      selectedArticle?.content ||
      selectedArticle?.summary,
  )

  const detailViewOptions = useMemo(
    () =>
      [
        { key: 'read' as const, label: '正文', enabled: hasArticleBody },
        { key: 'summary' as const, label: hasAIArticleSummary ? 'AI 摘要' : '摘要', enabled: true },
        { key: 'comments' as const, label: '评论', enabled: hasThreadCommentsView },
        { key: 'capture' as const, label: '抓取原文', enabled: hasCapturedExternal },
      ].filter((item) => item.enabled),
    [hasAIArticleSummary, hasArticleBody, hasCapturedExternal, hasThreadCommentsView],
  )
  const activeArticleID = selectedArticle?.id ?? null
  const detailView = useMemo<DetailView>(() => {
    const requestedView = detailViewPreference.articleID === activeArticleID ? detailViewPreference.view : 'read'
    if (detailViewOptions.some((item) => item.key === requestedView)) {
      return requestedView
    }
    return detailViewOptions[0]?.key ?? 'read'
  }, [activeArticleID, detailViewOptions, detailViewPreference.articleID, detailViewPreference.view])
  const setDetailView = useCallback(
    (view: DetailView) => {
      setDetailViewPreference({
        articleID: activeArticleID,
        view,
      })
    },
    [activeArticleID],
  )

  if (!showFloatingReader && readerView !== 'detail') {
    return null
  }

  return (
    <section
      ref={floatingDetailRef}
      className={`panel detail reader-panel ${readerView === 'detail' ? 'detail-page' : 'detail-floating'}`}
    >
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
        <article className="detail-content">
          <header className="detail-header">
            <p className="detail-meta">
              AI 聚合速览
              {feedBriefingScopeLabel ? ` · ${feedBriefingScopeLabel}` : ''}
              {feedBriefingFreshnessLabel ? ` · ${feedBriefingFreshnessLabel}` : ''}
            </p>
            <h3 className="detail-title">AI 聚合速览</h3>
          </header>

          <div className="detail-toolbar detail-toolbar-sticky">
            <div className="detail-toolbar-actions detail-toolbar-main-actions">
              <div className="detail-mode-actions">
                {readerView === 'detail' ? (
                  <Button type="button" variant="outline" size="sm" onClick={returnToReaderStream}>
                    返回列表
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={closeFloatingReader}>
                      关闭
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={openImmersiveReader}>
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
                  {loadingFeedBriefing ? '生成中...' : '更新速览'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void onGenerateFeedBriefing(true)}
                  disabled={loadingFeedBriefing}
                >
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
          {feedBriefing && <MarkdownBlock content={feedBriefing} />}
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
      )}

      {selectedArticle && !loadingArticle && (
        <article className="detail-content">
          <header className="detail-header">
            <p className="detail-meta">
              {selectedArticle.source_name} · {formatTimeAgo(selectedArticle.published_at ?? selectedArticle.created_at)}
              {selectedArticleReplyCountLabel ? ` · ${selectedArticleReplyCountLabel}` : ''}
            </p>
            <h3 className="detail-title">{selectedArticle.title}</h3>
            {selectedArticle.author && <p className="detail-author">作者: {selectedArticle.author}</p>}
            <div className="detail-signals">
              {selectedArticleReplyCountLabel && <span className="detail-signal">讨论 {selectedArticleReplyCountLabel}</span>}
              {hasCapturedExternal && <span className="detail-signal">已抓取全文</span>}
              {hasAIArticleSummary && <span className="detail-signal">AI 已总结</span>}
              {isThreadArticle && <span className="detail-signal">论坛主题</span>}
            </div>
          </header>
          {selectedArticleImageURL && (
            <figure className="detail-hero-image">
              <img
                src={selectedArticleImageURL}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(event) => {
                  const target = event.currentTarget
                  const wrapper = target.parentElement
                  target.style.display = 'none'
                  if (wrapper) {
                    wrapper.style.display = 'none'
                  }
                }}
              />
            </figure>
          )}

          <div className="detail-toolbar detail-toolbar-sticky">
            <div className="detail-toolbar-actions detail-toolbar-main-actions">
              <div className="detail-mode-actions">
                {readerView === 'detail' ? (
                  <Button type="button" variant="outline" size="sm" onClick={returnToReaderStream}>
                    返回列表
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={closeFloatingReader}>
                      关闭
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={openImmersiveReader}
                      disabled={!selectedArticleID}
                    >
                      沉浸阅读
                    </Button>
                  </>
                )}
              </div>
              <Button asChild variant="outline" size="sm" className="detail-open-link">
                <a href={selectedArticle.link} target="_blank" rel="noreferrer">
                  打开原文
                </a>
              </Button>
              {selectedArticleID && selectedArticleID > 0 && (
                <Button
                  type="button"
                  variant={isFavoriteArticle ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onToggleFavoriteArticle(selectedArticleID)}
                >
                  {isFavoriteArticle ? '已收藏' : '收藏'}
                </Button>
              )}
              {selectedArticleID && selectedArticleID > 0 && (
                <div className="summary-actions">
                  <span className="hint ai-model-hint">{aiModel}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      closeDetailMoreMenu()
                      void onSummarizeArticle(false)
                    }}
                    disabled={loadingArticleSummary}
                  >
                    {loadingArticleSummary ? '生成中...' : '生成 AI 摘要'}
                  </Button>
                  {hasDetailMoreActions && (
                    <div ref={detailMoreMenuRef} className="detail-more-menu-wrap">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-haspopup="menu"
                        aria-expanded={showDetailMoreMenu}
                        onClick={toggleDetailMoreMenu}
                      >
                        更多
                      </Button>
                      {showDetailMoreMenu && (
                        <div className="detail-more-menu" role="menu" aria-label="文章更多操作">
                          {canTrackThread && (
                            <button
                              type="button"
                              className="detail-more-item"
                              role="menuitem"
                              onClick={() => {
                                closeDetailMoreMenu()
                                void onTrackThread()
                              }}
                            >
                              持续跟踪评论
                            </button>
                          )}
                          {canForceRecalcSummary && (
                            <button
                              type="button"
                              className="detail-more-item"
                              role="menuitem"
                              onClick={() => {
                                closeDetailMoreMenu()
                                void onSummarizeArticle(true)
                              }}
                              disabled={loadingArticleSummary}
                            >
                              强制重算
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {articleSummaryError && <p className="hint">AI 摘要错误: {articleSummaryError}</p>}
          {!articleSummary && articleSummaryMeta && <p className="hint">{articleSummaryMeta}</p>}
          {!articleSummary && selectedSummaryTask && selectedSummaryTask.error && (
            <p className="hint">任务详情: {selectedSummaryTask.error}</p>
          )}

          {detailViewOptions.length > 1 && (
            <nav className="detail-section-nav" aria-label="详情内容切换">
              {detailViewOptions.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`detail-section-tab ${detailView === item.key ? 'active' : ''}`}
                  onClick={() => setDetailView(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          )}

          {detailView === 'read' && hasAIArticleSummary && (
            <section className="ai-summary detail-summary-rail">
              <div className="detail-section-head">
                <h4>阅读前摘要</h4>
                <Button type="button" variant="ghost" size="sm" onClick={() => setDetailView('summary')}>
                  展开全文摘要
                </Button>
              </div>
              {articleSummaryMeta && <p className="hint">{articleSummaryMeta}</p>}
              <div className="detail-summary-preview">
                <MarkdownBlock content={articleSummary} />
              </div>
            </section>
          )}

          {detailView === 'read' && (
            <section className="detail-section detail-reading-section">
              <div className="detail-section-head">
                <h4>{isThreadArticle ? '主帖正文' : '正文'}</h4>
                {selectedArticle.summary && !selectedArticle.content && !selectedArticle.content_html && !threadPrimaryBody && (
                  <span className="hint">当前展示原始摘要</span>
                )}
              </div>
              {isThreadArticle && threadPrimaryBody ? (
                <PlainTextBlock content={threadPrimaryBody} className="reading-block prose" />
              ) : selectedArticle.content_html ? (
                <SafeHTMLBlock content={selectedArticle.content_html} baseURL={selectedArticle.link} />
              ) : selectedArticle.content ? (
                <PlainTextBlock content={selectedArticle.content} className="reading-block prose" />
              ) : selectedArticle.summary ? (
                <PlainTextBlock content={selectedArticle.summary} className="reading-block" />
              ) : (
                <p className="hint">暂无可展示正文。</p>
              )}
            </section>
          )}

          {detailView === 'summary' && (
            <section className="ai-summary detail-section">
              <div className="detail-section-head">
                <h4>AI 摘要</h4>
                {articleSummaryMeta && <span className="hint">{articleSummaryMeta}</span>}
              </div>
              {articleSummary ? (
                <MarkdownBlock content={articleSummary} />
              ) : (
                <p className="hint">
                  {loadingArticleSummary
                    ? '摘要正在生成中。'
                    : articleSummaryError || selectedSummaryTask?.error || '还没有可展示的 AI 摘要。'}
                </p>
              )}
            </section>
          )}

          {detailView === 'capture' && selectedArticle.external?.content && (
            <section className="detail-section detail-reading-section">
              <div className="detail-section-head">
                <h4>抓取原文</h4>
                <Button asChild variant="outline" size="sm" className="detail-open-link">
                  <a href={selectedArticle.external.url} target="_blank" rel="noreferrer">
                    打开抓取原文
                  </a>
                </Button>
              </div>
              <p className="hint">{selectedArticle.external.title}</p>
              <PlainTextBlock content={selectedArticle.external.content} className="reading-block prose" />
              {selectedArticle.external.truncated && <p className="hint">原文较长，已截断显示。</p>}
            </section>
          )}

          {detailView === 'comments' && selectedArticle.thread && (
            <section className="thread-section detail-section">
              <div className="thread-header">
                <h4>评论</h4>
                <div className="thread-header-tools">
                  <span className="thread-counts">
                    共 {selectedArticle.thread.total_posts} 帖 · 展示 {visibleThreadComments.length}
                  </span>
                  {threadComments.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="thread-order-toggle"
                      onClick={onToggleThreadCommentsNewestFirst}
                    >
                      {threadCommentsNewestFirst ? '最新在前' : '最早在前'}
                    </Button>
                  )}
                </div>
              </div>

              {threadComments.length > 0 && (
                <>
                  <div className="thread-comments">
                    {visibleThreadComments.map((comment, index) => (
                      <article key={`${comment.link}-${index}`} className="thread-comment">
                        <p className="thread-comment-meta">
                          #{comment.post_number || index + 2} · {comment.author || 'unknown'} ·{' '}
                          {comment.published_at ? formatTimeAgo(comment.published_at) : '-'}
                        </p>
                        <PlainTextBlock content={comment.content} className="reading-block" />
                      </article>
                    ))}
                  </div>
                  {threadComments.length > threadPreviewCommentLimit && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="comment-toggle"
                      onClick={onToggleExpandedThreadComments}
                    >
                      {expandedThreadComments ? '收起评论' : `查看全部评论（${threadComments.length}）`}
                    </Button>
                  )}
                </>
              )}
              {threadComments.length === 0 && <p className="hint">暂无评论。</p>}

              {hasHiddenThreadComments && (
                <p className="hint">
                  默认只展示{threadCommentsNewestFirst ? '最近' : '最早'} {threadPreviewCommentLimit} 条评论，可展开查看全部。
                </p>
              )}
              {selectedArticle.thread.truncated && <p className="hint">评论过多，仅展示前 120 条。</p>}
            </section>
          )}

          {detailView === 'read' && (hasCapturedExternal || hasThreadCommentsView) && (
            <section className="detail-section detail-supporting-section">
              <div className="detail-section-head">
                <h4>继续阅读</h4>
              </div>
              <div className="detail-support-cards">
                {hasCapturedExternal && (
                  <button type="button" className="detail-support-card" onClick={() => setDetailView('capture')}>
                    <span className="detail-support-kicker">抓取原文</span>
                    <strong>{selectedArticle.external?.title || '查看抓取到的全文'}</strong>
                    <span className="hint">切换到抓取原文视图</span>
                  </button>
                )}
                {hasThreadCommentsView && (
                  <button type="button" className="detail-support-card" onClick={() => setDetailView('comments')}>
                    <span className="detail-support-kicker">评论区</span>
                    <strong>共 {selectedArticle.thread?.total_posts ?? threadComments.length} 帖讨论</strong>
                    <span className="hint">
                      {threadComments.length > 0
                        ? `当前可读 ${visibleThreadComments.length} 条，点击进入评论视图`
                        : '进入评论视图查看讨论'}
                    </span>
                  </button>
                )}
              </div>
            </section>
          )}
        </article>
      )}
    </section>
  )
}
