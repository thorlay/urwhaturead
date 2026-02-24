import { lazy, Suspense } from 'react'
import { Button } from '@/components/ui/button'
import { ReaderFeedPanel, type ReaderFeedPanelProps } from '@/components/reader-feed-panel'
import { ReaderSubscriptionSidebar, type ReaderSubscriptionSidebarProps } from '@/components/reader-subscription-sidebar'
import type { ReaderDetailPanelProps } from '@/components/reader-detail-panel'

const ReaderDetailPanel = lazy(async () => {
  const module = await import('@/components/reader-detail-panel')
  return { default: module.ReaderDetailPanel }
})

export type ReaderWorkspaceProps = {
  showSubscriptionSidebar: boolean
  onToggleSubscriptionSidebar: () => void
  onCloseSubscriptionSidebar: () => void
  sidebarProps: ReaderSubscriptionSidebarProps
  feedProps: ReaderFeedPanelProps
  showFloatingReader: boolean
  readerView: 'stream' | 'detail'
  detailProps: ReaderDetailPanelProps
}

export function ReaderWorkspace(props: ReaderWorkspaceProps) {
  const {
    showSubscriptionSidebar,
    onToggleSubscriptionSidebar,
    onCloseSubscriptionSidebar,
    sidebarProps,
    feedProps,
    showFloatingReader,
    readerView,
    detailProps,
  } = props

  return (
    <>
      <div className="mobile-reader-toolbar">
        <Button
          type="button"
          variant={showSubscriptionSidebar ? 'default' : 'outline'}
          size="sm"
          onClick={onToggleSubscriptionSidebar}
        >
          {showSubscriptionSidebar ? '收起来源' : '来源与标签'}
        </Button>
      </div>

      {showSubscriptionSidebar && (
        <button
          type="button"
          className="mobile-sidebar-backdrop"
          aria-label="关闭来源侧栏"
          onClick={onCloseSubscriptionSidebar}
        />
      )}

      <main className="reader-layout">
        <div className={`reader-stack ${showSubscriptionSidebar ? 'sidebar-open' : 'sidebar-closed'}`}>
          <ReaderSubscriptionSidebar {...sidebarProps} />
          <ReaderFeedPanel {...feedProps} />
        </div>
      </main>

      {(showFloatingReader || readerView === 'detail') && (
        <Suspense
          fallback={
            <section className={`panel detail reader-panel ${readerView === 'detail' ? 'detail-page' : 'detail-floating'}`}>
              <div className="detail-content">
                <div className="skeleton skeleton-title" />
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line short" />
              </div>
            </section>
          }
        >
          <ReaderDetailPanel {...detailProps} />
        </Suspense>
      )}
    </>
  )
}
