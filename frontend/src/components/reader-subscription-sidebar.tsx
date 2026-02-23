import type { MouseEvent as ReactMouseEvent } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Source } from '../types'

export type SidebarTagFilterMode = 'or' | 'and'

type SidebarSourceGroup = {
  key: string
  label: string
  sources: Source[]
}

type ReaderSubscriptionSidebarProps = {
  showSubscriptionSidebar: boolean
  sourceFilter: string
  readerSources: Source[]
  sourceGroups: SidebarSourceGroup[]
  sidebarTagFilterMode: SidebarTagFilterMode
  sidebarTagFilters: string[]
  sidebarTagFilterSet: Set<string>
  showAllSidebarTags: boolean
  sidebarTagCollapseCount: number
  sidebarVisibleFeedSources: Source[]
  isSourceGroupFilterActive: boolean
  readerTrackedSources: Source[]
  showTrackedSidebar: boolean
  visibleTrackedSidebarSources: Source[]
  hasMoreTrackedSidebarSources: boolean
  showAllTrackedSidebar: boolean
  onToggleSubscriptionSidebar: () => void
  onApplySourceFilterFromSidebar: (sourceID: string, options?: { preserveSidebarTags?: boolean }) => void
  onSwitchSidebarTagFilterMode: (mode: SidebarTagFilterMode) => void
  onApplySidebarTagFilters: (keys: string[]) => void
  onToggleShowAllSidebarTags: () => void
  onToggleSidebarTagFilter: (tagKey: string) => void
  onRegisterSidebarSourceItemRef: (sourceID: number, node: HTMLDivElement | null) => void
  onOpenSourceContextMenu: (event: ReactMouseEvent<HTMLElement>, source: Source) => void
  onOpenSourceContextMenuAt: (source: Source, x: number, y: number) => void
  onToggleShowTrackedSidebar: () => void
  onToggleShowAllTrackedSidebar: () => void
}

