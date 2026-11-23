import { Suspense, lazy, type ReactNode, type RefObject } from 'react'
import { Check, Clock3, MoreHorizontal, RefreshCw, RotateCcw, Search, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select } from '@/components/ui/select'
import { WorkspaceToolbar } from '@/components/workspace-toolbar'
import { cn } from '@/lib/utils'
import type { Source } from '../types'

const ReaderFeedFilters = lazy(async () => {
  const module = await import('@/components/reader-feed-filters')
  return { default: module.ReaderFeedFilters }
})

export type ReaderFeedToolbarProps = {
  sourceControl?: ReactNode
  feedMode: 'all' | 'important'
  onChangeFeedMode: (mode: 'all' | 'important') => void
  showFloatingReader: boolean
  readerView: 'stream' | 'detail'
  feedTitleOnlyMode: boolean
  showFeedImages: boolean
  showFeedSearch: boolean
  showAdvancedFilters: boolean
  showFeedAIMoreMenu: boolean
  loadingFeedBriefing: boolean
  unreadVisibleCount: number
  favoriteVisibleCount: number
  unreadOnly: boolean
  favoriteOnly: boolean
  hasActiveFilters: boolean
  keyword: string
  tagFilter: string
  sourceFilter: string
  mutedSiteKeys: string[]
  availableTags: string[]
  readerSources: Source[]
  sourceFilterSelectValue: string
  sourceFilterChipLabel: string
  feedAIMoreRef: RefObject<HTMLDivElement | null>
  catchUpCheckpoint: string
  catchUpCount: number
  catchUpLoading: boolean
  catchUpError: string | null
  onGenerateFeedBriefing: (refresh: boolean, forum?: boolean, papers?: boolean) => Promise<void>
  onRefreshCatchUp: () => Promise<void>
  onGenerateCatchUpBriefing: () => Promise<void>
  onMarkCaughtUp: () => void
  onCloseFeedAIMoreMenu: () => void
  onToggleFeedAIMoreMenu: () => void
  onSetUnreadOnly: (next: boolean) => void
  onSetFavoriteOnly: (next: boolean) => void
  onToggleFeedTitleOnlyMode: () => void
  onToggleFeedImages: () => void
  onToggleFeedSearch: () => void
  onApplyFilters: (channel?: 'news' | 'forum' | 'papers') => void
  onToggleAdvancedFilters: () => void
  onChangeKeyword: (value: string) => void
  onChangeTagFilter: (value: string) => void
  onChangeSourceFilter: (value: string) => void
  onClearFilters: () => void
  onRemoveFilter: (type: 'keyword' | 'tag' | 'source' | 'muted_sites' | 'unread' | 'favorite') => void
  formatTimeAgo: (input: string) => string
}

