import { useEffect } from 'react'

type UseReaderLocalPersistenceParams = {
  aiModel: string
  readArticleIDs: number[]
  aiModelStorageKey: string
  readArticleStorageKey: string
  maxStoredReadArticles: number
}

export function useReaderLocalPersistence({
  aiModel,
  readArticleIDs,
  aiModelStorageKey,
  readArticleStorageKey,
  maxStoredReadArticles,
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
}
