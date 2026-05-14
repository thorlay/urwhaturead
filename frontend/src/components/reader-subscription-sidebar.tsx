import { memo, useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { resolveSourceSiteKey } from '../lib/app-utils'
import type { Source } from '../types'

export type SidebarTagFilterMode = 'or' | 'and'

type SidebarSourceGroup = {
  key: string
  label: string
  sources: Source[]
}

type SidebarSiteGroup = {
  key: string
  label: string
  sources: Source[]
  newCount: number
  clickTotal: number
}

export type ReaderSubscriptionSidebarProps = {
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
  sourceGroupFilterKey: string
  isSourceGroupFilterActive: boolean
  readerTrackedSources: Source[]
  showTrackedSidebar: boolean
  visibleTrackedSidebarSources: Source[]
  hasMoreTrackedSidebarSources: boolean
  showAllTrackedSidebar: boolean
  onToggleSubscriptionSidebar: () => void
  onApplySourceFilterFromSidebar: (sourceID: string, options?: { preserveSidebarTags?: boolean }) => void
  onApplySourceGroupFilterFromSidebar: (group: { key: string; label: string; sourceIDs: number[] }) => void
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

function sourceNewCount(source: Source): number {
  return source.new_articles_24h ?? 0
}

function sourceClickCount(source: Source): number {
  return source.click_count ?? 0
}

function parseSourceIDSet(value: string): Set<number> {
  return new Set(
    value
      .split(',')
      .map((item) => Number.parseInt(item.trim(), 10))
      .filter((item) => Number.isInteger(item) && item > 0),
  )
}

function sameSourceIDSet(selectedIDs: Set<number>, sources: Source[]): boolean {
  if (selectedIDs.size !== sources.length) return false
  return sources.every((source) => selectedIDs.has(source.id))
}

type SubscriptionSourceRowProps = {
  source: Source
  active: boolean
  registerRef?: (sourceID: number, node: HTMLDivElement | null) => void
  onApplySourceFilterFromSidebar: (sourceID: string, options?: { preserveSidebarTags?: boolean }) => void
  onOpenSourceContextMenu: (event: ReactMouseEvent<HTMLElement>, source: Source) => void
  onOpenSourceContextMenuAt: (source: Source, x: number, y: number) => void
}

const SubscriptionSourceRow = memo(function SubscriptionSourceRow(props: SubscriptionSourceRowProps) {
  const {
    source,
    active,
    registerRef,
    onApplySourceFilterFromSidebar,
    onOpenSourceContextMenu,
    onOpenSourceContextMenuAt,
  } = props

  const handleSelect = useCallback(() => {
    onApplySourceFilterFromSidebar(String(source.id), { preserveSidebarTags: true })
  }, [onApplySourceFilterFromSidebar, source.id])

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      onOpenSourceContextMenu(event, source)
    },
    [onOpenSourceContextMenu, source],
  )

  const handleOpenMore = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      onOpenSourceContextMenuAt(source, rect.left + rect.width / 2, rect.bottom + 8)
    },
    [onOpenSourceContextMenuAt, source],
  )

  const rowContent = (
    <div className="subscription-item-row-main">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={`subscription-item ${active ? 'active' : ''}`}
        onClick={handleSelect}
        onContextMenu={handleContextMenu}
      >
        <span className="subscription-item-name">{source.name}</span>
        {(source.new_articles_24h ?? 0) > 0 && (
          <span className="subscription-item-state fresh">{source.new_articles_24h} / 24h</span>
        )}
        {!source.enabled && <span className="subscription-item-state disabled">停用</span>}
      </Button>
      <button
        type="button"
        className="subscription-item-more"
        aria-label={`更多操作：${source.name}`}
        onClick={handleOpenMore}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
    </div>
  )

  if (registerRef) {
    return (
      <div ref={(node) => registerRef(source.id, node)} className="subscription-item-row">
        {rowContent}
      </div>
    )
  }

  return rowContent
})

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
    sourceGroupFilterKey,
    isSourceGroupFilterActive,
    readerTrackedSources,
    showTrackedSidebar,
    visibleTrackedSidebarSources,
    hasMoreTrackedSidebarSources,
    showAllTrackedSidebar,
    onToggleSubscriptionSidebar,
    onApplySourceFilterFromSidebar,
    onApplySourceGroupFilterFromSidebar,
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

  const [expandedSiteGroups, setExpandedSiteGroups] = useState<Set<string>>(() => new Set())

  const selectedSourceIDs = useMemo(() => parseSourceIDSet(sourceFilter), [sourceFilter])

  const sidebarSiteGroups = useMemo<SidebarSiteGroup[]>(() => {
    const groupMap = new Map<string, SidebarSiteGroup>()
    for (const source of sidebarVisibleFeedSources) {
      const siteKey = resolveSourceSiteKey(source)
      const key = `site:${siteKey}`
      const bucket = groupMap.get(key)
      if (bucket) {
        bucket.sources.push(source)
        bucket.newCount += sourceNewCount(source)
        bucket.clickTotal += sourceClickCount(source)
        continue
      }
      groupMap.set(key, {
        key,
        label: siteKey,
        sources: [source],
        newCount: sourceNewCount(source),
        clickTotal: sourceClickCount(source),
      })
    }
    const groups = Array.from(groupMap.values()).map((group) => ({
      ...group,
      sources: [...group.sources].sort((left, right) => {
        const byClick = sourceClickCount(right) - sourceClickCount(left)
        if (byClick !== 0) return byClick
        const byNew = sourceNewCount(right) - sourceNewCount(left)
        if (byNew !== 0) return byNew
        return left.name.localeCompare(right.name)
      }),
    }))
    groups.sort((left, right) => {
      const byClick = right.clickTotal - left.clickTotal
      if (byClick !== 0) return byClick
      const byNew = right.newCount - left.newCount
      if (byNew !== 0) return byNew
      const byCount = right.sources.length - left.sources.length
      if (byCount !== 0) return byCount
      return left.label.localeCompare(right.label)
    })
    return groups
  }, [sidebarVisibleFeedSources])

  const toggleSiteGroup = useCallback((event: ReactMouseEvent<HTMLButtonElement>, groupKey: string) => {
    event.preventDefault()
    event.stopPropagation()
    setExpandedSiteGroups((previous) => {
      const next = new Set(previous)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }, [])

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
          {showSubscriptionSidebar ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
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
                  <div className="subscription-tag-mode" role="group" aria-label="标签匹配模式">
                    <Button
                      type="button"
                      variant={sidebarTagFilterMode === 'or' ? 'default' : 'outline'}
                      size="sm"
                      className="subscription-tag-mode-btn"
                      title="命中任意一个已选标签"
                      onClick={() => onSwitchSidebarTagFilterMode('or')}
                    >
                      任一
                    </Button>
                    <Button
                      type="button"
                      variant={sidebarTagFilterMode === 'and' ? 'default' : 'outline'}
                      size="sm"
                      className="subscription-tag-mode-btn"
                      title="必须命中所有已选标签"
                      onClick={() => onSwitchSidebarTagFilterMode('and')}
                    >
                      全部
                    </Button>
                  </div>
                  {sourceGroups.length > sidebarTagCollapseCount && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="subscription-tag-expand"
                      onClick={onToggleShowAllSidebarTags}
                    >
                      {showAllSidebarTags ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
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
                {sidebarSiteGroups.map((group) => {
                  if (group.sources.length === 1) {
                    const source = group.sources[0]
                    return (
                      <SubscriptionSourceRow
                        key={source.id}
                        source={source}
                        active={!isSourceGroupFilterActive && sourceFilter === String(source.id)}
                        registerRef={onRegisterSidebarSourceItemRef}
                        onApplySourceFilterFromSidebar={onApplySourceFilterFromSidebar}
                        onOpenSourceContextMenu={onOpenSourceContextMenu}
                        onOpenSourceContextMenuAt={onOpenSourceContextMenuAt}
                      />
                    )
                  }

                  const expanded = expandedSiteGroups.has(group.key)
                  const active = sourceGroupFilterKey === group.key || sameSourceIDSet(selectedSourceIDs, group.sources)
                  const sourceIDs = group.sources.map((source) => source.id)

                  return (
                    <section key={group.key} className="subscription-group">
                      <div className={cn('subscription-group-head', active && 'active')}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="subscription-group-title"
                          onClick={() =>
                            onApplySourceGroupFilterFromSidebar({
                              key: group.key,
                              label: group.label,
                              sourceIDs,
                            })
                          }
                        >
                          <span className="subscription-group-name">{group.label}</span>
                          <span className="subscription-group-meta">
                            {group.sources.length} 源
                            {group.newCount > 0 ? ` · ${group.newCount}/24h` : ''}
                          </span>
                        </Button>
                        <button
                          type="button"
                          className="subscription-group-toggle"
                          aria-label={`${expanded ? '收起' : '展开'} ${group.label} 的订阅源`}
                          aria-expanded={expanded}
                          onClick={(event) => toggleSiteGroup(event, group.key)}
                        >
                          {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                        </button>
                      </div>
                      {expanded && (
                        <div className="subscription-group-items">
                          {group.sources.map((source) => (
                            <SubscriptionSourceRow
                              key={source.id}
                              source={source}
                              active={!isSourceGroupFilterActive && sourceFilter === String(source.id)}
                              registerRef={onRegisterSidebarSourceItemRef}
                              onApplySourceFilterFromSidebar={onApplySourceFilterFromSidebar}
                              onOpenSourceContextMenu={onOpenSourceContextMenu}
                              onOpenSourceContextMenuAt={onOpenSourceContextMenuAt}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  )
                })}
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
                      <SubscriptionSourceRow
                        key={source.id}
                        source={source}
                        active={!isSourceGroupFilterActive && sourceFilter === String(source.id)}
                        onApplySourceFilterFromSidebar={onApplySourceFilterFromSidebar}
                        onOpenSourceContextMenu={onOpenSourceContextMenu}
                        onOpenSourceContextMenuAt={onOpenSourceContextMenuAt}
                      />
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
                      {showAllTrackedSidebar ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
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