export function ReaderSubscriptionSidebar(props: ReaderSubscriptionSidebarProps) {
  const {
    showSubscriptionSidebar,
    sourceFilter,
    readerSources,
    sourceGroups,
    sidebarTagFilterMode,
    sidebarTagFilters,
    sidebarTagFilterSet,
    showAllSidebarTags,
    sidebarTagCollapseCount,
    sidebarVisibleFeedSources,
    isSourceGroupFilterActive,
    readerTrackedSources,
    showTrackedSidebar,
    visibleTrackedSidebarSources,
    hasMoreTrackedSidebarSources,
    showAllTrackedSidebar,
    onToggleSubscriptionSidebar,
    onApplySourceFilterFromSidebar,
    onSwitchSidebarTagFilterMode,
    onApplySidebarTagFilters,
    onToggleShowAllSidebarTags,
    onToggleSidebarTagFilter,
    onRegisterSidebarSourceItemRef,
    onOpenSourceContextMenu,
    onOpenSourceContextMenuAt,
    onToggleShowTrackedSidebar,
    onToggleShowAllTrackedSidebar,
  } = props

  return (
    <aside className={`panel subscription-sidebar ${showSubscriptionSidebar ? 'open' : 'collapsed'}`}>
      <div className="subscription-sidebar-header">
        {showSubscriptionSidebar && <h3>订阅源</h3>}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="subscription-sidebar-toggle"
          onClick={onToggleSubscriptionSidebar}
        >
          {showSubscriptionSidebar ? '收起' : '展开'}
        </Button>
      </div>
      {showSubscriptionSidebar && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={`subscription-item all ${!sourceFilter ? 'active' : ''}`}
            onClick={() => onApplySourceFilterFromSidebar('')}
          >
            全部来源
            <span>{readerSources.length}</span>
          </Button>

          {sourceGroups.length > 0 && (
            <>
              <div className="subscription-tag-controls">
                <span className="hint">标签匹配</span>
                <div className="subscription-tag-controls-actions">
                  <div className="subscription-tag-mode" role="group" aria-label="标签匹配模式">
                    <Button
                      type="button"
                      variant={sidebarTagFilterMode === 'or' ? 'default' : 'outline'}
                      size="sm"
                      className="subscription-tag-mode-btn"
                      onClick={() => onSwitchSidebarTagFilterMode('or')}
                    >
                      OR
                    </Button>
                    <Button
                      type="button"
                      variant={sidebarTagFilterMode === 'and' ? 'default' : 'outline'}
                      size="sm"
                      className="subscription-tag-mode-btn"
                      onClick={() => onSwitchSidebarTagFilterMode('and')}
                    >
                      AND
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn('subscription-tag-clear', sidebarTagFilters.length === 0 && 'placeholder')}
                    onClick={() => onApplySidebarTagFilters([])}
                    disabled={sidebarTagFilters.length === 0}
                    aria-hidden={sidebarTagFilters.length === 0}
                  >
                    清空标签
                  </Button>
                  {sourceGroups.length > sidebarTagCollapseCount && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="subscription-tag-expand"
                      onClick={onToggleShowAllSidebarTags}
                    >
                      {showAllSidebarTags ? '收起标签' : '展开标签'}
                    </Button>
                  )}
                </div>
              </div>

              <div
                className={cn(
                  'subscription-tag-filters',
                  sourceGroups.length > sidebarTagCollapseCount && !showAllSidebarTags && 'collapsed',
                )}
              >
                {sourceGroups.map((group) => (
                  <Button
                    key={`tag-filter:${group.key}`}
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn('subscription-tag-chip', sidebarTagFilterSet.has(group.key) && 'active')}
                    onClick={() => onToggleSidebarTagFilter(group.key)}
                  >
                    {group.label}
                    <span>{group.sources.length}</span>
                  </Button>
                ))}
              </div>
            </>
          )}

          <div className="subscription-tree">
            {sidebarVisibleFeedSources.length === 0 ? (
              <p className="hint">当前标签下无来源</p>
            ) : (
              <div className="subscription-items">
                {sidebarVisibleFeedSources.map((source) => (
                  <div key={source.id} ref={(node) => onRegisterSidebarSourceItemRef(source.id, node)} className="subscription-item-row">
                    <div className="subscription-item-row-main">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={`subscription-item ${!isSourceGroupFilterActive && sourceFilter === String(source.id) ? 'active' : ''}`}
                        onClick={() => onApplySourceFilterFromSidebar(String(source.id), { preserveSidebarTags: true })}
                        onContextMenu={(event) => onOpenSourceContextMenu(event, source)}
                      >
                        <span className="subscription-item-name">{source.name}</span>
                        {!source.enabled && <span className="subscription-item-state disabled">停用</span>}
                      </Button>
                      <button
                        type="button"
                        className="subscription-item-more"
                        aria-label={`更多操作：${source.name}`}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          const rect = event.currentTarget.getBoundingClientRect()
                          onOpenSourceContextMenuAt(source, rect.left + rect.width / 2, rect.bottom + 8)
                        }}
                      >
                        ⋯
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {readerTrackedSources.length > 0 && (
            <section className="tracked-thread-section">
              <div className="tracked-thread-head">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn('tracked-thread-toggle', showTrackedSidebar && 'active')}
                  onClick={onToggleShowTrackedSidebar}
                >
                  跟踪帖子
                </Button>
                <span>{readerTrackedSources.length}</span>
              </div>
              {showTrackedSidebar && (
                <div className="tracked-thread-body">
                  <div className="subscription-items tracked-thread-items">
                    {visibleTrackedSidebarSources.map((source) => (
                      <div key={source.id} className="subscription-item-row-main">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={`subscription-item ${!isSourceGroupFilterActive && sourceFilter === String(source.id) ? 'active' : ''}`}
                          onClick={() => onApplySourceFilterFromSidebar(String(source.id), { preserveSidebarTags: true })}
                          onContextMenu={(event) => onOpenSourceContextMenu(event, source)}
                        >
                          <span className="subscription-item-name">{source.name}</span>
                          {!source.enabled && <span className="subscription-item-state disabled">停用</span>}
                        </Button>
                        <button
                          type="button"
                          className="subscription-item-more"
                          aria-label={`更多操作：${source.name}`}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            const rect = event.currentTarget.getBoundingClientRect()
                            onOpenSourceContextMenuAt(source, rect.left + rect.width / 2, rect.bottom + 8)
                          }}
                        >
                          ⋯
                        </button>
                      </div>
                    ))}
                  </div>
                  {hasMoreTrackedSidebarSources && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="tracked-thread-more"
                      onClick={onToggleShowAllTrackedSidebar}
                    >
                      {showAllTrackedSidebar ? '仅显示 Top 10' : `显示全部 (${readerTrackedSources.length})`}
                    </Button>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </aside>
  )
}
