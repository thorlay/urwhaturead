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
  return {
    showSubscriptionSidebar: params.showSubscriptionSidebar,
    onToggleSubscriptionSidebar: () => params.setShowSubscriptionSidebar((value) => !value),
    onCloseSubscriptionSidebar: () => params.setShowSubscriptionSidebar(false),
    sidebarProps: params.sidebarProps,
    feedProps: params.feedProps,
    showFloatingReader: params.showFloatingReader,
    readerView: params.readerView,
    detailProps: params.detailProps,
  }
}
