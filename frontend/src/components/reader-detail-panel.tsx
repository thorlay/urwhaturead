import { useEffect, useState, type RefObject } from 'react'
import { ArrowLeft, ChevronDown, ChevronUp, CircleAlert, ExternalLink, LoaderCircle, Maximize2, MoreHorizontal, RotateCcw, Sparkles, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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

type ReadingFontSize = 'compact' | 'default' | 'large'
type ReadingWidth = 'narrow' | 'default' | 'wide'
type ReadingLineHeight = 'tight' | 'default' | 'loose'

type ReadingPreferences = {
  fontSize: ReadingFontSize
  width: ReadingWidth
  lineHeight: ReadingLineHeight
}

const READING_PREFERENCES_STORAGE_KEY = 'quick.reader.detail_preferences'
const READING_SCROLL_STORAGE_KEY = 'quick.reader.detail_scroll_positions'
const DEFAULT_READING_PREFERENCES: ReadingPreferences = {
  fontSize: 'default',
  width: 'default',
  lineHeight: 'default',
}

function isReadingFontSize(value: unknown): value is ReadingFontSize {
  return value === 'compact' || value === 'default' || value === 'large'
}

function isReadingWidth(value: unknown): value is ReadingWidth {
  return value === 'narrow' || value === 'default' || value === 'wide'
}

function isReadingLineHeight(value: unknown): value is ReadingLineHeight {
  return value === 'tight' || value === 'default' || value === 'loose'
}

function readStoredReadingPreferences(): ReadingPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_READING_PREFERENCES
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(READING_PREFERENCES_STORAGE_KEY) || '{}') as Partial<ReadingPreferences>
    return {
      fontSize: isReadingFontSize(parsed.fontSize) ? parsed.fontSize : DEFAULT_READING_PREFERENCES.fontSize,
      width: isReadingWidth(parsed.width) ? parsed.width : DEFAULT_READING_PREFERENCES.width,
      lineHeight: isReadingLineHeight(parsed.lineHeight) ? parsed.lineHeight : DEFAULT_READING_PREFERENCES.lineHeight,
    }
  } catch {
    return DEFAULT_READING_PREFERENCES
  }
}

function readStoredScrollPositions(): Record<string, number> {
  if (typeof window === 'undefined') {
    return {}
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(READING_SCROLL_STORAGE_KEY) || '{}') as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [key, typeof value === 'number' && Number.isFinite(value) ? value : 0] as const)
        .filter(([, value]) => value > 0),
    )
  } catch {
    return {}
  }
}

