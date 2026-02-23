import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type AppTopbarProps = {
  activeTab: 'reader' | 'sources'
  sourcesCount: number
  loadingSources: boolean
  loadingFeed: boolean
  canAccessManagement: boolean
  showAdminLogout: boolean
  onOpenReaderTab: () => void
  onOpenSourcesTab: () => void
  onRefreshAll: () => void
  onAdminLogout: () => void
}

export function AppTopbar(props: AppTopbarProps) {
  const {
    activeTab,
    sourcesCount,
    loadingSources,
    loadingFeed,
    canAccessManagement,
    showAdminLogout,
    onOpenReaderTab,
    onOpenSourcesTab,
    onRefreshAll,
    onAdminLogout,
  } = props

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">ur what u read</p>
        <h1>摸摸又鱼鱼</h1>
      </div>
      <div className="topbar-actions">
        <div className="view-tabs" role="tablist" aria-label="页面">
          <Button
            type="button"
            variant={activeTab === 'reader' ? 'default' : 'ghost'}
            size="sm"
            className={cn('view-tab', activeTab === 'reader' && 'active')}
            onClick={onOpenReaderTab}
          >
            阅读流
          </Button>
          {canAccessManagement && (
            <Button
              type="button"
              variant={activeTab === 'sources' ? 'default' : 'ghost'}
              size="sm"
              className={cn('view-tab', activeTab === 'sources' && 'active')}
              onClick={onOpenSourcesTab}
            >
              管理 ({sourcesCount})
            </Button>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRefreshAll} disabled={loadingSources || loadingFeed}>
          刷新全部
        </Button>
        {showAdminLogout && (
          <Button type="button" variant="outline" size="sm" onClick={onAdminLogout}>
            退出管理
          </Button>
        )}
      </div>
    </header>
  )
}
