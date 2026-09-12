import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatAIBriefingInterval } from '../../lib/app-utils'
import { SourceActionMenu } from './source-action-menu'
import { SourceHealthState } from './source-health'
import { sourceNextFetchLabel } from './source-health-utils'
import { SourceURLIconLink, SourceURLLink } from './source-links'
import type { SourceManagementPanelController } from './types'

export function SourceList({ controller }: { controller: SourceManagementPanelController }) {
  const {
    sources,
    filteredSources,
    loadingSources,
    sourceSelectAllRef,
    allVisibleSelected,
    onToggleSelectAllVisibleSources,
    sourceStatusMap,
    resolveSourceHealth,
    sourceSiteKeyMap,
    resolveSourceSiteKey,
    busySourceID,
    bulkSourceAction,
    editingSourceID,
    selectedSourceIDSet,
    onToggleSourceSelection,
    editSourceName,
    onSetEditSourceName,
    editSourceTags,
    onSetEditSourceTags,
    editSourceURL,
    onSetEditSourceURL,
    editSourcePollSec,
    onSetEditSourcePollSec,
    sourceTagList,
    onSetSourceManageTagFilter,
    normalizeSourceKind,
    formatTimeAgo,
    healthLabel,
    onSaveSourceEdit,
    onCancelEdit,
    mutedSiteSet,
    onTestSource,
    onRefreshSource,
    onStartEdit,
    onToggleSourceEnabled,
    onToggleSiteMuted,
    onDeleteSource,
  } = controller

  return (
    <>
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
                <th>动态</th>
                <th>状态</th>
                <th>抓取</th>
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
                const nextFetchLabel = sourceNextFetchLabel(source, status)
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
                      {isEditing ? (
                        <div className="source-desktop-edit-fields">
                          <Input value={editSourceName} onChange={(event) => onSetEditSourceName(event.target.value)} aria-label="来源名称" />
                          <Input value={editSourceTags} onChange={(event) => onSetEditSourceTags(event.target.value)} placeholder="tech, ai, startup" aria-label="来源标签" />
                          <Input value={editSourceURL} onChange={(event) => onSetEditSourceURL(event.target.value)} placeholder="RSS URL" aria-label="RSS URL" />
                        </div>
                      ) : (
                        <div className="source-cell-main">
                          <div className="source-title-row">
                            <p className="source-title">{source.name}</p>
                            <SourceURLIconLink url={source.rss_url} />
                            {source.ai_briefing_enabled && (
                              <Badge variant="outline">AI {formatAIBriefingInterval(source.ai_briefing_interval_min)}</Badge>
                            )}
                          </div>
                          <p className="source-cell-meta">
                            #{source.id} · {siteKey} · {source.enabled ? '启用' : '停用'} · {normalizeSourceKind(source.kind) === 'thread' ? '跟踪帖' : '订阅源'}
                          </p>
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
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="source-activity-cell">
                        <strong>{source.new_articles_24h ?? 0}</strong>
                        <span>24h 新增</span>
                      </div>
                    </td>
                    <td>
                      <SourceHealthState source={source} status={status} health={health} healthLabel={healthLabel} detailed={hasFetchError} />
                    </td>
                    <td>
                      {isEditing ? (
                        <Input value={editSourcePollSec} onChange={(event) => onSetEditSourcePollSec(event.target.value)} />
                      ) : (
                        <div className="source-fetch-cell">
                          <span>{status?.latest_fetched_at ? formatTimeAgo(status.latest_fetched_at) : '尚未抓取'}</span>
                          <small>每 {status?.effective_poll_interval_sec ?? source.poll_interval_sec}s</small>
                          {hasFetchError && <small className="is-failure">失败 {status?.consecutive_failures ?? 0} 次</small>}
                          {hasFetchError && nextFetchLabel && <small>{nextFetchLabel}</small>}
                        </div>
                      )}
                    </td>
                    <td className="source-actions-col">
                      {isEditing ? (
                        <div className="source-row-actions">
                          <Button type="button" size="sm" onClick={() => void onSaveSourceEdit(source.id)} disabled={rowBusy}>保存</Button>
                          <Button type="button" variant="outline" size="sm" onClick={onCancelEdit} disabled={rowBusy}>取消</Button>
                        </div>
                      ) : (
                        <SourceActionMenu
                          source={source}
                          siteKey={siteKey}
                          rowBusy={rowBusy}
                          hasFetchError={hasFetchError}
                          muted={mutedSiteSet.has(siteKey)}
                          onTest={onTestSource}
                          onRefresh={onRefreshSource}
                          onEdit={onStartEdit}
                          onToggleEnabled={onToggleSourceEnabled}
                          onToggleSiteMuted={onToggleSiteMuted}
                          onDelete={onDeleteSource}
                        />
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

      <div className="source-mobile-list">
        {!loadingSources && sources.length > 0 && filteredSources.map((source) => {
          const status = sourceStatusMap.get(source.id)
          const health = resolveSourceHealth(source, sourceStatusMap)
          const siteKey = sourceSiteKeyMap.get(source.id) ?? resolveSourceSiteKey(source)
          const rowBusy = busySourceID === source.id || bulkSourceAction !== null
          const isEditing = editingSourceID === source.id
          const hasFetchError = health === 'error' || (status?.latest_http_status ?? 0) >= 400 || Boolean(status?.last_error)
          const hasFetchWarning = !hasFetchError && (health === 'warn' || health === 'stale')
          const nextFetchLabel = sourceNextFetchLabel(source, status)
          return (
            <article key={source.id} className={cn('source-mobile-card', hasFetchError && 'source-row-error', hasFetchWarning && 'source-row-warning')}>
              <div className="source-mobile-card-head">
                <input type="checkbox" checked={selectedSourceIDSet.has(source.id)} onChange={() => onToggleSourceSelection(source.id)} aria-label={`选择来源 ${source.name}`} />
                <div className="source-mobile-card-title">
                  {isEditing ? (
                    <Input value={editSourceName} onChange={(event) => onSetEditSourceName(event.target.value)} />
                  ) : (
                    <>
                      <p className="source-title">{source.name}</p>
                      <p className="source-cell-meta">#{source.id} · {siteKey} · {normalizeSourceKind(source.kind) === 'thread' ? '跟踪帖' : '订阅源'}</p>
                    </>
                  )}
                </div>
                <SourceHealthState source={source} status={status} health={health} healthLabel={healthLabel} />
              </div>

              {isEditing ? (
                <div className="source-mobile-edit-fields">
                  <Input value={editSourceTags} onChange={(event) => onSetEditSourceTags(event.target.value)} placeholder="标签" />
                  <Input value={editSourcePollSec} onChange={(event) => onSetEditSourcePollSec(event.target.value)} placeholder="抓取间隔（秒）" />
                  <Input value={editSourceURL} onChange={(event) => onSetEditSourceURL(event.target.value)} placeholder="RSS URL" />
                  <div className="source-row-actions">
                    <Button type="button" size="sm" onClick={() => void onSaveSourceEdit(source.id)} disabled={rowBusy}>保存</Button>
                    <Button type="button" variant="outline" size="sm" onClick={onCancelEdit} disabled={rowBusy}>取消</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="source-mobile-metrics">
                    <span><strong>{source.new_articles_24h ?? 0}</strong> 24h 新增</span>
                    <span>最近抓取 {status?.latest_fetched_at ? formatTimeAgo(status.latest_fetched_at) : '未开始'}</span>
                    <span>每 {status?.effective_poll_interval_sec ?? source.poll_interval_sec}s</span>
                    {hasFetchError && nextFetchLabel && <span>{nextFetchLabel}</span>}
                  </div>
                  <div className="source-mobile-meta-row">
                    <div className="source-tag-list">
                      {sourceTagList(source).map((tag) => (
                        <Badge key={`${source.id}-${tag}`} variant="outline" className="source-tag-badge" onClick={() => onSetSourceManageTagFilter(tag)}>{tag}</Badge>
                      ))}
                    </div>
                    <span className="source-cell-meta">{source.ai_briefing_enabled ? `AI ${formatAIBriefingInterval(source.ai_briefing_interval_min)}` : 'AI 关闭'}</span>
                  </div>
                  <p className="source-url"><SourceURLLink url={source.rss_url} /></p>
                  {hasFetchError && (
                    <details className="source-health-details">
                      <summary>查看技术详情</summary>
                      <code>{status?.last_error || `HTTP ${status?.latest_http_status}`}</code>
                    </details>
                  )}
                  <SourceActionMenu
                    source={source}
                    siteKey={siteKey}
                    rowBusy={rowBusy}
                    hasFetchError={hasFetchError}
                    muted={mutedSiteSet.has(siteKey)}
                    onTest={onTestSource}
                    onRefresh={onRefreshSource}
                    onEdit={onStartEdit}
                    onToggleEnabled={onToggleSourceEnabled}
                    onToggleSiteMuted={onToggleSiteMuted}
                    onDelete={onDeleteSource}
                  />
                </>
              )}
            </article>
          )
        })}
      </div>
    </>
  )
}
