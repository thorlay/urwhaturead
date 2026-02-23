import type { RefObject } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Source, SourceStatus } from '../types'

type SourceContextMenuState = {
  source: Source
  x: number
  y: number
}

type SourceContextMenuOverlayProps = {
  contextMenuRef: RefObject<HTMLDivElement | null>
  sourceContextMenu: SourceContextMenuState | null
  busySourceID: number | null
  onQuickSetSourceEnabled: (source: Source, enabled: boolean) => Promise<void>
  onOpenSourceProfile: (source: Source) => void
  onOpenDeleteConfirm: (source: Source) => void
}

export function SourceContextMenuOverlay(props: SourceContextMenuOverlayProps) {
  const { contextMenuRef, sourceContextMenu, busySourceID, onQuickSetSourceEnabled, onOpenSourceProfile, onOpenDeleteConfirm } = props
  if (!sourceContextMenu) {
    return null
  }

  return (
    <div ref={contextMenuRef} className="source-context-menu" style={{ top: sourceContextMenu.y, left: sourceContextMenu.x }} role="menu">
      <button
        type="button"
        className="source-context-menu-item"
        onClick={() => void onQuickSetSourceEnabled(sourceContextMenu.source, false)}
        disabled={!sourceContextMenu.source.enabled || busySourceID === sourceContextMenu.source.id}
      >
        {sourceContextMenu.source.enabled ? '快速取消订阅（停用）' : '订阅已停用'}
      </button>
      <button
        type="button"
        className="source-context-menu-item"
        onClick={() => onOpenSourceProfile(sourceContextMenu.source)}
      >
        查看订阅源属性
      </button>
      <button
        type="button"
        className="source-context-menu-item danger"
        onClick={() => onOpenDeleteConfirm(sourceContextMenu.source)}
        disabled={busySourceID === sourceContextMenu.source.id}
      >
        永久删除订阅源
      </button>
    </div>
  )
}

type SourceProfileDialogProps = {
  sourceProfileSource: Source | null
  sourceProfileStatus: SourceStatus | null
  sourceProfileHealth: SourceStatus['health'] | null
  sourceProfileTags: string[]
  sourceProfileTagPickerOpen: boolean
  onToggleSourceProfileTagPicker: () => void
  sourceProfileTagInput: string
  onSetSourceProfileTagInput: (value: string) => void
  sourceProfileTagDrafts: string[]
  sourceProfileTagCandidates: string[]
  busySourceID: number | null
  onRemoveSourceProfileTag: (tag: string) => Promise<void>
  onAddSourceProfileTags: (tags: string[]) => Promise<void>
  onQuickSetSourceEnabled: (source: Source, enabled: boolean) => Promise<void>
  onOpenDeleteConfirm: (source: Source) => void
  onCloseSourceProfile: () => void
  normalizeSourceKind: (kind?: string) => 'feed' | 'thread'
  resolveSourceSiteKey: (source: Pick<Source, 'site_key' | 'rss_url'>) => string
  formatDateTime: (input?: string) => string
  healthToneClass: (health: SourceStatus['health']) => string
  healthLabel: (health: SourceStatus['health']) => string
  formatTimeAgo: (input: string) => string
  sourceClickCount: (source: Pick<Source, 'click_count'>) => number
}

