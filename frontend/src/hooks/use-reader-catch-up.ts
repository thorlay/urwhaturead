import { useCallback, useEffect, useRef, useState } from 'react'
import { listFeed } from '../api'
import { catchUpCheckpointStorageKey, type Notice } from '../lib/app-domain'
import type { FeedBriefingGenerationRequest } from './use-feed-briefing-actions'

const defaultCatchUpWindowMs = 24 * 60 * 60 * 1000
const catchUpBriefingLimit = 30

type UseReaderCatchUpParams = {
  active: boolean
  aiModel: string
  generateFeedBriefing: (request: FeedBriefingGenerationRequest) => Promise<boolean>
  openFeedBriefing: () => void
  setNotice: (notice: Notice | null) => void
  toErrorMessage: (error: unknown) => string
}

function initialCheckpoint(): string {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(catchUpCheckpointStorageKey)?.trim()
    if (stored && Number.isFinite(Date.parse(stored))) {
      return new Date(stored).toISOString()
    }
  }
  return new Date(Date.now() - defaultCatchUpWindowMs).toISOString()
}

export function useReaderCatchUp({
  active,
  aiModel,
  generateFeedBriefing,
  openFeedBriefing,
  setNotice,
  toErrorMessage,
}: UseReaderCatchUpParams) {
  const [checkpoint, setCheckpoint] = useState(initialCheckpoint)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)

  const refresh = useCallback(async () => {
    const requestID = ++requestSequence.current
    try {
      setLoading(true)
      setError(null)
      const response = await listFeed({ limit: 1, since: checkpoint })
      if (requestID !== requestSequence.current) return
      setCount(response.meta.total_count ?? response.data.length)
    } catch (caught) {
      if (requestID !== requestSequence.current) return
      setError(toErrorMessage(caught))
    } finally {
      if (requestID === requestSequence.current) {
        setLoading(false)
      }
    }
  }, [checkpoint, toErrorMessage])

  const generateCatchUpBriefing = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await listFeed({ limit: catchUpBriefingLimit, since: checkpoint })
      const totalCount = response.meta.total_count ?? response.data.length
      setCount(totalCount)
      const articleIDs = response.data.map((item) => item.id)
      if (articleIDs.length === 0) {
        setNotice({ kind: 'info', text: '上次处理后没有新增文章。' })
        return
      }

      const succeeded = await generateFeedBriefing({
        articleIDs,
        scopeLabel: `补课速览 · ${totalCount} 篇新增`,
        taskKey: `catch-up|${aiModel.trim().toLowerCase()}|${checkpoint}|${articleIDs.join(',')}`,
        title: '补课速览',
      })
      if (succeeded) {
        openFeedBriefing()
      }
    } catch (caught) {
      const message = toErrorMessage(caught)
      setError(message)
      setNotice({ kind: 'error', text: `生成补课速览失败: ${message}` })
    } finally {
      setLoading(false)
    }
  }, [aiModel, checkpoint, generateFeedBriefing, openFeedBriefing, setNotice, toErrorMessage])

  const markCaughtUp = useCallback(() => {
    const nextCheckpoint = new Date().toISOString()
    window.localStorage.setItem(catchUpCheckpointStorageKey, nextCheckpoint)
    ++requestSequence.current
    setCheckpoint(nextCheckpoint)
    setCount(0)
    setError(null)
    setLoading(false)
    setNotice({ kind: 'info', text: '已将当前时间标记为处理完成。' })
  }, [setNotice])

  useEffect(() => {
    if (!active) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [active, refresh])

  return {
    catchUpCheckpoint: checkpoint,
    catchUpCount: count,
    catchUpLoading: loading,
    catchUpError: error,
    refreshCatchUp: refresh,
    generateCatchUpBriefing,
    markCaughtUp,
  }
}