export function ReaderFeedToolbar({
  sourceControl,
  feedMode,
  onChangeFeedMode,
  showFloatingReader,
  readerView,
  feedTitleOnlyMode,
  showFeedImages,
  showFeedSearch,
  showAdvancedFilters,
  showFeedAIMoreMenu,
  loadingFeedBriefing,
  unreadVisibleCount,
  favoriteVisibleCount,
  unreadOnly,
  favoriteOnly,
  hasActiveFilters,
  keyword,
  tagFilter,
  sourceFilter,
  mutedSiteKeys,
  availableTags,
  readerSources,
  sourceFilterSelectValue,
  sourceFilterChipLabel,
  feedAIMoreRef,
  catchUpCheckpoint,
  catchUpCount,
  catchUpLoading,
  catchUpError,
  onGenerateFeedBriefing,
  onRefreshCatchUp,
  onGenerateCatchUpBriefing,
  onMarkCaughtUp,
  onCloseFeedAIMoreMenu,
  onToggleFeedAIMoreMenu,
  onSetUnreadOnly,
  onSetFavoriteOnly,
  onToggleFeedTitleOnlyMode,
  onToggleFeedImages,
  onToggleFeedSearch,
  onApplyFilters,
  onToggleAdvancedFilters,
  onChangeKeyword,
  onChangeTagFilter,
  onChangeSourceFilter,
  onClearFilters,
  onRemoveFilter,
  formatTimeAgo,
}: ReaderFeedToolbarProps) {
  return (
    <>
      <WorkspaceToolbar className="feed-header">
        <div className="feed-header-title">
          <h2 className="sr-only">{tagFilter === 'papers' ? '论文精选' : tagFilter === 'forum' ? '论坛观察' : '聚合流'}</h2>
          <p className="hint">{tagFilter === 'papers' ? 'Hugging Face 日榜与周榜去重 · 每日约 4 篇 · 方法、证据与局限 · 洛杉矶时间每天 08:00 生成' : tagFilter === 'forum' ? '过去 24 小时发布 · 至少 20 条回复 · 按回复量排序；热度不代表信息质量' : '资讯与论坛分开阅读'}</p>
          <div className="feed-channel-tabs workspace-tabs" role="group" aria-label="阅读频道">
            <Button size="sm" variant={!['forum','papers'].includes(tagFilter) ? 'default' : 'ghost'} aria-pressed={!['forum','papers'].includes(tagFilter)} onClick={() => onApplyFilters('news')}>资讯</Button>
            <Button size="sm" variant={tagFilter === 'forum' ? 'default' : 'ghost'} aria-pressed={tagFilter === 'forum'} onClick={() => onApplyFilters('forum')}>论坛观察</Button>
            <Button size="sm" variant={tagFilter === 'papers' ? 'default' : 'ghost'} aria-pressed={tagFilter === 'papers'} onClick={() => {onApplyFilters('papers'); void onGenerateFeedBriefing(false,false,true)}}>论文精选</Button>
          </div>
        </div>
        <div className="feed-header-tools workspace-toolbar-actions">
          <div className="feed-ai-actions">
            {sourceControl}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={loadingFeedBriefing ? '生成中...' : tagFilter === 'papers' ? '今日论文精选' : tagFilter === 'forum' ? '论坛讨论简报' : 'AI 速览'}
              title={tagFilter === 'papers' ? '打开今日论文精选' : tagFilter === 'forum' ? '生成论坛讨论简报' : '生成 AI 速览'}
              onClick={() => {
                onCloseFeedAIMoreMenu()
                void onGenerateFeedBriefing(false, tagFilter === 'forum')
              }}
              disabled={loadingFeedBriefing}
            >
              <Sparkles aria-hidden="true" />
              <span className="feed-ai-label">{loadingFeedBriefing ? '生成中...' : tagFilter === 'papers' ? '论文精选' : tagFilter === 'forum' ? '论坛简报' : 'AI 速览'}</span>
              <span className="feed-ai-compact-label" aria-hidden="true">{loadingFeedBriefing ? '生成中' : '简报'}</span>
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label={showFeedSearch ? '收起搜索与筛选' : '打开搜索与筛选'} title="搜索与筛选" aria-expanded={showFeedSearch} onClick={onToggleFeedSearch}>
              <Search aria-hidden="true" />
            </Button>
            <div ref={feedAIMoreRef} className="feed-ai-more">
              <DropdownMenu
                open={showFeedAIMoreMenu}
                onOpenChange={(open) => {
                  if (open) {
                    if (!showFeedAIMoreMenu) {
                      onToggleFeedAIMoreMenu()
                    }
                    return
                  }
                  onCloseFeedAIMoreMenu()
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" aria-expanded={showFeedAIMoreMenu}>
                    <MoreHorizontal aria-hidden="true" />
                    <span className="sr-only">更多</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="feed-ai-more-menu" aria-label="阅读流更多操作">
                  <DropdownMenuLabel>阅读状态</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={favoriteOnly ? 'favorite' : unreadOnly ? 'unread' : 'all'} onValueChange={(value) => {
                    onSetUnreadOnly(value === 'unread')
                    onSetFavoriteOnly(value === 'favorite')
                  }}>
                    <DropdownMenuRadioItem className="feed-ai-more-item" value="all">全部阅读状态</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem className="feed-ai-more-item" value="unread">未读 {unreadVisibleCount}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem className="feed-ai-more-item" value="favorite">收藏 {favoriteVisibleCount}</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  {!['forum','papers'].includes(tagFilter) && <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>资讯范围</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={feedMode} onValueChange={(value) => onChangeFeedMode(value as 'all' | 'important')}>
                      <DropdownMenuRadioItem className="feed-ai-more-item" value="all">全部资讯</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem className="feed-ai-more-item" value="important">重点阅读</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                    <DropdownMenuLabel>{catchUpError ? '新增检查暂不可用' : catchUpLoading ? '正在检查新增内容…' : `上次处理后新增 ${catchUpCount} 篇`}</DropdownMenuLabel>
                    <DropdownMenuItem className="feed-ai-more-item" disabled={catchUpLoading} onSelect={() => void onRefreshCatchUp()}>重新检查新增内容</DropdownMenuItem>
                    {catchUpCount > 0 && !catchUpError && <DropdownMenuItem className="feed-ai-more-item" disabled={catchUpLoading || loadingFeedBriefing} onSelect={() => void onGenerateCatchUpBriefing()}>补课速览（{catchUpCount} 篇新增）</DropdownMenuItem>}
                    {catchUpCount > 0 && !catchUpError && <DropdownMenuItem className="feed-ai-more-item" disabled={catchUpLoading} onSelect={onMarkCaughtUp}>标记新增为已处理</DropdownMenuItem>}
                  </>}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="feed-ai-more-item"
                    disabled={loadingFeedBriefing}
                    onSelect={(event) => {
                      event.preventDefault()
                      onCloseFeedAIMoreMenu()
                      void onGenerateFeedBriefing(true, tagFilter === 'forum')
                    }}
                  >
                    <RotateCcw aria-hidden="true" />
                    重算
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="feed-ai-more-item"
                    onSelect={(event) => {
                      event.preventDefault()
                      onCloseFeedAIMoreMenu()
                      onToggleFeedSearch()
                    }}
                  >
                    {showFeedSearch ? '收起搜索与筛选' : '打开搜索与筛选'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="feed-ai-more-item"
                    onSelect={(event) => {
                      event.preventDefault()
                      onCloseFeedAIMoreMenu()
                      onToggleFeedTitleOnlyMode()
                    }}
                  >
                    {feedTitleOnlyMode ? '切换到标准模式' : '切换到仅标题'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="feed-ai-more-item"
                    disabled={feedTitleOnlyMode}
                    onSelect={(event) => {
                      event.preventDefault()
                      onCloseFeedAIMoreMenu()
                      if (feedTitleOnlyMode) return
                      onToggleFeedImages()
                    }}
                  >
                    {feedTitleOnlyMode ? '仅标题模式下不可显示图片' : showFeedImages ? '关闭图片' : '显示图片'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        <div className="feed-view-controls">
          <div className="feed-priority-toggle" role="group" aria-label="阅读重点">
            {!['forum','papers'].includes(tagFilter) && (['important', 'all'] as const).map((mode) => <Button key={mode} type="button" size="sm" variant={feedMode === mode ? 'default' : 'ghost'} aria-pressed={feedMode === mode} onClick={() => onChangeFeedMode(mode)}>{mode === 'important' ? '重点' : '全部'}</Button>)}
          </div>
          <Select
            className="feed-read-select"
            aria-label="文章可见范围"
            value={favoriteOnly ? 'favorite' : unreadOnly ? 'unread' : 'all'}
            onChange={(event) => {
              onSetUnreadOnly(event.target.value === 'unread')
              onSetFavoriteOnly(event.target.value === 'favorite')
            }}
          >
            <option value="all">全部阅读状态</option>
            <option value="unread">未读 {unreadVisibleCount}</option>
            <option value="favorite">收藏 {favoriteVisibleCount}</option>
          </Select>
        </div>
      </WorkspaceToolbar>

      {(unreadOnly || favoriteOnly || (feedMode === 'important' && !['forum','papers'].includes(tagFilter))) && <div className="feed-active-reading-filter">
        {feedMode === 'important' && !['forum','papers'].includes(tagFilter) && <button type="button" className="chip" onClick={() => onChangeFeedMode('all')}>重点阅读 ×</button>}
        {(unreadOnly || favoriteOnly) && <button type="button" className="chip" onClick={() => { onSetUnreadOnly(false); onSetFavoriteOnly(false) }}>{favoriteOnly ? '仅收藏' : '仅未读'} ×</button>}
      </div>}

      {feedMode === 'important' && <p className="feed-highlight-hint">来自最近 72 小时 AI 速览的优先阅读推荐 · 最多 15 条，每源最多 3 条 · 未生成速览的来源可能未覆盖</p>}

      {!['forum','papers'].includes(tagFilter) && (catchUpCount > 0 || catchUpError) && <div className={cn('feed-catch-up', catchUpError && 'is-error')}>
        <div className="feed-catch-up-status">
          <Clock3 aria-hidden="true" />
          <span>
            {catchUpLoading
              ? '正在检查新增内容...'
              : catchUpError
                ? '补课状态暂不可用'
                : catchUpCount > 0
                  ? `上次处理后新增 ${catchUpCount} 篇`
                  : `已处理至 ${formatTimeAgo(catchUpCheckpoint)}`}
          </span>
        </div>
        <div className="feed-catch-up-actions">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="重新检查补课内容"
            title="重新检查"
            disabled={catchUpLoading}
            onClick={() => void onRefreshCatchUp()}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
          {catchUpCount > 0 && !catchUpError && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="生成补课速览"
                title="生成补课速览（最多选取最新 30 篇）"
                disabled={catchUpLoading || loadingFeedBriefing}
                onClick={() => void onGenerateCatchUpBriefing()}
              >
                <Sparkles aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="处理完成" title="标记为处理完成" disabled={catchUpLoading} onClick={onMarkCaughtUp}>
                <Check aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </div>}

      <div className="feed-filter-toggle-row">
        <Button type="button" variant={showFeedSearch || hasActiveFilters ? 'outline' : 'ghost'} size="sm" onClick={onToggleFeedSearch}>
          <Search aria-hidden="true" />
          {showFeedSearch ? '收起搜索与筛选' : hasActiveFilters ? '搜索与筛选（已启用）' : '搜索与筛选'}
        </Button>
        {hasActiveFilters && !showFeedSearch && <p className="hint">已启用筛选，点击可快速调整。</p>}
      </div>

      {(showFeedSearch || hasActiveFilters) && (
        <Suspense fallback={null}>
          <ReaderFeedFilters
            showFeedSearch={showFeedSearch}
            showAdvancedFilters={showAdvancedFilters}
            compact={showFloatingReader && readerView === 'stream'}
            keyword={keyword}
            tagFilter={tagFilter}
            sourceFilter={sourceFilter}
            mutedSiteKeys={mutedSiteKeys}
            availableTags={availableTags}
            readerSources={readerSources}
            sourceFilterSelectValue={sourceFilterSelectValue}
            sourceFilterChipLabel={sourceFilterChipLabel}
            onApplyFilters={() => onApplyFilters()}
            onToggleAdvancedFilters={onToggleAdvancedFilters}
            onChangeKeyword={onChangeKeyword}
            onChangeTagFilter={onChangeTagFilter}
            onChangeSourceFilter={onChangeSourceFilter}
            onClearFilters={onClearFilters}
            onRemoveFilter={onRemoveFilter}
            unreadOnly={unreadOnly}
            favoriteOnly={favoriteOnly}
          />
        </Suspense>
      )}

      <p className="feed-shortcuts">快捷键: `j` / `k` 切换，`o` 打开原文，`esc` 关闭浮窗</p>
    </>
  )
}
