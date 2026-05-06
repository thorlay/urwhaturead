import { useEffect } from 'react'

type UseReaderLocalPersistenceParams = {
  aiModel: string
  readArticleIDs: number[]
  favoriteArticleIDs: number[]
  aiModelStorageKey: string
  readArticleStorageKey: string
  favoriteArticleStorageKey: string
  maxStoredReadArticles: number
  maxStoredFavoriteArticles: number
}

export function useReaderLocalPersistence({
  aiModel,
  readArticleIDs,
  favoriteArticleIDs,
  aiModelStorageKey,
  readArticleStorageKey,
  favoriteArticleStorageKey,
  maxStoredReadArticles,
  maxStoredFavoriteArticles,
}: UseReaderLocalPersistenceParams) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(aiModelStorageKey, aiModel)
  }, [aiModel, aiModelStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (readArticleIDs.length === 0) {
      window.localStorage.removeItem(readArticleStorageKey)
      return
    }
    window.localStorage.setItem(
      readArticleStorageKey,
      JSON.stringify(readArticleIDs.slice(0, maxStoredReadArticles)),
    )
  }, [maxStoredReadArticles, readArticleIDs, readArticleStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (favoriteArticleIDs.length === 0) {
      window.localStorage.removeItem(favoriteArticleStorageKey)
      return
    }
    window.localStorage.setItem(
      favoriteArticleStorageKey,
      JSON.stringify(favoriteArticleIDs.slice(0, maxStoredFavoriteArticles)),
    )
  }, [favoriteArticleIDs, favoriteArticleStorageKey, maxStoredFavoriteArticles])
}
