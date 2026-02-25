import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppTab, ReaderView } from '../lib/app-domain'

type UseAppTabActionsParams = {
  canAccessManagement: boolean
  finalizeReaderSession: (reason: 'close' | 'navigate') => void
  setActiveTab: Dispatch<SetStateAction<AppTab>>
  setReaderView: Dispatch<SetStateAction<ReaderView>>
  setShowFloatingReader: Dispatch<SetStateAction<boolean>>
  refreshAll: () => Promise<void>
  onAdminLogout: () => Promise<void>
}

export function useAppTabActions({
  canAccessManagement,
  finalizeReaderSession,
  setActiveTab,
  setReaderView,
  setShowFloatingReader,
  refreshAll,
  onAdminLogout,
}: UseAppTabActionsParams) {
  const onOpenReaderTab = useCallback(() => {
    finalizeReaderSession('close')
    setActiveTab('reader')
    setReaderView('stream')
    setShowFloatingReader(false)
  }, [finalizeReaderSession, setActiveTab, setReaderView, setShowFloatingReader])

  const onOpenSourcesTab = useCallback(() => {
    if (!canAccessManagement) {
      return
    }
    finalizeReaderSession('close')
    setShowFloatingReader(false)
    setReaderView('stream')
    setActiveTab('sources')
  }, [canAccessManagement, finalizeReaderSession, setActiveTab, setReaderView, setShowFloatingReader])

  const onRefreshAllClick = useCallback(() => {
    void refreshAll()
  }, [refreshAll])

  const onAdminLogoutClick = useCallback(() => {
    void onAdminLogout()
  }, [onAdminLogout])

  return {
    onOpenReaderTab,
    onOpenSourcesTab,
    onRefreshAllClick,
    onAdminLogoutClick,
  }
}
