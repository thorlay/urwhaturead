import { useMemo } from 'react'
import type { Source, SourceStatus } from '../types'

type UseSourcesIndexParams = {
  sources: Source[]
  sourceStatus: SourceStatus[]
  mutedSiteKeys: string[]
  readArticleIDs: number[]
  favoriteArticleIDs: number[]
  sourceTagList: (source: Pick<Source, 'tags'>) => string[]
  resolveSourceSiteKey: (source: Pick<Source, 'site_key' | 'rss_url'>) => string
}

export function useSourcesIndex({
  sources,
  sourceStatus,
  mutedSiteKeys,
  readArticleIDs,
  favoriteArticleIDs,
  sourceTagList,
  resolveSourceSiteKey,
}: UseSourcesIndexParams) {
  const availableTags = useMemo(() => {
    const values = sources.flatMap((source) => sourceTagList(source))
    return Array.from(new Set(values)).sort()
  }, [sourceTagList, sources])

  const sourceSiteKeyMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const source of sources) {
      map.set(source.id, resolveSourceSiteKey(source))
    }
    return map
  }, [resolveSourceSiteKey, sources])

  const sourceByID = useMemo(() => {
    const map = new Map<number, Source>()
    for (const source of sources) {
      map.set(source.id, source)
    }
    return map
  }, [sources])

  const sourceStatusMap = useMemo(() => {
    const map = new Map<number, SourceStatus>()
    for (const item of sourceStatus) {
      map.set(item.source_id, item)
    }
    return map
  }, [sourceStatus])

  const mutedSiteSet = useMemo(() => new Set(mutedSiteKeys), [mutedSiteKeys])
  const readArticleIDSet = useMemo(() => new Set(readArticleIDs), [readArticleIDs])
  const favoriteArticleIDSet = useMemo(() => new Set(favoriteArticleIDs), [favoriteArticleIDs])

  return {
    availableTags,
    sourceSiteKeyMap,
    sourceByID,
    sourceStatusMap,
    mutedSiteSet,
    readArticleIDSet,
    favoriteArticleIDSet,
  }
}

export type SourcesIndex = ReturnType<typeof useSourcesIndex>
