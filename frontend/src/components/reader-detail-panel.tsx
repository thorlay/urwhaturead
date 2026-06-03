import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink, Maximize2, MoreHorizontal, RotateCcw, Sparkles, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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

type DetailView = 'main' | 'comments'
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

  const [detailViewPreference, setDetailViewPreference] = useState<{
    articleID: number | null
    view: DetailView
  }>({
    articleID: null,
    view: 'main',
  })
  const [readingPreferences, setReadingPreferences] = useState<ReadingPreferences>(readStoredReadingPreferences)

  const hasAIArticleSummary = Boolean(articleSummary.trim())
  const shouldShowAIInspector = hasAIArticleSummary || loadingArticleSummary || Boolean(articleSummaryError || selectedSummaryTask?.error)
  const hasThreadCommentsView = Boolean(selectedArticle?.thread)
  const hasCapturedExternal = Boolean(selectedArticle?.external?.content)
  const detailViewOptions = useMemo(
    () =>
      [
        { key: 'main' as const, label: '阅读', enabled: true },
        { key: 'comments' as const, label: '评论', enabled: hasThreadCommentsView },
      ].filter((item) => item.enabled),
    [hasThreadCommentsView],
  )
  const activeArticleID = selectedArticle?.id ?? null
  const detailView = useMemo<DetailView>(() => {
    const defaultView = detailViewOptions.find((item) => item.key === 'main')?.key ?? detailViewOptions[0]?.key ?? 'main'
    const requestedView = detailViewPreference.articleID === activeArticleID ? detailViewPreference.view : defaultView
    if (detailViewOptions.some((item) => item.key === requestedView)) {
      return requestedView
    }
    return defaultView
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
      {returnToAILibrary && readerView === 'detail' && (
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={openImmersiveReader}
                      disabled={!selectedArticleID}
                    >
                      <Maximize2 aria-hidden="true" />
                      沉浸阅读
                    </Button>
                  </>
                )}
              </div>
              <Button asChild variant="outline" size="sm" className="detail-open-link">
                <a href={selectedArticle.link} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
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
                  <Star aria-hidden="true" fill={isFavoriteArticle ? 'currentColor' : 'none'} />
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
                    <Sparkles aria-hidden="true" />
                    {loadingArticleSummary ? '生成中...' : '生成 AI 摘要'}
                  </Button>
                  {hasDetailMoreActions && (
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
                        <DropdownMenuContent className="detail-more-menu" aria-label="文章更多操作">
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

          {readerView === 'detail' && (
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
          )}

          {detailView === 'main' && (
            <>
              {shouldShowAIInspector && (
                <section className="ai-summary-card detail-section">
                  <div className="ai-summary-card-head">
                    <div>
                      <p className="ai-summary-card-kicker">
                        <Sparkles aria-hidden="true" />
                        AI Inspector
                      </p>
                      <h4>{hasAIArticleSummary ? '阅读前判断' : '生成阅读判断中'}</h4>
                    </div>
                    <span className="ai-summary-card-model">{aiModel || 'AI'}</span>
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
                <div className="detail-section-head">
                  <h4>{isThreadArticle ? '主帖正文' : '正文'}</h4>
                  {hasCapturedExternal && !isThreadArticle && <span className="hint">当前展示抓取全文</span>}
                  {selectedArticle.summary &&
                    !hasCapturedExternal &&
                    !selectedArticle.content &&
                    !selectedArticle.content_html &&
                    !threadPrimaryBody && <span className="hint">当前展示原始摘要</span>}
                </div>
                {isThreadArticle && threadPrimaryBody ? (
                  <PlainTextBlock content={threadPrimaryBody} className="reading-block prose" />
                ) : hasCapturedExternal && selectedArticle.external?.content ? (
                  <>
                    {selectedArticle.external.title && <p className="hint">{selectedArticle.external.title}</p>}
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

              {hasThreadCommentsView && selectedArticle.thread && (
                <section className="thread-section thread-preview-section detail-section">
                  <div className="thread-header">
                    <div>
                      <p className="detail-support-kicker">评论预览</p>
                      <h4>讨论</h4>
                    </div>
                    <div className="thread-header-tools">
                      <span className="thread-counts">
                        共 {selectedArticle.thread.total_posts} 帖 · 展示 {visibleThreadComments.length}
                      </span>
                      {threadComments.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="thread-order-toggle"
                          onClick={onToggleThreadCommentsNewestFirst}
                        >
                          {threadCommentsNewestFirst ? '最新在前' : '最早在前'}
                        </Button>
                      )}
                    </div>
                  </div>

                  {threadComments.length > 0 ? (
                    <>
                      <div className="thread-comments thread-comments-preview">
                        {visibleThreadComments.map((comment, index) => (
                          <article key={`preview-${comment.link}-${index}`} className="thread-comment">
                            <p className="thread-comment-meta">
                              #{comment.post_number || index + 2} · {comment.author || 'unknown'} ·{' '}
                              {comment.published_at ? formatTimeAgo(comment.published_at) : '-'}
                            </p>
                            <PlainTextBlock content={comment.content} className="reading-block" />
                          </article>
                        ))}
                      </div>
                      {threadComments.length > threadPreviewCommentLimit && (
                        <Button type="button" variant="ghost" size="sm" className="comment-toggle" onClick={() => setDetailView('comments')}>
                          查看全部评论（{threadComments.length}）
                        </Button>
                      )}
                    </>
                  ) : (
                    <p className="hint">暂无评论。</p>
                  )}
                  {selectedArticle.thread.truncated && <p className="hint">评论过多，仅展示前 120 条。</p>}
                </section>
              )}
            </>
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
                      {expandedThreadComments ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
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

          {detailView === 'main' && hasThreadCommentsView && threadComments.length === 0 && (
            <section className="detail-section detail-supporting-section">
              <div className="detail-section-head">
                <h4>继续阅读</h4>
              </div>
              <div className="detail-support-cards">
                <button type="button" className="detail-support-card" onClick={() => setDetailView('comments')}>
                  <span className="detail-support-kicker">评论区</span>
                  <strong>共 {selectedArticle.thread?.total_posts ?? threadComments.length} 帖讨论</strong>
                  <span className="hint">进入评论视图查看讨论</span>
                </button>
              </div>
            </section>
          )}
        </article>
      )}
    </section>
  )
}
