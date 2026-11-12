import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ReaderWorkspaceProps } from '@/components/reader-workspace'

type UseReaderWorkspacePropsParams = {
  showSubscriptionSidebar: boolean
  setShowSubscriptionSidebar: Dispatch<SetStateAction<boolean>>
  sidebarProps: ReaderWorkspaceProps['sidebarProps']
  feedProps: ReaderWorkspaceProps['feedProps']
  showFloatingReader: ReaderWorkspaceProps['showFloatingReader']
  readerView: ReaderWorkspaceProps['readerView']
  detailProps: ReaderWorkspaceProps['detailProps']
}

export function useReaderWorkspaceProps(params: UseReaderWorkspacePropsParams): ReaderWorkspaceProps {
  const { setShowSubscriptionSidebar, feedProps } = params
  const { onOpenArticle, onOpenFeedBriefing } = feedProps
  const openArticle = useCallback((articleID: number) => {
    setShowSubscriptionSidebar(false)
    return onOpenArticle(articleID)
  }, [setShowSubscriptionSidebar, onOpenArticle])
  const openFeedBriefing = useCallback(() => {
    setShowSubscriptionSidebar(false)
    onOpenFeedBriefing()
  }, [setShowSubscriptionSidebar, onOpenFeedBriefing])

  return {
    showSubscriptionSidebar: params.showSubscriptionSidebar,
    onToggleSubscriptionSidebar: () => params.setShowSubscriptionSidebar((value) => !value),
    onCloseSubscriptionSidebar: () => params.setShowSubscriptionSidebar(false),
    sidebarProps: params.sidebarProps,
    feedProps: { ...params.feedProps, onOpenArticle: openArticle, onOpenFeedBriefing: openFeedBriefing },
    showFloatingReader: params.showFloatingReader,
    readerView: params.readerView,
    detailProps: params.detailProps,
  }
}
