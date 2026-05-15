import { Fragment } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type AppTopbarProps = {
  activeTab: 'reader' | 'ai' | 'sources'
  sourcesCount: number
  aiModel: string
  loadingSources: boolean
  loadingFeed: boolean
  pendingFeedCount: number
  checkingFeedUpdates: boolean
  canAccessManagement: boolean
  showAdminLogout: boolean
  onOpenReaderTab: () => void
  onOpenAITab: () => void
  onOpenSourcesTab: () => void
  onRefreshAll: () => void
  onApplyPendingFeedUpdates: () => void
  onAdminLogout: () => void
}

export function AppTopbar(props: AppTopbarProps) {
  const {
    activeTab,
    sourcesCount,
    aiModel,
    loadingSources,
    loadingFeed,
    pendingFeedCount,
    checkingFeedUpdates,
    canAccessManagement,
    showAdminLogout,
    onOpenReaderTab,
    onOpenAITab,
    onOpenSourcesTab,
    onRefreshAll,
    onApplyPendingFeedUpdates,
    onAdminLogout,
  } = props

  return (
    <Fragment>
      <header className="topbar">
        <div>
          <p className="eyebrow">ur what u read</p>
          <h1>摸摸又鱼鱼</h1>
        </div>
        <div className="topbar-actions">
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              if (value === 'reader') onOpenReaderTab()
              if (value === 'ai') onOpenAITab()
              if (value === 'sources') onOpenSourcesTab()
            }}
          >
            <TabsList className="view-tabs" aria-label="页面">
              <TabsTrigger className="view-tab" value="reader">
                阅读流
              </TabsTrigger>
              <TabsTrigger className="view-tab" value="ai">
                AI
              </TabsTrigger>
              {canAccessManagement && (
                <TabsTrigger className="view-tab" value="sources">
                  管理 ({sourcesCount})
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
          <span className="topbar-model-chip" title={aiModel}>
            <span className="topbar-model-label">模型</span>
            <span className="topbar-model-value">{aiModel || '-'}</span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="topbar-refresh-btn"
            title="只更新当前页面数据，不触发来源强制抓取"
            onClick={onRefreshAll}
            disabled={loadingSources || loadingFeed}
          >
            更新视图
          </Button>
          {activeTab === 'reader' && (
            <div className="topbar-feed-update">
              <span className="topbar-feed-status">
                {pendingFeedCount > 0 ? `新消息 ${pendingFeedCount} 条` : checkingFeedUpdates ? '检查新消息中...' : '已是最新'}
              </span>
              {pendingFeedCount > 0 && (
                <Button type="button" variant="secondary" size="sm" onClick={onApplyPendingFeedUpdates} disabled={loadingFeed}>
                  查看新消息
                </Button>
              )}
            </div>
          )}
          {showAdminLogout && (
            <Button type="button" variant="outline" size="sm" onClick={onAdminLogout}>
              退出管理
            </Button>
          )}
        </div>
      </header>

      {activeTab === 'reader' && pendingFeedCount > 0 && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mobile-feed-update-fab"
          onClick={onApplyPendingFeedUpdates}
          disabled={loadingFeed}
        >
          更新({pendingFeedCount})
        </Button>
      )}
    </Fragment>
  )
}
