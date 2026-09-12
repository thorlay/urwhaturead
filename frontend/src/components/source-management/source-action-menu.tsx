import { Button } from '@/components/ui/button'
import type { Source } from '../../types'

type SourceActionMenuProps = {
  source: Source
  siteKey: string
  rowBusy: boolean
  hasFetchError: boolean
  muted: boolean
  onTest: (sourceID: number) => Promise<void>
  onRefresh: (sourceID: number) => Promise<void>
  onEdit: (source: Source) => void
  onToggleEnabled: (source: Source) => Promise<void>
  onToggleSiteMuted: (siteKey: string) => void
  onDelete: (source: Source) => Promise<void>
}

export function SourceActionMenu({
  source,
  siteKey,
  rowBusy,
  hasFetchError,
  muted,
  onTest,
  onRefresh,
  onEdit,
  onToggleEnabled,
  onToggleSiteMuted,
  onDelete,
}: SourceActionMenuProps) {
  return (
    <div className="source-row-actions">
      {hasFetchError && (
        <Button type="button" variant="secondary" size="sm" onClick={() => void onTest(source.id)} disabled={rowBusy}>
          重试
        </Button>
      )}
      <details className="source-row-more">
        <summary className="button button-outline button-sm">更多</summary>
        <div className="source-row-more-menu">
          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(source)} disabled={rowBusy}>编辑</Button>
          {!hasFetchError && (
            <Button type="button" variant="outline" size="sm" onClick={() => void onTest(source.id)} disabled={rowBusy}>测试</Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => void onRefresh(source.id)} disabled={rowBusy}>强制刷新</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void onToggleEnabled(source)} disabled={rowBusy}>
            {source.enabled ? '停用' : '启用'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onToggleSiteMuted(siteKey)} disabled={rowBusy}>
            {muted ? '恢复展示' : '隐藏站点'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void onDelete(source)} disabled={rowBusy}>删除</Button>
        </div>
      </details>
    </div>
  )
}
