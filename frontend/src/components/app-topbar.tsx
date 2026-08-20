import { Fragment } from 'react'
import { ArrowDown, BookOpenText, LogOut, Radar, RefreshCw, Settings2, Sparkles } from 'lucide-react'
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
        <div className="topbar-brand">
          <span className="topbar-brand-mark" aria-hidden="true">
            <Radar />
          </span>
          <div className="topbar-brand-copy">
            <p className="eyebrow">ur what u read</p>
            <h1>摸摸又鱼鱼</h1>
          </div>
        </div>
        <nav className="topbar-navigation" aria-label="主导航">
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
                <BookOpenText aria-hidden="true" />
                <span>阅读流</span>
              </TabsTrigger>
              <TabsTrigger className="view-tab" value="ai">
                <Sparkles aria-hidden="true" />
                <span>AI</span>
              </TabsTrigger>
              {canAccessManagement && (
                <TabsTrigger className="view-tab" value="sources">
                  <Settings2 aria-hidden="true" />
                  <span>管理</span>
                  <span className="view-tab-count">{sourcesCount}</span>
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        </nav>
        <div className="topbar-actions">
          <span className="topbar-model-chip" title={`当前 AI 模型：${aiModel || '-'}`}>
            <Sparkles className="topbar-model-icon" aria-hidden="true" />
            <span className="topbar-model-label">AI</span>
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
            <RefreshCw className={loadingSources || loadingFeed ? 'is-spinning' : undefined} aria-hidden="true" />
            <span>刷新</span>
          </Button>
          {activeTab === 'reader' && (
            <div className={`topbar-feed-update${pendingFeedCount > 0 ? ' has-pending' : checkingFeedUpdates ? ' is-checking' : ''}`}>
              <span className="topbar-status-dot" aria-hidden="true" />
              <span className="topbar-feed-status">
                {pendingFeedCount > 0 ? `新消息 ${pendingFeedCount} 条` : checkingFeedUpdates ? '检查新消息中...' : '已是最新'}
              </span>
              {pendingFeedCount > 0 && (
                <Button type="button" variant="secondary" size="sm" onClick={onApplyPendingFeedUpdates} disabled={loadingFeed}>
                  <ArrowDown aria-hidden="true" />
                  查看新消息
                </Button>
              )}
            </div>
          )}
          {showAdminLogout && (
            <Button className="topbar-logout-btn" type="button" variant="ghost" size="icon" onClick={onAdminLogout} title="退出管理" aria-label="退出管理">
              <LogOut aria-hidden="true" />
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
