import { useMemo, useRef, useState, type ChangeEvent, type FormEvent, type RefObject } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type {
  BatchCreateResult,
  BulkSourceAction,
  SourceHealthFilter,
  SourceQuickView,
  SourceSortKey,
} from '../hooks/use-source-management-state'
import type { DiscoverSourceCandidate, Source, SourceStatus } from '../types'

type SourceManagementPanelProps = {
  aiModel: string
  aiModelOptions: string[]
  showManageModelPicker: boolean
  onToggleManageModelPicker: () => void
  onChangeAIModel: (nextModel: string) => void
  sources: Source[]
  enabledSourceCount: number
  unhealthySourceCount: number
  mutedSiteKeys: string[]
  sourceHealthCounts: Record<SourceStatus['health'], number>
  healthToneClass: (health: SourceStatus['health']) => string
  loadingStatus: boolean
  onLoadStatus: () => Promise<void>
  reclassifyingSources: boolean
  onReclassifySources: () => Promise<void>
  sourceManageKeyword: string
  onSetSourceManageKeyword: (value: string) => void
  sourceManageTagFilter: string
  onSetSourceManageTagFilter: (value: string) => void
  sourceManageHealthFilter: SourceHealthFilter
  onSetSourceManageHealthFilter: (value: SourceHealthFilter) => void
  sourceManageQuickView: SourceQuickView
  onSetSourceManageQuickView: (value: SourceQuickView) => void
  sourceManageSortKey: SourceSortKey
  onSetSourceManageSortKey: (value: SourceSortKey) => void
  sourceManageSortDesc: boolean
  onSetSourceManageSortDesc: (value: boolean) => void
  availableTags: string[]
  onClearSourceManageFilters: () => void
  loadingSources: boolean
  onLoadSources: () => Promise<void>
  selectedSourceIDs: number[]
  visibleSourceIDs: number[]
  bulkTagInput: string
  onSetBulkTagInput: (value: string) => void
  bulkPollSec: string
  onSetBulkPollSec: (value: string) => void
  bulkSourceAction: BulkSourceAction | null
  hasSelectedSources: boolean
  onRunBulkTagAction: (action: 'add' | 'remove') => Promise<void>
  onRunBulkPollIntervalUpdate: () => Promise<void>
  onRunBulkAIBriefingAction: (enabled: boolean, intervalMin?: number) => Promise<void>
  onRunBulkSourceAction: (action: 'enable' | 'disable' | 'refresh' | 'test') => Promise<void>
  onClearSelectedSourceIDs: () => void
  sourcesError: string | null
  statusError: string | null
  sourceSelectAllRef: RefObject<HTMLInputElement | null>
  allVisibleSelected: boolean
  onToggleSelectAllVisibleSources: (nextSelected: boolean) => void
  filteredSources: Source[]
  sourceStatusMap: Map<number, SourceStatus>
  resolveSourceHealth: (
    source: Pick<Source, 'id' | 'enabled'>,
    statusMap: Map<number, SourceStatus>,
  ) => SourceStatus['health']
  sourceSiteKeyMap: Map<number, string>
  resolveSourceSiteKey: (source: Pick<Source, 'site_key' | 'rss_url'>) => string
  busySourceID: number | null
  editingSourceID: number | null
  selectedSourceIDSet: Set<number>
  onToggleSourceSelection: (sourceID: number) => void
  editSourceName: string
  onSetEditSourceName: (value: string) => void
  editSourceTags: string
  onSetEditSourceTags: (value: string) => void
  editSourcePollSec: string
  onSetEditSourcePollSec: (value: string) => void
  editSourceURL: string
  onSetEditSourceURL: (value: string) => void
  sourceTagList: (source: Pick<Source, 'tags'>) => string[]
  normalizeSourceKind: (kind?: string) => 'feed' | 'thread'
  sourceClickCount: (source: Pick<Source, 'click_count'>) => number
  formatTimeAgo: (input: string) => string
  healthLabel: (health: SourceStatus['health']) => string
  onSaveSourceEdit: (sourceID: number) => Promise<void>
  onCancelEdit: () => void
  onTestSource: (sourceID: number) => Promise<void>
  onRefreshSource: (sourceID: number) => Promise<void>
  onStartEdit: (source: Source) => void
  onToggleSourceEnabled: (source: Source) => Promise<void>
  onToggleSiteMuted: (siteKey: string) => void
  mutedSiteSet: Set<string>
  onDeleteSource: (source: Source) => Promise<void>
  newSourceName: string
  onSetNewSourceName: (value: string) => void
  newSourceURL: string
  onSetNewSourceURL: (value: string) => void
  newSourceTags: string
  onSetNewSourceTags: (value: string) => void
  creatingSource: boolean
  onCreateSource: (event: FormEvent<HTMLFormElement>) => Promise<void>
  exportingSources: boolean
  importingSources: boolean
  onExportSources: () => Promise<void>
  onImportSourcesFile: (file: File) => Promise<void>
  batchSourceURLs: string
  onSetBatchSourceURLs: (value: string) => void
  batchSourceTags: string
  onSetBatchSourceTags: (value: string) => void
  batchCreatingSources: boolean
  onBatchCreateSources: (event: FormEvent<HTMLFormElement>) => Promise<void>
  batchCreateResult: BatchCreateResult | null
  discoverURL: string
  onSetDiscoverURL: (value: string) => void
  discoveringSources: boolean
  onDiscoverSources: (event: FormEvent<HTMLFormElement>) => Promise<void>
  discoveredSources: DiscoverSourceCandidate[]
  confidenceLabel: (confidence: DiscoverSourceCandidate['confidence']) => string
  onAddDiscoveredSource: (candidate: DiscoverSourceCandidate) => Promise<void>
}

