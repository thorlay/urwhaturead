import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppTab } from '../lib/app-domain'

type UseAppTabActionsParams = {
  canAccessManagement: boolean
  finalizeReaderSession: (reason: 'close' | 'navigate') => void
  setActiveTab: Dispatch<SetStateAction<AppTab>>
  closeReader: () => void
  refreshAll: () => Promise<void>
  onAdminLogout: () => Promise<void>
}

export function useAppTabActions({
  canAccessManagement,
  finalizeReaderSession,
  setActiveTab,
  closeReader,
  refreshAll,
  onAdminLogout,
}: UseAppTabActionsParams) {
  const onOpenReaderTab = useCallback(() => {
    finalizeReaderSession('close')
    setActiveTab('reader')
    closeReader()
  }, [finalizeReaderSession, setActiveTab, closeReader])

  const onOpenAITab = useCallback(() => {
    finalizeReaderSession('close')
    closeReader()
    setActiveTab('ai')
  }, [finalizeReaderSession, setActiveTab, closeReader])

  const onOpenSourcesTab = useCallback(() => {
    if (!canAccessManagement) {
      return
    }
    finalizeReaderSession('close')
    closeReader()
    setActiveTab('sources')
  }, [canAccessManagement, finalizeReaderSession, setActiveTab, closeReader])

  const onRefreshAllClick = useCallback(() => {
    void refreshAll()
  }, [refreshAll])

  const onAdminLogoutClick = useCallback(() => {
    void onAdminLogout()
  }, [onAdminLogout])

  return {
    onOpenReaderTab,
    onOpenAITab,
    onOpenSourcesTab,
    onRefreshAllClick,
    onAdminLogoutClick,
  }
}
