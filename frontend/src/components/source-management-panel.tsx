import type { FormEvent, RefObject } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { BatchCreateResult, BulkSourceAction, SourceHealthFilter } from '../hooks/use-source-management-state'
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
  availableTags: string[]
  onClearSourceManageFilters: () => void
  loadingSources: boolean
  onLoadSources: () => Promise<void>
  selectedSourceIDs: number[]
  visibleSourceIDs: number[]
  bulkTagInput: string
  onSetBulkTagInput: (value: string) => void
  bulkSourceAction: BulkSourceAction | null
  hasSelectedSources: boolean
  onRunBulkTagAction: (action: 'add' | 'remove') => Promise<void>
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
    availableTags,
    onClearSourceManageFilters,
    loadingSources,
    onLoadSources,
    selectedSourceIDs,
    visibleSourceIDs,
    bulkTagInput,
    onSetBulkTagInput,
    bulkSourceAction,
    hasSelectedSources,
    onRunBulkTagAction,
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
              {loadingStatus ? '刷新状态中...' : '刷新状态'}
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
          </div>
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
            {loadingSources ? '刷新来源中...' : '刷新来源'}
          </Button>
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
              {bulkSourceAction === 'refresh' ? '批量刷新中...' : '批量刷新'}
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

        <div className="source-table-wrap">
          {!loadingSources && sources.length === 0 && <p className="hint">暂无来源</p>}
          {!loadingSources && sources.length > 0 && filteredSources.length === 0 && <p className="hint">当前筛选下没有来源</p>}
          {sources.length > 0 && filteredSources.length > 0 && (
            <table className="source-table">
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
                  <th>来源</th>
                  <th>标签</th>
                  <th>点击</th>
                  <th>健康状态</th>
                  <th>抓取配置</th>
                  <th>RSS URL</th>
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
                  return (
                    <tr key={source.id} className={cn(selectedSourceIDSet.has(source.id) && 'selected')}>
                      <td className="source-checkbox-col">
                        <input
                          type="checkbox"
                          checked={selectedSourceIDSet.has(source.id)}
                          onChange={() => onToggleSourceSelection(source.id)}
                          aria-label={`选择来源 ${source.name}`}
                        />
                      </td>
                      <td>
                        {isEditing ? (
                          <Input value={editSourceName} onChange={(event) => onSetEditSourceName(event.target.value)} />
                        ) : (
                          <div className="source-cell-main">
                            <p className="source-title">{source.name}</p>
                            <p className="source-cell-meta">
                              #{source.id} · {siteKey} · {source.enabled ? '启用' : '停用'} · {normalizeSourceKind(source.kind) === 'thread' ? '跟踪帖' : '订阅源'}
                            </p>
                          </div>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <Input
                            value={editSourceTags}
                            onChange={(event) => onSetEditSourceTags(event.target.value)}
                            placeholder="tech, ai, startup"
                          />
                        ) : (
                          <div className="source-tag-list">
                            {sourceTagList(source).map((tag) => (
                              <Badge key={`${source.id}-${tag}`} variant="outline">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="source-cell-main">
                          <p className="source-cell-meta">总点击 {sourceClickCount(source)}</p>
                          <p className="source-cell-meta">最近点击 {source.last_clicked_at ? formatTimeAgo(source.last_clicked_at) : '-'}</p>
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
                        </div>
                      </td>
                      <td>
                        {isEditing ? (
                          <Input value={editSourcePollSec} onChange={(event) => onSetEditSourcePollSec(event.target.value)} />
                        ) : (
                          <div className="source-cell-main">
                            <p className="source-cell-meta">间隔 {status?.effective_poll_interval_sec ?? source.poll_interval_sec}s</p>
                            <p className="source-cell-meta">连续失败 {status?.consecutive_failures ?? 0}</p>
                            <p className="source-cell-meta">最近状态 {status?.latest_status ?? '-'}</p>
                          </div>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <Input value={editSourceURL} onChange={(event) => onSetEditSourceURL(event.target.value)} />
                        ) : (
                          <p className="source-url">{source.rss_url}</p>
                        )}
                      </td>
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
                            <Button type="button" variant="outline" size="sm" onClick={() => void onRefreshSource(source.id)} disabled={rowBusy}>
                              刷新
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => onStartEdit(source)} disabled={rowBusy}>
                              编辑
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
                            <Button type="button" variant="ghost" size="sm" onClick={() => onToggleSiteMuted(siteKey)} disabled={rowBusy}>
                              {mutedSiteSet.has(siteKey) ? '恢复展示' : '隐藏站点'}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => void onDeleteSource(source)}
                              disabled={rowBusy}
                            >
                              删除
                            </Button>
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
