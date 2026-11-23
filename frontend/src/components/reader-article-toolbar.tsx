import { useRef, type RefObject } from 'react'
import { ArrowLeft, ExternalLink, Maximize2, MoreHorizontal, RotateCcw, Sparkles, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

type ReaderArticleMoreMenuProps = {
  readerView: 'stream' | 'detail'
  aiModel: string
  detailMoreMenuRef: RefObject<HTMLDivElement | null>
  showDetailMoreMenu: boolean
  toggleDetailMoreMenu: () => void
  closeDetailMoreMenu: () => void
  loadingArticleSummary: boolean
  onSummarizeArticle: (force: boolean) => Promise<void>
  openImmersiveReader: () => void
  canTrackThread: boolean
  onTrackThread: () => Promise<void>
  canForceRecalcSummary: boolean
}

export type ReaderArticleToolbarProps = ReaderArticleMoreMenuProps & {
  selectedArticleID: number | null
  closeFloatingReader: () => void
  isFavoriteArticle: boolean
  onToggleFavoriteArticle: (articleID: number) => void
  articleLink: string
  onReturn: () => void
  returnLabel: string
}

export function ReaderArticleToolbar({
  readerView,
  selectedArticleID,
  closeFloatingReader,
  isFavoriteArticle,
  onToggleFavoriteArticle,
  articleLink,
  onReturn,
  returnLabel,
  ...menuProps
}: ReaderArticleToolbarProps) {
  return (
    <div className="detail-toolbar detail-toolbar-sticky">
      <div className="detail-toolbar-actions detail-toolbar-main-actions">
        <div className="detail-mode-actions">
          {readerView === 'detail' ? (
            <Button type="button" variant="ghost" size="sm" onClick={onReturn}>
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
          <a href={articleLink} target="_blank" rel="noreferrer">
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
            <ReaderArticleMoreMenu readerView={readerView} {...menuProps} />
          </div>
        )}
      </div>
    </div>
  )
}

function ReaderArticleMoreMenu({
  readerView,
  aiModel,
  detailMoreMenuRef,
  showDetailMoreMenu,
  toggleDetailMoreMenu,
  closeDetailMoreMenu,
  loadingArticleSummary,
  onSummarizeArticle,
  openImmersiveReader,
  canTrackThread,
  onTrackThread,
  canForceRecalcSummary,
}: ReaderArticleMoreMenuProps) {
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const restoreFocusWithoutScroll = useRef(false)

  return (
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
        <DropdownMenuTrigger ref={moreButtonRef} asChild>
          <Button type="button" variant="ghost" size="sm" aria-expanded={showDetailMoreMenu}>
            <MoreHorizontal aria-hidden="true" />
            更多
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="detail-more-menu"
          aria-label="文章更多操作"
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            if (!restoreFocusWithoutScroll.current) return
            restoreFocusWithoutScroll.current = false
            // The trigger is at the top of the immersive view. Focusing it
            // normally would undo the article's restored scroll position.
            event.preventDefault()
            moreButtonRef.current?.focus({ preventScroll: true })
          }}
        >
          <DropdownMenuLabel>AI 模型 · {aiModel || '默认'}</DropdownMenuLabel>
          <DropdownMenuItem disabled={loadingArticleSummary} onSelect={() => { closeDetailMoreMenu(); void onSummarizeArticle(false) }}>
            <Sparkles aria-hidden="true" />{loadingArticleSummary ? '生成中…' : '生成 AI 摘要'}
          </DropdownMenuItem>
          {readerView !== 'detail' && (
            <DropdownMenuItem onSelect={() => {
              restoreFocusWithoutScroll.current = window.matchMedia('(min-width: 981px)').matches
              openImmersiveReader()
            }}>
              <Maximize2 aria-hidden="true" />沉浸阅读
            </DropdownMenuItem>
          )}
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
  )
}