export type SourceManagementPanelController = SourceManagementPanelProps

type SourceManagementPanelContainerProps = {
  controller: SourceManagementPanelController
}

export function SourceManagementPanel({ controller }: SourceManagementPanelContainerProps) {
  const {
    aiModel,
    aiModelOptions,
    showManageModelPicker,
    onToggleManageModelPicker,
    onChangeAIModel,
    sources,
    enabledSourceCount,
    unhealthySourceCount,
    mutedSiteKeys,
    sourceHealthCounts,
    healthToneClass,
    loadingStatus,
    onLoadStatus,
    reclassifyingSources,
    onReclassifySources,
    sourceManageKeyword,
    onSetSourceManageKeyword,
    sourceManageTagFilter,
    onSetSourceManageTagFilter,
    sourceManageHealthFilter,
    onSetSourceManageHealthFilter,
    sourceManageQuickView,
    onSetSourceManageQuickView,
    sourceManageSortKey,
    onSetSourceManageSortKey,
    sourceManageSortDesc,
    onSetSourceManageSortDesc,
    availableTags,
    onClearSourceManageFilters,
    loadingSources,
    onLoadSources,
    selectedSourceIDs,
    visibleSourceIDs,
    bulkTagInput,
    onSetBulkTagInput,
    bulkPollSec,
    onSetBulkPollSec,
    bulkSourceAction,
    hasSelectedSources,
    onRunBulkTagAction,
    onRunBulkPollIntervalUpdate,
    onRunBulkAIBriefingAction,
    onRunBulkSourceAction,
    onClearSelectedSourceIDs,
    sourcesError,
    statusError,
    sourceSelectAllRef,
    allVisibleSelected,
    onToggleSelectAllVisibleSources,
    filteredSources,
    sourceStatusMap,
    resolveSourceHealth,
    sourceSiteKeyMap,
    resolveSourceSiteKey,
    busySourceID,
    editingSourceID,
    selectedSourceIDSet,
    onToggleSourceSelection,
    editSourceName,
    onSetEditSourceName,
    editSourceTags,
    onSetEditSourceTags,
    editSourcePollSec,
    onSetEditSourcePollSec,
    editSourceURL,
    onSetEditSourceURL,
    sourceTagList,
    normalizeSourceKind,
    sourceClickCount,
    formatTimeAgo,
    healthLabel,
    onSaveSourceEdit,
    onCancelEdit,
    onTestSource,
    onRefreshSource,
    onStartEdit,
    onToggleSourceEnabled,
    onToggleSiteMuted,
    mutedSiteSet,
    onDeleteSource,
    newSourceName,
    onSetNewSourceName,
    newSourceURL,
    onSetNewSourceURL,
    newSourceTags,
    onSetNewSourceTags,
    creatingSource,
    onCreateSource,
    exportingSources,
    importingSources,
    onExportSources,
    onImportSourcesFile,
    batchSourceURLs,
    onSetBatchSourceURLs,
    batchSourceTags,
    onSetBatchSourceTags,
    batchCreatingSources,
    onBatchCreateSources,
    batchCreateResult,
    discoverURL,
    onSetDiscoverURL,
    discoveringSources,
    onDiscoverSources,
    discoveredSources,
    confidenceLabel,
    onAddDiscoveredSource,
  } = controller
  const importFileInputRef = useRef<HTMLInputElement | null>(null)
  const [manageTab, setManageTab] = useState<'sources' | 'status'>('sources')
  const [densityMode, setDensityMode] = useState<'compact' | 'standard' | 'detailed'>('standard')

  function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    void onImportSourcesFile(file)
  }

  const failingSourceHighlights = useMemo(() => {
    const highlights: Array<{
      sourceID: number
      name: string
      httpStatus?: number
      reason: string
    }> = []

    for (const source of sources) {
      const status = sourceStatusMap.get(source.id)
      if (!status || !source.enabled) {
        continue
      }
      const health = resolveSourceHealth(source, sourceStatusMap)
      if (health !== 'error' && health !== 'warn' && health !== 'stale') {
        continue
      }

      const rawReason = (status.last_error ?? '').trim()
      const reason = rawReason.length > 120 ? `${rawReason.slice(0, 120)}...` : rawReason
      if (reason || typeof status.latest_http_status === 'number') {
        highlights.push({
          sourceID: source.id,
          name: source.name,
          httpStatus: status.latest_http_status,
          reason: reason || '抓取状态异常',
        })
      }
    }

    return highlights.slice(0, 4)
  }, [resolveSourceHealth, sourceStatusMap, sources])

  const quickViewCounts = useMemo(() => {
    const counts: Record<SourceQuickView, number> = {
      all: sources.length,
      attention: 0,
      ai: 0,
      disabled: 0,
      thread: 0,
      active: 0,
    }
    for (const source of sources) {
      const health = resolveSourceHealth(source, sourceStatusMap)
      if (health === 'error' || health === 'warn' || health === 'stale') counts.attention += 1
      if (source.ai_briefing_enabled) counts.ai += 1
      if (!source.enabled) counts.disabled += 1
      if (source.kind === 'thread') counts.thread += 1
      if ((source.new_articles_24h ?? 0) >= 5) counts.active += 1
    }
    return counts
  }, [resolveSourceHealth, sourceStatusMap, sources])

  const statusAdvice = useMemo(() => {
    return filteredSources
      .map((source) => {
        const status = sourceStatusMap.get(source.id)
        const health = resolveSourceHealth(source, sourceStatusMap)
        if (status?.latest_http_status === 429) {
          return { source, text: '抓到 HTTP 429，建议拉长抓取间隔或改用更稳的源。' }
        }
        if (health === 'stale') {
          return { source, text: '长时间无新内容，建议检查源是否失效或降低优先级。' }
        }
        if (source.ai_briefing_enabled && (source.new_articles_24h ?? 0) < 3) {
          return { source, text: 'AI 速览开启但最近新增偏少，建议改成更长间隔。' }
        }
        if ((source.new_articles_24h ?? 0) >= 12 && sourceClickCount(source) <= 1) {
          return { source, text: '更新很多但点击很少，可以考虑降权、隐藏或改标签。' }
        }
        return null
      })
      .filter((item): item is { source: Source; text: string } => Boolean(item))
      .slice(0, 8)
  }, [filteredSources, resolveSourceHealth, sourceClickCount, sourceStatusMap])

  const aiEnabledSources = useMemo(
    () => filteredSources.filter((source) => source.ai_briefing_enabled).slice(0, 10),
    [filteredSources],
  )

  const quickViews: Array<{ key: SourceQuickView; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'attention', label: '抓取异常' },
    { key: 'ai', label: '已开 AI 速览' },
    { key: 'disabled', label: '已停用' },
    { key: 'thread', label: '跟踪帖' },
    { key: 'active', label: '最近新增多' },
  ]

  return (
    <main className="source-management-page">
      <section className="panel sources source-manage-panel">
        <div className="source-manage-head">
          <div>
            <h2>来源管理</h2>
            <p className="hint">高频操作集中在一张表内，支持筛选、批量与单条快速处理。</p>
          </div>
          <div className="source-manage-head-actions">
            <div className="source-health-overview">
              <Badge variant="outline">总数 {sources.length}</Badge>
              <Badge variant="outline">启用 {enabledSourceCount}</Badge>
              <Badge variant="outline">异常 {unhealthySourceCount}</Badge>
              <Badge variant="outline">隐藏站点 {mutedSiteKeys.length}</Badge>
              <Badge className={cn('health-badge', healthToneClass('error'))} variant="outline">
                错误 {sourceHealthCounts.error}
              </Badge>
              <Badge className={cn('health-badge', healthToneClass('warn'))} variant="outline">
                警告 {sourceHealthCounts.warn}
              </Badge>
              <Badge className={cn('health-badge', healthToneClass('stale'))} variant="outline">
                陈旧 {sourceHealthCounts.stale}
              </Badge>
            </div>
            <div className="manage-model-entry">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="manage-model-button"
                onClick={onToggleManageModelPicker}
              >
                模型：{aiModel}
              </Button>
              {showManageModelPicker && (
                <div className="manage-model-panel">
                  <Select value={aiModel} onChange={(event) => onChangeAIModel(event.target.value)}>
                    {aiModelOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                    {!aiModelOptions.includes(aiModel) && (
                      <option value={aiModel}>
                        {aiModel}
                      </option>
                    )}
                  </Select>
                </div>
              )}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void onLoadStatus()} disabled={loadingStatus}>
              {loadingStatus ? '更新状态中...' : '更新状态'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onReclassifySources()}
              disabled={reclassifyingSources}
            >
              {reclassifyingSources ? '重分类中...' : '自动重分类'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onExportSources()}
              disabled={exportingSources || importingSources}
            >
              {exportingSources ? '导出中...' : '导出来源 JSON'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => importFileInputRef.current?.click()}
              disabled={importingSources || exportingSources}
            >
              {importingSources ? '导入中...' : '导入来源 JSON'}
            </Button>
            <input
              ref={importFileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleImportFileChange}
            />
          </div>
        </div>

        <div className="source-manage-nav" role="tablist" aria-label="管理页面视图">
          <Button
            type="button"
            variant={manageTab === 'sources' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setManageTab('sources')}
          >
            来源管理
          </Button>
          <Button
            type="button"
            variant={manageTab === 'status' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setManageTab('status')}
          >
            运行状态
          </Button>
        </div>

        <div className="source-toolbar">
          <Input
            value={sourceManageKeyword}
            onChange={(event) => onSetSourceManageKeyword(event.target.value)}
            placeholder="搜索名称 / URL / 标签 / 站点"
          />
          <Select
            value={sourceManageTagFilter}
            onChange={(event) => onSetSourceManageTagFilter(event.target.value)}
          >
            <option value="">全部标签</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </Select>
          <Select
            value={sourceManageHealthFilter}
            onChange={(event) => onSetSourceManageHealthFilter(event.target.value as SourceHealthFilter)}
          >
            <option value="all">全部健康状态</option>
            <option value="error">错误</option>
            <option value="warn">警告</option>
            <option value="stale">陈旧</option>
            <option value="ok">健康</option>
            <option value="disabled">停用</option>
            <option value="new">新来源</option>
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={onClearSourceManageFilters}>
            清空筛选
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void onLoadSources()} disabled={loadingSources}>
            {loadingSources ? '更新列表中...' : '更新来源列表'}
          </Button>
        </div>

        <div className="source-quickviews">
          {quickViews.map((view) => (
            <Button
              key={view.key}
              type="button"
              size="sm"
              variant={sourceManageQuickView === view.key ? 'secondary' : 'outline'}
              onClick={() => onSetSourceManageQuickView(view.key)}
            >
              {view.label} {quickViewCounts[view.key]}
            </Button>
          ))}
          <div className="source-toolbar-inline-group">
            <Select value={sourceManageSortKey} onChange={(event) => onSetSourceManageSortKey(event.target.value as SourceSortKey)}>
              <option value="health">按风险优先</option>
              <option value="new_articles">按 24h 新增</option>
              <option value="clicks">按总点击</option>
              <option value="last_fetched">按最近抓取</option>
              <option value="last_clicked">按最近点击</option>
              <option value="ai_generated">按 AI 最近生成</option>
              <option value="name">按名称</option>
            </Select>
            <Button type="button" variant="outline" size="sm" onClick={() => onSetSourceManageSortDesc(!sourceManageSortDesc)}>
              {sourceManageSortDesc ? '降序' : '升序'}
            </Button>
            <Select value={densityMode} onChange={(event) => setDensityMode(event.target.value as 'compact' | 'standard' | 'detailed')}>
              <option value="compact">紧凑</option>
              <option value="standard">标准</option>
              <option value="detailed">详细</option>
            </Select>
          </div>
        </div>

        <div className="source-bulkbar">
          <p className="hint">
            已选 {selectedSourceIDs.length} / 当前筛选 {visibleSourceIDs.length} / 全部 {sources.length}
          </p>
          <div className="source-bulk-actions">
            <Input
              value={bulkTagInput}
              onChange={(event) => onSetBulkTagInput(event.target.value)}
              className="source-bulk-tag-input"
              placeholder="批量标签: tech, forum"
              disabled={bulkSourceAction !== null}
            />
            <Input
              value={bulkPollSec}
              onChange={(event) => onSetBulkPollSec(event.target.value)}
              className="source-bulk-poll-input"
              placeholder="抓取间隔秒，例如 1800"
              disabled={bulkSourceAction !== null}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onRunBulkTagAction('add')}
              disabled={!hasSelectedSources || bulkSourceAction !== null}
            >
              {bulkSourceAction === 'add_tags' ? '添加中...' : '批量加标签'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onRunBulkTagAction('remove')}
              disabled={!hasSelectedSources || bulkSourceAction !== null}
            >
              {bulkSourceAction === 'remove_tags' ? '移除中...' : '批量移除标签'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onRunBulkPollIntervalUpdate()}
              disabled={!hasSelectedSources || bulkSourceAction !== null}
            >
              {bulkSourceAction === 'set_poll' ? '批量更新中...' : '批量改抓取间隔'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onRunBulkAIBriefingAction(true, 60)}
              disabled={!hasSelectedSources || bulkSourceAction !== null}
            >
              {bulkSourceAction === 'enable_ai' ? '批量开启中...' : '批量开 1h AI'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onRunBulkAIBriefingAction(true, 180)}
              disabled={!hasSelectedSources || bulkSourceAction !== null}
            >
              {bulkSourceAction === 'enable_ai' ? '批量开启中...' : '批量开 3h AI'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onRunBulkAIBriefingAction(false)}
              disabled={!hasSelectedSources || bulkSourceAction !== null}
            >
              {bulkSourceAction === 'disable_ai' ? '批量关闭中...' : '批量关 AI'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onRunBulkSourceAction('enable')}
              disabled={!hasSelectedSources || bulkSourceAction !== null}
            >
              {bulkSourceAction === 'enable' ? '批量启用中...' : '批量启用'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onRunBulkSourceAction('disable')}
              disabled={!hasSelectedSources || bulkSourceAction !== null}
            >
              {bulkSourceAction === 'disable' ? '批量停用中...' : '批量停用'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onRunBulkSourceAction('refresh')}
              disabled={!hasSelectedSources || bulkSourceAction !== null}
            >
              {bulkSourceAction === 'refresh' ? '批量强制刷新中...' : '批量强制刷新'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onRunBulkSourceAction('test')}
              disabled={!hasSelectedSources || bulkSourceAction !== null}
            >
              {bulkSourceAction === 'test' ? '批量测试中...' : '批量测试'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearSelectedSourceIDs}
              disabled={!hasSelectedSources || bulkSourceAction !== null}
            >
              清空勾选
            </Button>
          </div>
        </div>

        {sourcesError && (
          <div className="inline-error">
            <span>来源加载失败: {sourcesError}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void onLoadSources()}>
              重试
            </Button>
          </div>
        )}

        {statusError && (
          <div className="inline-error">
            <span>状态加载失败: {statusError}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void onLoadStatus()}>
              重试
            </Button>
          </div>
        )}

        {failingSourceHighlights.length > 0 && (
          <div className="source-failure-banner" role="status" aria-live="polite">
            <div className="source-failure-banner-main">
              <p className="source-failure-title">抓取异常：{unhealthySourceCount} 个来源需要关注</p>
              <p className="source-failure-list">
                {failingSourceHighlights.map((item) => (
                  <span key={item.sourceID}>
                    {item.name}
                    {typeof item.httpStatus === 'number' ? ` (HTTP ${item.httpStatus})` : ''}：{item.reason}
                  </span>
                ))}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void onLoadStatus()} disabled={loadingStatus}>
              {loadingStatus ? '刷新中...' : '立即复查'}
            </Button>
          </div>
        )}

        {manageTab === 'status' && (
          <section className="source-status-layout">
            <div className="source-status-grid">
              <article className="source-status-card">
                <h4>抓取异常关注</h4>
                {failingSourceHighlights.length === 0 ? (
                  <p className="hint">当前没有明显异常来源。</p>
                ) : (
                  <div className="source-status-list">
                    {failingSourceHighlights.map((item) => (
                      <div key={item.sourceID} className="source-status-item">
                        <p className="source-status-item-title">
                          {item.name}
                          {typeof item.httpStatus === 'number' ? ` · HTTP ${item.httpStatus}` : ''}
                        </p>
                        <p className="source-cell-meta">{item.reason}</p>
                      </div>
                    ))}
                  </div>
                )}
              </article>

              <article className="source-status-card">
                <h4>已开启 AI 速览</h4>
                {aiEnabledSources.length === 0 ? (
                  <p className="hint">还没有来源开启定时 AI 速览。</p>
                ) : (
                  <div className="source-status-list">
                    {aiEnabledSources.map((source) => (
                      <div key={source.id} className="source-status-item">
                        <p className="source-status-item-title">
                          {source.name} · {Math.max(1, Math.round((source.ai_briefing_interval_min ?? 60) / 60))}h
                        </p>
                        <p className="source-cell-meta">
                          最近生成 {source.ai_briefing_last_generated_at ? formatTimeAgo(source.ai_briefing_last_generated_at) : '-'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </article>

              <article className="source-status-card">
                <h4>建议动作</h4>
                {statusAdvice.length === 0 ? (
                  <p className="hint">当前没有明显需要处理的来源建议。</p>
                ) : (
                  <div className="source-status-list">
                    {statusAdvice.map((item) => (
                      <div key={item.source.id} className="source-status-item">
                        <p className="source-status-item-title">{item.source.name}</p>
                        <p className="source-cell-meta">{item.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </div>
          </section>
        )}

        {manageTab === 'sources' && (
        <div className="source-table-wrap">
          {!loadingSources && sources.length === 0 && <p className="hint">暂无来源</p>}
          {!loadingSources && sources.length > 0 && filteredSources.length === 0 && <p className="hint">当前筛选下没有来源</p>}
          {sources.length > 0 && filteredSources.length > 0 && (
            <table className={cn('source-table', `source-table-${densityMode}`)}>
              <thead>
                <tr>
                  <th className="source-checkbox-col">
                    <input
                      ref={sourceSelectAllRef}
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(event) => onToggleSelectAllVisibleSources(event.target.checked)}
                      aria-label="全选当前筛选来源"
                    />
                  </th>
                  <th>ID</th>
                  <th>来源</th>
                  {densityMode !== 'compact' && <th>标签</th>}
                  <th>点击</th>
                  <th>健康状态</th>
                  {densityMode !== 'compact' && <th>抓取配置</th>}
                  {densityMode === 'detailed' && <th>RSS URL</th>}
                  <th className="source-actions-col">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredSources.map((source) => {
                  const status = sourceStatusMap.get(source.id)
                  const health = resolveSourceHealth(source, sourceStatusMap)
                  const siteKey = sourceSiteKeyMap.get(source.id) ?? resolveSourceSiteKey(source)
                  const rowBusy = busySourceID === source.id || bulkSourceAction !== null
                  const isEditing = editingSourceID === source.id
                  const hasFetchError =
                    health === 'error' ||
                    (typeof status?.latest_http_status === 'number' && status.latest_http_status >= 400) ||
                    Boolean(status?.last_error)
                  const hasFetchWarning = !hasFetchError && (health === 'warn' || health === 'stale')
                  return (
                    <tr
                      key={source.id}
                      className={cn(
                        selectedSourceIDSet.has(source.id) && 'selected',
                        hasFetchError && 'source-row-error',
                        hasFetchWarning && 'source-row-warning',
                      )}
                    >
                      <td className="source-checkbox-col">
                        <input
                          type="checkbox"
                          checked={selectedSourceIDSet.has(source.id)}
                          onChange={() => onToggleSourceSelection(source.id)}
                          aria-label={`选择来源 ${source.name}`}
                        />
                      </td>
                      <td>
                        <span className="source-id-cell">#{source.id}</span>
                      </td>
                      <td>
                        {isEditing ? (
                          <Input value={editSourceName} onChange={(event) => onSetEditSourceName(event.target.value)} />
                        ) : (
                          <div className="source-cell-main">
                            <div className="source-title-row">
                              <p className="source-title">{source.name}</p>
                              {source.ai_briefing_enabled && (
                                <Badge variant="outline">AI {Math.max(1, Math.round((source.ai_briefing_interval_min ?? 60) / 60))}h</Badge>
                              )}
                              {hasFetchError && <Badge variant="outline" className={cn('health-badge', healthToneClass('error'))}>异常</Badge>}
                            </div>
                            <p className="source-cell-meta">
                              {siteKey} · {source.enabled ? '启用' : '停用'} · {normalizeSourceKind(source.kind) === 'thread' ? '跟踪帖' : '订阅源'}
                            </p>
                          </div>
                        )}
                      </td>
                      {densityMode !== 'compact' && <td>
                        {isEditing ? (
                          <Input
                            value={editSourceTags}
                            onChange={(event) => onSetEditSourceTags(event.target.value)}
                            placeholder="tech, ai, startup"
                          />
                        ) : (
                          <div className="source-tag-list">
                            {sourceTagList(source).map((tag) => (
                              <Badge
                                key={`${source.id}-${tag}`}
                                variant="outline"
                                className="source-tag-badge"
                                onClick={() => onSetSourceManageTagFilter(tag)}
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>}
                      <td>
                        <div className="source-cell-main">
                          <p className="source-cell-meta">24h 新增 {source.new_articles_24h ?? 0}</p>
                          <p className="source-cell-meta">总点击 {sourceClickCount(source)}</p>
                          <p className="source-cell-meta">最近点击 {source.last_clicked_at ? formatTimeAgo(source.last_clicked_at) : '-'}</p>
                          <p
                            className={cn(
                              'source-cell-meta',
                              source.ai_briefing_enabled && 'source-cell-meta-accent',
                            )}
                          >
                            AI 速览{' '}
                            {source.ai_briefing_enabled
                              ? `${Math.max(1, Math.round((source.ai_briefing_interval_min ?? 60) / 60))}h`
                              : '关闭'}
                          </p>
                          <p className="source-cell-meta">
                            最近生成 {source.ai_briefing_last_generated_at ? formatTimeAgo(source.ai_briefing_last_generated_at) : '-'}
                          </p>
                        </div>
                      </td>
                      <td>
                        <div className="source-cell-main">
                          <Badge className={cn('health-badge', healthToneClass(health))} variant="outline">
                            {healthLabel(health)}
                          </Badge>
                          <p className="source-cell-meta">
                            成功率 {status ? `${status.window_success_rate.toFixed(0)}%` : '-'} · 失败 {status?.window_failed ?? '-'}
                          </p>
                          <p className="source-cell-meta">
                            最近抓取 {status?.latest_fetched_at ? formatTimeAgo(status.latest_fetched_at) : '-'}
                          </p>
                          {hasFetchError && (
                            <p className="source-cell-error">
                              拉取失败
                              {typeof status?.latest_http_status === 'number' ? ` · HTTP ${status.latest_http_status}` : ''}
                              {status?.last_error ? ` · ${status.last_error}` : ''}
                            </p>
                          )}
                        </div>
                      </td>
                      {densityMode !== 'compact' && <td>
                        {isEditing ? (
                          <Input value={editSourcePollSec} onChange={(event) => onSetEditSourcePollSec(event.target.value)} />
                        ) : (
                          <div className="source-cell-main">
                            <p className="source-cell-meta">间隔 {status?.effective_poll_interval_sec ?? source.poll_interval_sec}s</p>
                            <p className="source-cell-meta">连续失败 {status?.consecutive_failures ?? 0}</p>
                            <p className="source-cell-meta">最近状态 {status?.latest_status ?? '-'}</p>
                            <p className={cn('source-cell-meta', hasFetchError && 'source-cell-error')}>
                              最近错误 {status?.last_error_at ? formatTimeAgo(status.last_error_at) : '-'}
                            </p>
                          </div>
                        )}
                      </td>}
                      {densityMode === 'detailed' && <td>
                        {isEditing ? (
                          <Input value={editSourceURL} onChange={(event) => onSetEditSourceURL(event.target.value)} />
                        ) : (
                          <p className="source-url">{source.rss_url}</p>
                        )}
                      </td>}
                      <td className="source-actions-col">
                        {isEditing ? (
                          <div className="source-row-actions">
                            <Button type="button" size="sm" onClick={() => void onSaveSourceEdit(source.id)} disabled={rowBusy}>
                              保存
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={onCancelEdit} disabled={rowBusy}>
                              取消
                            </Button>
                          </div>
                        ) : (
                          <div className="source-row-actions">
                            <Button type="button" variant="secondary" size="sm" onClick={() => void onTestSource(source.id)} disabled={rowBusy}>
                              测试
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => onStartEdit(source)} disabled={rowBusy}>
                              编辑
                            </Button>
                            <details className="source-row-more">
                              <summary className="button button-outline button-sm">更多</summary>
                              <div className="source-row-more-menu">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void onRefreshSource(source.id)}
                                  disabled={rowBusy}
                                >
                                  强制刷新
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void onToggleSourceEnabled(source)}
                                  disabled={rowBusy}
                                >
                                  {source.enabled ? '停用' : '启用'}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onToggleSiteMuted(siteKey)}
                                  disabled={rowBusy}
                                >
                                  {mutedSiteSet.has(siteKey) ? '恢复展示' : '隐藏站点'}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void onDeleteSource(source)}
                                  disabled={rowBusy}
                                >
                                  删除
                                </Button>
                              </div>
                            </details>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {loadingSources && <p className="hint">加载来源中...</p>}
        </div>
        )}
      </section>

      <section className="panel source-manage-forms">
        <div className="source-manage-form-grid">
          <section className="source-manage-form-block">
            <h4>新增来源</h4>
            <form className="source-form" onSubmit={(event) => void onCreateSource(event)}>
              <label>
                名称（可选）
                <Input
                  value={newSourceName}
                  onChange={(event) => onSetNewSourceName(event.target.value)}
                  placeholder="留空则自动使用 RSS title"
                />
              </label>
              <label>
                RSS URL
                <Input
                  value={newSourceURL}
                  onChange={(event) => onSetNewSourceURL(event.target.value)}
                  placeholder="https://example.com/feed.xml"
                />
              </label>
              <label>
                标签（可选，逗号分隔）
                <Input
                  value={newSourceTags}
                  onChange={(event) => onSetNewSourceTags(event.target.value)}
                  placeholder="tech, ai, startup"
                />
              </label>
              <Button type="submit" disabled={creatingSource}>
                {creatingSource ? '创建中...' : '新增来源'}
              </Button>
            </form>
          </section>

          <section className="source-manage-form-block">
            <div className="discover-head">
              <h4>批量添加 RSS</h4>
              <p className="hint">每行一个 URL，可一次添加多个来源</p>
            </div>
            <form className="batch-form" onSubmit={(event) => void onBatchCreateSources(event)}>
              <Textarea
                className="batch-textarea"
                value={batchSourceURLs}
                onChange={(event) => onSetBatchSourceURLs(event.target.value)}
                placeholder={[
                  'https://feeds.bloomberg.com/markets/news.rss',
                  'https://feeds.bloomberg.com/politics/news.rss',
                  'https://feeds.bloomberg.com/technology/news.rss',
                ].join('\n')}
              />
              <div className="batch-actions">
                <Input
                  value={batchSourceTags}
                  onChange={(event) => onSetBatchSourceTags(event.target.value)}
                  placeholder="标签（可选，逗号分隔）"
                />
                <Button type="submit" disabled={batchCreatingSources}>
                  {batchCreatingSources ? '添加中...' : '批量添加'}
                </Button>
              </div>
            </form>
            {batchCreateResult && (
              <div className="batch-result">
                <p className="hint">
                  成功 {batchCreateResult.success.length} 条，失败 {batchCreateResult.failed.length} 条
                </p>
                {batchCreateResult.failed.length > 0 && (
                  <div className="batch-errors">
                    {batchCreateResult.failed.map((item) => (
                      <p key={item.url} className="status-error">
                        {item.url} · {item.error}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <section className="source-manage-form-block">
          <div className="discover-head">
            <h4>自动发现 RSS</h4>
            <p className="hint">输入网站地址，自动探测可订阅源</p>
          </div>
          <form className="discover-form" onSubmit={(event) => void onDiscoverSources(event)}>
            <Input
              value={discoverURL}
              onChange={(event) => onSetDiscoverURL(event.target.value)}
              placeholder="https://example.com"
            />
            <Button type="submit" disabled={discoveringSources}>
              {discoveringSources ? '发现中...' : '开始发现'}
            </Button>
          </form>
          {discoveredSources.length > 0 && (
            <div className="discover-list">
              {discoveredSources.map((candidate) => (
                <article key={candidate.rss_url} className="discover-item">
                  <div className="discover-item-main">
                    <p className="discover-title">{candidate.name}</p>
                    <p className="discover-url">{candidate.rss_url}</p>
                    <p className="discover-meta">
                      <span>{candidate.feed_type.toUpperCase()}</span>
                      <span>{candidate.item_count} 条</span>
                      <span>{confidenceLabel(candidate.confidence)}</span>
                      <span>{candidate.reason}</span>
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={candidate.existing ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => void onAddDiscoveredSource(candidate)}
                    disabled={candidate.existing}
                  >
                    {candidate.existing ? '已存在' : '添加'}
                  </Button>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
