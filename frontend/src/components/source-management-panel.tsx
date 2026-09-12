import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { getSystemStatus } from '../api'
import { formatAIBriefingInterval } from '../lib/app-utils'
import type {
  SourceHealthFilter,
  SourceQuickView,
  SourceSortKey,
} from '../hooks/use-source-management-state'
import type { Source, SystemComponentStatus, SystemStatusResponse } from '../types'
import { SourceList } from './source-management/source-list'
import { sourceFailureSummary } from './source-management/source-health-utils'
import { SourceURLLink } from './source-management/source-links'
import type { SourceManagementPanelController } from './source-management/types'

export type { SourceManagementPanelController } from './source-management/types'

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
    filteredSources,
    sourceStatusMap,
    resolveSourceHealth,
    sourceClickCount,
    formatTimeAgo,
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
  const [showSourceTools, setShowSourceTools] = useState(false)
  const [systemStatus, setSystemStatus] = useState<SystemStatusResponse['data'] | null>(null)
  const [loadingSystemStatus, setLoadingSystemStatus] = useState(false)
  const [systemStatusError, setSystemStatusError] = useState<string | null>(null)

  const loadSystemStatus = useCallback(async () => {
    try {
      setLoadingSystemStatus(true)
      setSystemStatusError(null)
      const response = await getSystemStatus()
      setSystemStatus(response.data)
    } catch (error) {
      setSystemStatusError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingSystemStatus(false)
    }
  }, [])

  useEffect(() => {
    if (manageTab !== 'status' || systemStatus || loadingSystemStatus) {
      return
    }
    void loadSystemStatus()
  }, [loadSystemStatus, loadingSystemStatus, manageTab, systemStatus])

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

      highlights.push({
        sourceID: source.id,
        name: source.name,
        httpStatus: status.latest_http_status,
        reason: sourceFailureSummary(source, status),
      })
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
          <div className="source-manage-title">
            <p className="source-manage-eyebrow">SOURCE OPERATIONS</p>
            <h2>来源管理</h2>
            <p className="hint">优先处理异常来源，其余来源保持轻量维护。</p>
          </div>
          <div className="source-manage-head-actions">
            <Button type="button" size="sm" onClick={() => setShowSourceTools((value) => !value)}>
              {showSourceTools ? '收起来源工具' : '添加来源'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void onLoadStatus()} disabled={loadingStatus}>
              {loadingStatus ? '更新中...' : '刷新状态'}
            </Button>
            <details className="source-manage-more-actions">
              <summary className="button button-outline button-sm">更多管理</summary>
              <div className="source-manage-more-menu">
                <div className="manage-model-entry">
                  <Button type="button" variant="ghost" size="sm" className="manage-model-button" onClick={onToggleManageModelPicker}>
                    模型：{aiModel}
                  </Button>
                  {showManageModelPicker && (
                    <div className="manage-model-panel">
                      <Select value={aiModel} onChange={(event) => onChangeAIModel(event.target.value)}>
                        {aiModelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        {!aiModelOptions.includes(aiModel) && <option value={aiModel}>{aiModel}</option>}
                      </Select>
                    </div>
                  )}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadSystemStatus()} disabled={loadingSystemStatus}>
                  {loadingSystemStatus ? '检查中...' : '检查系统'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void onReclassifySources()} disabled={reclassifyingSources}>
                  {reclassifyingSources ? '重分类中...' : '自动重分类'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void onExportSources()} disabled={exportingSources || importingSources}>
                  {exportingSources ? '导出中...' : '导出来源 JSON'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => importFileInputRef.current?.click()} disabled={importingSources || exportingSources}>
                  {importingSources ? '导入中...' : '导入来源 JSON'}
                </Button>
              </div>
            </details>
            <input
              ref={importFileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleImportFileChange}
            />
          </div>
        </div>

        <div className="source-management-summary" aria-label="来源概览">
          <button type="button" className="source-summary-stat" onClick={() => onSetSourceManageQuickView('all')}>
            <span>全部来源</span><strong>{sources.length}</strong>
          </button>
          <button type="button" className="source-summary-stat" onClick={() => onSetSourceManageQuickView('attention')}>
            <span>需要处理</span><strong>{unhealthySourceCount}</strong>
            <small>错误 {sourceHealthCounts.error} · 警告 {sourceHealthCounts.warn}</small>
          </button>
          <button type="button" className="source-summary-stat" onClick={() => onSetSourceManageQuickView('all')}>
            <span>正常运行</span><strong>{Math.max(0, enabledSourceCount - unhealthySourceCount)}</strong>
            <small>已启用 {enabledSourceCount}</small>
          </button>
          <button type="button" className="source-summary-stat" onClick={() => onSetSourceManageQuickView('thread')}>
            <span>跟踪与静默</span><strong>{quickViewCounts.thread + mutedSiteKeys.length}</strong>
            <small>跟踪帖 {quickViewCounts.thread} · 隐藏站点 {mutedSiteKeys.length}</small>
          </button>
        </div>

        <div className="source-manage-nav" role="tablist" aria-label="管理页面视图">
          <button
            type="button"
            role="tab"
            aria-selected={manageTab === 'sources'}
            className={cn('source-manage-nav-tab', manageTab === 'sources' && 'active')}
            onClick={() => setManageTab('sources')}
          >
            来源管理
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={manageTab === 'status'}
            className={cn('source-manage-nav-tab', manageTab === 'status' && 'active')}
            onClick={() => setManageTab('status')}
          >
            运行状态
          </button>
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

        {systemStatusError && (
          <div className="inline-error">
            <span>系统状态加载失败: {systemStatusError}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadSystemStatus()}>
              重试
            </Button>
          </div>
        )}

        {failingSourceHighlights.length > 0 && (
          <div className="source-failure-banner" role="status" aria-live="polite">
            <div className="source-failure-banner-main">
              <p className="source-failure-title">抓取异常：{unhealthySourceCount} 个来源需要关注</p>
              <p className="source-failure-list">优先检查限流、上游不可用与长期未更新的来源。</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => onSetSourceManageQuickView('attention')}>
              查看需处理来源
            </Button>
          </div>
        )}

        {manageTab === 'status' && (
          <section className="source-status-layout">
            <section className="system-status-panel">
              <div className="system-status-head">
                <div>
                  <h4>系统状态</h4>
                  <p className="hint">
                    {systemStatus
                      ? `版本 ${systemStatus.version} · 运行 ${formatUptime(systemStatus.uptime_sec)} · 检查 ${formatTimeAgo(systemStatus.checked_at)}`
                      : loadingSystemStatus
                        ? '正在检查 API、数据库、RSSHub 与 AI。'
                        : '点击检查系统查看运行状态。'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadSystemStatus()}
                  disabled={loadingSystemStatus}
                >
                  {loadingSystemStatus ? '检查中...' : '重新检查'}
                </Button>
              </div>
              <div className="system-status-grid">
                {[
                  ['API', systemStatus?.api],
                  ['数据库', systemStatus?.db],
                  ['RSSHub', systemStatus?.rsshub],
                  ['AI API', systemStatus?.ai],
                ].map(([label, status]) => (
                  <SystemStatusCard key={label as string} label={label as string} status={status as SystemComponentStatus | undefined} />
                ))}
              </div>
            </section>

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
                          {source.name} · {formatAIBriefingInterval(source.ai_briefing_interval_min)}
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
        <>
        <details className="source-manage-tools" open={showSourceTools} onToggle={(event) => setShowSourceTools(event.currentTarget.open)}>
          <summary>添加、导入与发现来源</summary>
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
                      <p className="discover-url"><SourceURLLink url={candidate.rss_url} /></p>
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
        </details>

        <section className="source-list-controls" aria-label="来源筛选与排序">
          <div className="source-toolbar">
            <Input
              value={sourceManageKeyword}
              onChange={(event) => onSetSourceManageKeyword(event.target.value)}
              placeholder="搜索名称、URL、标签或站点"
            />
            <Select value={sourceManageTagFilter} onChange={(event) => onSetSourceManageTagFilter(event.target.value)}>
              <option value="">全部标签</option>
              {availableTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </Select>
            <Select value={sourceManageHealthFilter} onChange={(event) => onSetSourceManageHealthFilter(event.target.value as SourceHealthFilter)}>
              <option value="all">所有状态</option>
              <option value="error">需要处理</option>
              <option value="warn">警告</option>
              <option value="stale">陈旧</option>
              <option value="ok">健康</option>
              <option value="disabled">停用</option>
              <option value="new">新来源</option>
            </Select>
            <div className="source-toolbar-inline-group">
              <Select value={sourceManageSortKey} aria-label="来源排序" onChange={(event) => onSetSourceManageSortKey(event.target.value as SourceSortKey)}>
                <option value="health">风险优先</option>
                <option value="new_articles">24h 新增</option>
                <option value="clicks">总点击</option>
                <option value="last_fetched">最近抓取</option>
                <option value="last_clicked">最近点击</option>
                <option value="ai_generated">AI 最近生成</option>
                <option value="name">名称</option>
              </Select>
              <Button type="button" variant="ghost" size="sm" onClick={() => onSetSourceManageSortDesc(!sourceManageSortDesc)}>
                {sourceManageSortDesc ? '降序' : '升序'}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void onLoadSources()} disabled={loadingSources}>
                {loadingSources ? '刷新中...' : '刷新列表'}
              </Button>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={onClearSourceManageFilters}>清空</Button>
          </div>

          <div className="source-quickviews">
            <div className="source-quickview-list" role="group" aria-label="来源快捷视图">
              {quickViews.map((view) => (
                <button
                  key={view.key}
                  type="button"
                  className={cn('source-quickview-pill', sourceManageQuickView === view.key && 'active')}
                  onClick={() => onSetSourceManageQuickView(view.key)}
                >
                  <span>{view.label}</span><em>{quickViewCounts[view.key]}</em>
                </button>
              ))}
            </div>
          </div>
        </section>

        {hasSelectedSources ? <div className="source-bulkbar">
          <p className="hint">
            已选择 {selectedSourceIDs.length} 个来源
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
              onClick={() => void onRunBulkAIBriefingAction(true, 1440)}
              disabled={!hasSelectedSources || bulkSourceAction !== null}
            >
              {bulkSourceAction === 'enable_ai' ? '批量开启中...' : '批量开 24h AI'}
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
        </div> : (
          <p className="source-list-count">当前显示 {visibleSourceIDs.length} / {sources.length} 个来源。勾选来源后可进行批量操作。</p>
        )}

        <SourceList controller={controller} />
        </>
        )}
      </section>
    </main>
  )
}

function SystemStatusCard({
  label,
  status,
}: {
  label: string
  status?: SystemComponentStatus
}) {
  const value = status?.status ?? 'unknown'
  return (
    <article className={cn('system-status-card', systemStatusToneClass(value))}>
      <div className="system-status-card-top">
        <span>{label}</span>
        <Badge variant="outline">{systemStatusLabel(value)}</Badge>
      </div>
      <p className="source-cell-meta">
        {status?.detail || '尚未检查'}
        {typeof status?.latency_ms === 'number' ? ` · ${status.latency_ms}ms` : ''}
      </p>
    </article>
  )
}

function systemStatusLabel(status: string): string {
  switch (status) {
    case 'ok':
      return '正常'
    case 'warn':
      return '警告'
    case 'error':
      return '异常'
    case 'disabled':
      return '未配置'
    default:
      return '未知'
  }
}

function systemStatusToneClass(status: string): string {
  switch (status) {
    case 'ok':
      return 'system-status-ok'
    case 'warn':
      return 'system-status-warn'
    case 'error':
      return 'system-status-error'
    case 'disabled':
      return 'system-status-disabled'
    default:
      return 'system-status-unknown'
  }
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '-'
  }
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}
