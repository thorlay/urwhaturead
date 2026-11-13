import { useCallback, useReducer, useRef } from 'react'
import type { ArticleDetail } from '../types'
import type { SetStateAction } from 'react'
import { readerReducer, type ReaderState } from '../lib/reader-state'

export function useReaderState() {
  const streamScrollYRef = useRef<number | null>(null)
  const articleRequestSeqRef = useRef(0)
  const summaryRequestSeqRef = useRef(0)
  const invalidateReaderRequests = useCallback(() => {
    ++articleRequestSeqRef.current
    ++summaryRequestSeqRef.current
  }, [])
  const [state, dispatch] = useReducer(readerReducer, undefined, (): ReaderState => ({
    mode: 'list',
    article: null,
    loadingArticle: false,
    articleError: null,
    selection: { kind: 'none' },
    sidebarOpen: typeof window === 'undefined' || !window.matchMedia('(max-width: 980px)').matches,
  }))
  const openReaderArticle = useCallback((id: number) => {
    if (state.mode === 'list') streamScrollYRef.current = window.scrollY
    invalidateReaderRequests()
    dispatch({ type: 'open-article', id })
  }, [invalidateReaderRequests, state.mode])
  const openReaderBriefing = useCallback((mode: 'split' | 'immersive' = 'split') => {
    if (state.mode === 'list') streamScrollYRef.current = window.scrollY
    invalidateReaderRequests()
    dispatch({ type: 'open-briefing', mode })
  }, [invalidateReaderRequests, state.mode])
  const closeReader = useCallback(() => {
    invalidateReaderRequests()
    dispatch({ type: 'close' })
    const scrollY = streamScrollYRef.current
    if (state.mode !== 'list' && scrollY !== null) {
      window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'auto' }))
    }
  }, [invalidateReaderRequests, state.mode])
  const enterImmersiveReader = useCallback(() => {
    if (state.mode === 'list') streamScrollYRef.current = window.scrollY
    dispatch({ type: 'immerse' })
  }, [state.mode])
  const setShowSubscriptionSidebar = useCallback((open: SetStateAction<boolean>) => dispatch({ type: 'sidebar', open }), [])
  // Selection-only operations are used when filters or cached briefing data change.
  const setSelectedArticleID = useCallback((id: SetStateAction<number | null>) => dispatch({ type: 'select-article', id }), [])
  const setSelectedFeedBriefing = useCallback((selected: SetStateAction<boolean>) => dispatch({ type: 'select-briefing', selected }), [])
  const setSelectedArticle = useCallback((value: SetStateAction<ArticleDetail | null>) => dispatch({ type: 'article', value }), [])
  const setLoadingArticle = useCallback((value: SetStateAction<boolean>) => dispatch({ type: 'loading', value }), [])
  const setArticleError = useCallback((value: SetStateAction<string | null>) => dispatch({ type: 'error', value }), [])
  return {
    streamScrollYRef,
    articleRequestSeqRef,
    summaryRequestSeqRef,
    readerMode: state.mode,
    selectedArticle: state.selection.kind === 'article' && state.article?.id === state.selection.id ? state.article : null,
    loadingArticle: state.loadingArticle,
    articleError: state.articleError,
    setSelectedArticle,
    setLoadingArticle,
    setArticleError,
    readerView: state.mode === 'immersive' ? 'detail' as const : 'stream' as const,
    showFloatingReader: state.mode === 'split',
    selectedArticleID: state.selection.kind === 'article' ? state.selection.id : null,
    selectedFeedBriefing: state.selection.kind === 'briefing',
    showSubscriptionSidebar: state.sidebarOpen,
    setShowSubscriptionSidebar,
    setSelectedArticleID,
    setSelectedFeedBriefing,
    openReaderArticle,
    openReaderBriefing,
    closeReader,
    enterImmersiveReader,
  }
}

export type ReaderStateController = ReturnType<typeof useReaderState>