function writeStoredScrollPosition(articleID: number, scrollTop: number) {
  if (typeof window === 'undefined') {
    return
  }
  const positions = readStoredScrollPositions()
  positions[String(articleID)] = Math.max(0, Math.round(scrollTop))
  const entries = Object.entries(positions).slice(-200)
  try {
    window.localStorage.setItem(READING_SCROLL_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // Ignore storage failures; reading state is an enhancement, not core data.
  }
}

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
  returnToAILibrary?: (() => void) | null
  returnToAILibraryLabel?: string
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
    returnToAILibrary,
    returnToAILibraryLabel,
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
    selectedArticleImageURL,
    closeDetailMoreMenu,
    isFavoriteArticle,
    onToggleFavoriteArticle,
    onSummarizeArticle,
    loadingArticleSummary,
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
  } = props

  const [readingPreferences, setReadingPreferences] = useState<ReadingPreferences>(readStoredReadingPreferences)
  const hasAIArticleSummary = Boolean(articleSummary.trim())
  const shouldShowAIInspector = hasAIArticleSummary || loadingArticleSummary || Boolean(articleSummaryError || selectedSummaryTask?.error)
  const hasCapturedExternal = Boolean(selectedArticle?.external?.content)
  const readingPreferenceClassName =
    readerView === 'detail'
      ? `detail-font-${readingPreferences.fontSize} detail-width-${readingPreferences.width} detail-line-${readingPreferences.lineHeight}`
      : ''

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.setItem(READING_PREFERENCES_STORAGE_KEY, JSON.stringify(readingPreferences))
    } catch {
      // Ignore storage failures; controls still work for the current session.
    }
  }, [readingPreferences])

  useEffect(() => {
    if (readerView !== 'detail' || !selectedArticle?.id) {
      return
    }
    const panel = floatingDetailRef.current
    if (!panel) {
      return
    }

    const articleID = selectedArticle.id
    const storedTop = readStoredScrollPositions()[String(articleID)] ?? 0
    const restoreTimer = window.setTimeout(() => {
      panel.scrollTop = storedTop
    }, 0)
    let animationFrame = 0
    const savePosition = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      animationFrame = window.requestAnimationFrame(() => {
        writeStoredScrollPosition(articleID, panel.scrollTop)
      })
    }
    panel.addEventListener('scroll', savePosition, { passive: true })
    return () => {
      window.clearTimeout(restoreTimer)
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      writeStoredScrollPosition(articleID, panel.scrollTop)
      panel.removeEventListener('scroll', savePosition)
    }
  }, [floatingDetailRef, readerView, selectedArticle?.id])

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
        <article className="detail-content detail-article">
          <div className="detail-toolbar detail-toolbar-sticky">
            <div className="detail-toolbar-actions detail-toolbar-main-actions">
              <div className="detail-mode-actions">
                {readerView === 'detail' ? (
                  <Button type="button" variant="ghost" size="sm" onClick={handleReturn}>
                    <ArrowLeft aria-hidden="true" />
                    {returnLabel}
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="ghost" size="sm" onClick={closeFloatingReader}>
                      <X aria-hidden="true" />
                      关闭
                    </Button>
                  </>
                )}
              </div>
              <Button asChild variant="ghost" size="sm" className="detail-open-link">
                <a href={selectedArticle.link} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
                  打开原文
                </a>
              </Button>
              {selectedArticleID && selectedArticleID > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onToggleFavoriteArticle(selectedArticleID)}
                  aria-pressed={isFavoriteArticle}
                >
                  <Star aria-hidden="true" fill={isFavoriteArticle ? 'currentColor' : 'none'} />
                  {isFavoriteArticle ? '已收藏' : '收藏'}
                </Button>
              )}
              {selectedArticleID && selectedArticleID > 0 && (
                <div className="summary-actions">
                  <div ref={detailMoreMenuRef} className="detail-more-menu-wrap">
                      <DropdownMenu
                        open={showDetailMoreMenu}
                        onOpenChange={(open) => {
                          if (open) {
                            toggleDetailMoreMenu()
                            return
                          }
                          closeDetailMoreMenu()
                        }}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="sm" aria-expanded={showDetailMoreMenu}>
                            <MoreHorizontal aria-hidden="true" />
                            更多
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="detail-more-menu" aria-label="文章更多操作" onEscapeKeyDown={(event) => event.stopPropagation()}>
                          <DropdownMenuLabel>AI 模型 · {aiModel || '默认'}</DropdownMenuLabel>
                          <DropdownMenuItem disabled={loadingArticleSummary} onSelect={() => { closeDetailMoreMenu(); void onSummarizeArticle(false) }}>
                            <Sparkles aria-hidden="true" />{loadingArticleSummary ? '生成中…' : '生成 AI 摘要'}
                          </DropdownMenuItem>
                          {readerView !== 'detail' && <DropdownMenuItem onSelect={openImmersiveReader}><Maximize2 aria-hidden="true" />沉浸阅读</DropdownMenuItem>}
                          {canTrackThread && (
                            <DropdownMenuItem
                              className="detail-more-item"
                              onSelect={(event) => {
                                event.preventDefault()
                                closeDetailMoreMenu()
                                void onTrackThread()
                              }}
                            >
                              持续跟踪评论
                            </DropdownMenuItem>
                          )}
                          {canForceRecalcSummary && (
                            <DropdownMenuItem
                              className="detail-more-item"
                              disabled={loadingArticleSummary}
                              onSelect={(event) => {
                                event.preventDefault()
                                closeDetailMoreMenu()
                                void onSummarizeArticle(true)
                              }}
                            >
                              <RotateCcw aria-hidden="true" />
                              强制重算
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                  </div>
                </div>
              )}
            </div>
          </div>

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
          {selectedArticleImageURL && (
            <figure className="detail-hero-image">
              <img
                src={selectedArticleImageURL}
                alt=""
                loading="eager"
                fetchPriority="high"
                decoding="async"
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


          {readerView === 'detail' && (
            <details className="detail-reading-settings">
              <summary>阅读设置<span>字号 · 行宽 · 行距</span></summary>
              <div className="detail-reading-controls" aria-label="阅读设置">
              <div className="detail-reading-control-group">
                <span>字号</span>
                {[
                  ['compact', '小'],
                  ['default', '中'],
                  ['large', '大'],
                ].map(([value, label]) => (
                  <button
                    key={`font-${value}`}
                    type="button"
                    className={`detail-reading-control ${readingPreferences.fontSize === value ? 'active' : ''}`}
                    onClick={() => setReadingPreferences((current) => ({ ...current, fontSize: value as ReadingFontSize }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="detail-reading-control-group">
                <span>行宽</span>
                {[
                  ['narrow', '窄'],
                  ['default', '中'],
                  ['wide', '宽'],
                ].map(([value, label]) => (
                  <button
                    key={`width-${value}`}
                    type="button"
                    className={`detail-reading-control ${readingPreferences.width === value ? 'active' : ''}`}
                    onClick={() => setReadingPreferences((current) => ({ ...current, width: value as ReadingWidth }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="detail-reading-control-group">
                <span>行距</span>
                {[
                  ['tight', '紧'],
                  ['default', '中'],
                  ['loose', '松'],
                ].map(([value, label]) => (
                  <button
                    key={`line-${value}`}
                    type="button"
                    className={`detail-reading-control ${readingPreferences.lineHeight === value ? 'active' : ''}`}
                    onClick={() => setReadingPreferences((current) => ({ ...current, lineHeight: value as ReadingLineHeight }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              </div>
            </details>
          )}

          <>
              {shouldShowAIInspector && (
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
              )}

              <section className="detail-section detail-reading-section">
                {isThreadArticle && threadPrimaryBody ? (
                  <PlainTextBlock content={threadPrimaryBody} className="reading-block prose" />
                ) : hasCapturedExternal && selectedArticle.external?.content ? (
                  <>
                    <PlainTextBlock content={selectedArticle.external.content} className="reading-block prose" />
                    {selectedArticle.external.truncated && <p className="hint">原文较长，已截断显示。</p>}
                  </>
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

          </>

          {threadComments.length > 0 && selectedArticle.thread && (
            <section className="thread-section detail-section">
              <div className="thread-header">
                <h4>讨论 · {threadComments.length} 条回复</h4>
                <div className="thread-header-tools">
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
                      {expandedThreadComments ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                      {expandedThreadComments ? '收起评论' : `查看全部评论（${threadComments.length}）`}
                    </Button>
                  )}
                </>
              )}

              {selectedArticle.thread.truncated && <p className="hint">评论过多，仅展示前 120 条。</p>}
            </section>
          )}


        </article>
      )}
    </section>
  )
}
