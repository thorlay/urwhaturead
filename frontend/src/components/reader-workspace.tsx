import { lazy, Suspense, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ReaderFeedPanel, type ReaderFeedPanelProps } from '@/components/reader-feed-panel'
import { ReaderSubscriptionSidebar, type ReaderSubscriptionSidebarProps } from '@/components/reader-subscription-sidebar'
import type { ReaderDetailPanelProps } from '@/components/reader-detail-panel'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

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
  const split = showFloatingReader && readerView === 'stream'

  return (
    <>
      <div className={`mobile-reader-toolbar ${showSubscriptionSidebar ? 'is-open' : ''}`}>
        <Button
          type="button"
          variant={showSubscriptionSidebar ? 'default' : 'outline'}
          size="sm"
          aria-label={showSubscriptionSidebar ? '收起来源与标签' : '打开来源与标签'}
          onClick={onToggleSubscriptionSidebar}
        >
          {showSubscriptionSidebar ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
          {showSubscriptionSidebar ? '收起来源' : '来源'}
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

      <main className={`reader-layout ${split ? 'reader-layout-split' : ''}`}>
        <div className={`reader-stack ${showSubscriptionSidebar ? 'sidebar-open' : 'sidebar-closed'}`}>
          <ReaderSubscriptionSidebar {...sidebarProps} />
          <ReaderFeedPanel {...feedProps} sourceControl={split && <SplitReaderSources sidebarProps={sidebarProps} />} />
        </div>

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
      </main>
    </>
  )
}

function SplitReaderSources({ sidebarProps }: { sidebarProps: ReaderSubscriptionSidebarProps }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 981px)')
    const closeOnMobile = () => { if (!desktop.matches) setOpen(false) }
    desktop.addEventListener('change', closeOnMobile)
    return () => desktop.removeEventListener('change', closeOnMobile)
  }, [])

  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="split-source-trigger" aria-label="选择订阅源">
          <PanelLeftOpen aria-hidden="true" />来源
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="reader-sources-sheet" aria-describedby={undefined} onEscapeKeyDown={(event) => event.stopPropagation()}>
        <SheetTitle>订阅源</SheetTitle>
        <ReaderSubscriptionSidebar
          {...sidebarProps}
          showSubscriptionSidebar
          onRegisterSidebarSourceItemRef={() => {}}
          onApplySourceFilterFromSidebar={(...args) => { sidebarProps.onApplySourceFilterFromSidebar(...args); setOpen(false) }}
          onApplySourceGroupFilterFromSidebar={(group) => { sidebarProps.onApplySourceGroupFilterFromSidebar(group); setOpen(false) }}
        />
      </SheetContent>
    </Sheet>
  )
}
