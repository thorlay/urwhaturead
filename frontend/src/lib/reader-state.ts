import type { ArticleDetail } from '../types'

export type ReaderMode = 'list' | 'split' | 'immersive'
export type ReaderSelection = { kind: 'none' } | { kind: 'article'; id: number } | { kind: 'briefing' }

export type ReaderState = {
  mode: ReaderMode
  selection: ReaderSelection
  article: ArticleDetail | null
  loadingArticle: boolean
  articleError: string | null
  sidebarOpen: boolean
}

export type ReaderAction =
  | { type: 'open-article'; id: number }
  | { type: 'open-briefing'; mode: 'split' | 'immersive' }
  | { type: 'article'; value: ArticleDetail | null | ((previous: ArticleDetail | null) => ArticleDetail | null) }
  | { type: 'loading'; value: boolean | ((previous: boolean) => boolean) }
  | { type: 'error'; value: string | null | ((previous: string | null) => string | null) }
  | { type: 'close' }
  | { type: 'immerse' }
  | { type: 'select-article'; id: number | null | ((previous: number | null) => number | null) }
  | { type: 'select-briefing'; selected: boolean | ((previous: boolean) => boolean) }
  | { type: 'sidebar'; open: boolean | ((previous: boolean) => boolean) }

export function readerReducer(state: ReaderState, action: ReaderAction): ReaderState {
  switch (action.type) {
    case 'open-article':
      return { ...state, mode: 'split', selection: { kind: 'article', id: action.id }, article: null, loadingArticle: true, articleError: null, sidebarOpen: false }
    case 'open-briefing':
      return { ...state, mode: action.mode, selection: { kind: 'briefing' }, article: null, loadingArticle: false, articleError: null, sidebarOpen: false }
    case 'close':
      // Keep the list highlight when closing or leaving the reader.
      return { ...state, mode: 'list', loadingArticle: false }
    case 'immerse':
      return { ...state, mode: 'immersive' }
    case 'select-article': {
      const id = typeof action.id === 'function' ? action.id(state.selection.kind === 'article' ? state.selection.id : null) : action.id
      return { ...state, selection: id === null ? { kind: 'none' } : { kind: 'article', id } }
    }
    case 'select-briefing': {
      const selected = typeof action.selected === 'function' ? action.selected(state.selection.kind === 'briefing') : action.selected
      return { ...state, selection: selected ? { kind: 'briefing' } : state.selection.kind === 'briefing' ? { kind: 'none' } : state.selection }
    }
    case 'article': {
      const article = typeof action.value === 'function' ? action.value(state.article) : action.value
      if (article && (state.selection.kind !== 'article' || article.id !== state.selection.id)) return state
      return { ...state, article }
    }
    case 'loading':
      return { ...state, loadingArticle: typeof action.value === 'function' ? action.value(state.loadingArticle) : action.value }
    case 'error':
      return { ...state, articleError: typeof action.value === 'function' ? action.value(state.articleError) : action.value }
    case 'sidebar':
      return { ...state, sidebarOpen: typeof action.open === 'function' ? action.open(state.sidebarOpen) : action.open }
  }
}
