import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { adminLogin as adminLoginRequest, adminLogout as adminLogoutRequest, getAdminSession } from '../api'
import type { AppTab, Notice, ReaderView } from '../lib/app-domain'
import { toErrorMessage } from '../lib/app-utils'

type UseAdminAccessParams = {
  activeTab: AppTab
  setActiveTab: Dispatch<SetStateAction<AppTab>>
  setReaderView: Dispatch<SetStateAction<ReaderView>>
  setShowFloatingReader: Dispatch<SetStateAction<boolean>>
  setNotice: Dispatch<SetStateAction<Notice | null>>
}

export function useAdminAccess({
  activeTab,
  setActiveTab,
  setReaderView,
  setShowFloatingReader,
  setNotice,
}: UseAdminAccessParams) {
  const [adminAuthEnabled, setAdminAuthEnabled] = useState(true)
  const [adminAuthenticated, setAdminAuthenticated] = useState(false)

  const refreshAdminSession = useCallback(async () => {
    try {
      const response = await getAdminSession()
      setAdminAuthEnabled(Boolean(response.data.enabled))
      setAdminAuthenticated(Boolean(response.data.authenticated))
    } catch {
      setAdminAuthEnabled(true)
      setAdminAuthenticated(false)
    }
  }, [])

  const canAccessManagement = !adminAuthEnabled || adminAuthenticated

  const onAdminLogin = useCallback(async () => {
    if (typeof window === 'undefined') {
      return
    }

    const username = window.prompt('管理员账号', 'admin')?.trim() ?? ''
    if (!username) {
      return
    }
    const password = window.prompt(`管理员密码 (${username})`) ?? ''
    if (!password) {
      setNotice({ kind: 'error', text: '管理员密码不能为空。' })
      return
    }

    try {
      await adminLoginRequest(username, password)
      setAdminAuthenticated(true)
      setNotice({ kind: 'info', text: '管理员登录成功。' })
    } catch (error) {
      setNotice({ kind: 'error', text: `管理员登录失败: ${toErrorMessage(error)}` })
    }
  }, [setNotice])

  const onAdminLogout = useCallback(async () => {
    try {
      await adminLogoutRequest()
    } catch {
      // keep logout UX idempotent
    }
    try {
      window.localStorage.removeItem('quick_admin_token')
    } catch {
      // ignore storage failure
    }
    setAdminAuthenticated(false)
    setNotice({ kind: 'info', text: '已退出管理权限。' })
  }, [setNotice])

  useEffect(() => {
    if (canAccessManagement || activeTab !== 'sources') {
      return
    }
    setActiveTab('reader')
    setReaderView('stream')
    setShowFloatingReader(false)
  }, [activeTab, canAccessManagement, setActiveTab, setReaderView, setShowFloatingReader])

  useEffect(() => {
    function handleAdminLoginShortcut(event: KeyboardEvent) {
      // Hidden entry: Ctrl/Cmd + Shift + L opens admin login prompt.
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.code !== 'KeyL') {
        return
      }
      event.preventDefault()
      void onAdminLogin()
    }

    window.addEventListener('keydown', handleAdminLoginShortcut)
    return () => window.removeEventListener('keydown', handleAdminLoginShortcut)
  }, [onAdminLogin])

  return {
    adminAuthEnabled,
    adminAuthenticated,
    canAccessManagement,
    refreshAdminSession,
    onAdminLogin,
    onAdminLogout,
  }
}