export function SourceProfileDialog(props: SourceProfileDialogProps) {
  const {
    sourceProfileSource,
    sourceProfileStatus,
    sourceProfileHealth,
    sourceProfileTags,
    sourceProfileTagPickerOpen,
    onToggleSourceProfileTagPicker,
    sourceProfileTagInput,
    onSetSourceProfileTagInput,
    sourceProfileTagDrafts,
    sourceProfileTagCandidates,
    busySourceID,
    onRemoveSourceProfileTag,
    onAddSourceProfileTags,
    onQuickSetSourceEnabled,
    onOpenDeleteConfirm,
    onCloseSourceProfile,
    normalizeSourceKind,
    resolveSourceSiteKey,
    formatDateTime,
    healthToneClass,
    healthLabel,
    formatTimeAgo,
    sourceClickCount,
  } = props
  if (!sourceProfileSource) {
    return null
  }

  return (
    <div className="source-profile-overlay" onClick={onCloseSourceProfile}>
      <section
        className="source-profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-profile-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="source-profile-header">
          <h3 id="source-profile-title">订阅源属性</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onCloseSourceProfile}>
            关闭
          </Button>
        </div>

        <dl className="source-profile-grid">
          <div className="source-profile-section">基础信息</div>
          <div>
            <dt>名称</dt>
            <dd>{sourceProfileSource.name}</dd>
          </div>
          <div>
            <dt>来源类型</dt>
            <dd>{normalizeSourceKind(sourceProfileSource.kind) === 'thread' ? '论坛话题' : 'RSS 订阅'}</dd>
          </div>
          <div>
            <dt>RSS URL</dt>
            <dd className="mono">{sourceProfileSource.rss_url}</dd>
          </div>
          <div>
            <dt>站点</dt>
            <dd>{resolveSourceSiteKey(sourceProfileSource)}</dd>
          </div>
          <div>
            <dt>标签</dt>
            <dd>
              <div className="source-profile-tag-editor">
                <div className="source-profile-tag-list">
                  {sourceProfileTags.map((tag) => (
                    <span key={`profile-tag-${sourceProfileSource.id}-${tag}`} className="source-profile-tag-chip">
                      {tag}
                      <button
                        type="button"
                        className="source-profile-tag-remove"
                        onClick={() => void onRemoveSourceProfileTag(tag)}
                        disabled={busySourceID === sourceProfileSource.id}
                        aria-label={`删除标签 ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    className="source-profile-tag-add"
                    onClick={onToggleSourceProfileTagPicker}
                    aria-expanded={sourceProfileTagPickerOpen}
                    aria-label="添加标签"
                    disabled={busySourceID === sourceProfileSource.id}
                  >
                    +
                  </button>
                </div>
                {sourceProfileTagPickerOpen && (
                  <div className="source-profile-tag-picker">
                    <div className="source-profile-tag-picker-head">
                      <Input
                        value={sourceProfileTagInput}
                        onChange={(event) => onSetSourceProfileTagInput(event.target.value)}
                        placeholder="搜索或输入新标签"
                        disabled={busySourceID === sourceProfileSource.id}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void onAddSourceProfileTags(sourceProfileTagDrafts)}
                        disabled={busySourceID === sourceProfileSource.id || sourceProfileTagDrafts.length === 0}
                      >
                        添加输入
                      </Button>
                    </div>
                    <div className="source-profile-tag-picker-list">
                      {sourceProfileTagCandidates.length === 0 && <p className="hint">无可选标签</p>}
                      {sourceProfileTagCandidates.map((tag) => (
                        <Button
                          key={`profile-tag-candidate-${tag}`}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="source-profile-tag-option"
                          onClick={() => void onAddSourceProfileTags([tag])}
                          disabled={busySourceID === sourceProfileSource.id}
                        >
                          {tag}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{formatDateTime(sourceProfileSource.created_at)}</dd>
          </div>
          <div>
            <dt>最后更新时间</dt>
            <dd>{formatDateTime(sourceProfileSource.updated_at)}</dd>
          </div>

          <div className="source-profile-section">抓取状态</div>
          <div>
            <dt>状态</dt>
            <dd className="source-profile-status">
              <Badge variant={sourceProfileSource.enabled ? 'secondary' : 'outline'}>
                {sourceProfileSource.enabled ? '启用' : '停用'}
              </Badge>
              {sourceProfileHealth && (
                <Badge className={cn('health-badge', healthToneClass(sourceProfileHealth))} variant="outline">
                  {healthLabel(sourceProfileHealth)}
                </Badge>
              )}
            </dd>
          </div>
          <div>
            <dt>抓取间隔</dt>
            <dd>{sourceProfileStatus?.effective_poll_interval_sec ?? sourceProfileSource.poll_interval_sec}s</dd>
          </div>
          <div>
            <dt>最近抓取</dt>
            <dd>{sourceProfileStatus?.latest_fetched_at ? formatTimeAgo(sourceProfileStatus.latest_fetched_at) : '-'}</dd>
          </div>
          <div>
            <dt>最近状态</dt>
            <dd>{sourceProfileStatus?.latest_status ?? '-'}</dd>
          </div>
          <div>
            <dt>点击次数</dt>
            <dd>{sourceClickCount(sourceProfileSource)}</dd>
          </div>
        </dl>

        <div className="source-profile-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onQuickSetSourceEnabled(sourceProfileSource, !sourceProfileSource.enabled)}
            disabled={busySourceID === sourceProfileSource.id}
          >
            {sourceProfileSource.enabled ? '停用订阅' : '启用订阅'}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => onOpenDeleteConfirm(sourceProfileSource)}
            disabled={busySourceID === sourceProfileSource.id}
          >
            永久删除
          </Button>
        </div>
      </section>
    </div>
  )
}

type SourceDeleteConfirmDialogProps = {
  pendingDeleteSource: Source | null
  busySourceID: number | null
  onCloseDeleteConfirm: () => void
  onConfirmDeleteSource: () => Promise<void>
}

export function SourceDeleteConfirmDialog(props: SourceDeleteConfirmDialogProps) {
  const { pendingDeleteSource, busySourceID, onCloseDeleteConfirm, onConfirmDeleteSource } = props
  if (!pendingDeleteSource) {
    return null
  }

  return (
    <div className="source-delete-overlay" onClick={onCloseDeleteConfirm}>
      <section
        className="source-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-delete-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="source-delete-title">确认永久删除</h3>
        <p>
          你将永久删除订阅源「{pendingDeleteSource.name}」。该操作不可恢复，是否继续？
        </p>
        <div className="source-delete-actions">
          <Button type="button" variant="outline" size="sm" onClick={onCloseDeleteConfirm}>
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => void onConfirmDeleteSource()}
            disabled={busySourceID === pendingDeleteSource.id}
          >
            {busySourceID === pendingDeleteSource.id ? '删除中...' : '确认删除'}
          </Button>
        </div>
      </section>
    </div>
  )
}
