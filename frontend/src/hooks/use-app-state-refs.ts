import type { ReaderStateController } from './use-reader-state'
import { useRef } from 'react'
import type { ReaderSession } from '../lib/app-domain'

export function useAppStateRefs(reader: Pick<ReaderStateController, 'articleRequestSeqRef' | 'summaryRequestSeqRef' | 'streamScrollYRef'>) {
  const floatingDetailRef = useRef<HTMLElement | null>(null)
  const sourceSelectAllRef = useRef<HTMLInputElement | null>(null)
  const sourceContextMenuRef = useRef<HTMLDivElement | null>(null)
  const feedAIMoreRef = useRef<HTMLDivElement | null>(null)
  const feedBriefingCacheAttemptedRef = useRef<Map<string, number>>(new Map())
  const sidebarSourceItemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const previousSidebarSourceItemRectsRef = useRef<Map<number, DOMRect>>(new Map())
  const previousSidebarSourceIDsRef = useRef<number[]>([])
  const feedAutoLoadRef = useRef<HTMLDivElement | null>(null)
  const sidebarTagFilterTimerRef = useRef<number | null>(null)
  const feedAutoLoadCooldownRef = useRef(0)
  const feedRequestSeqRef = useRef(0)
  const { articleRequestSeqRef, summaryRequestSeqRef, streamScrollYRef } = reader
  const summaryTaskNotifiedRef = useRef<Set<string>>(new Set())
  const readerSessionRef = useRef<ReaderSession | null>(null)

  return {
    floatingDetailRef,
    sourceSelectAllRef,
    sourceContextMenuRef,
    feedAIMoreRef,
    feedBriefingCacheAttemptedRef,
    sidebarSourceItemRefs,
    previousSidebarSourceItemRectsRef,
    previousSidebarSourceIDsRef,
    feedAutoLoadRef,
    sidebarTagFilterTimerRef,
    feedAutoLoadCooldownRef,
    streamScrollYRef,
    feedRequestSeqRef,
    articleRequestSeqRef,
    summaryRequestSeqRef,
    summaryTaskNotifiedRef,
    readerSessionRef,
  }
}

export type AppStateRefs = ReturnType<typeof useAppStateRefs>
