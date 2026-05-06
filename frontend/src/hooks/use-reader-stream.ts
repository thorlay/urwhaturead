import { useMemo } from 'react'
import type { FeedItem } from '../types'

export type ReaderStreamItem =
  | {
      kind: 'article'
      articleID: number
    }
  | {
      kind: 'briefing'
    }

type UseReaderStreamParams = {
  feed: FeedItem[]
  unreadOnly: boolean
  favoriteOnly: boolean
  readArticleIDSet: Set<number>
  favoriteArticleIDSet: Set<number>
  sourceSiteKeyMap: Map<number, string>
  mutedSiteSet: Set<string>
  hasFeedBriefingEntry: boolean
  feedBriefingAnchorArticleIDs: number[]
  selectedFeedBriefing: boolean
  selectedArticleID: number | null
}

export function useReaderStream(params: UseReaderStreamParams) {
  const visibleFeedBase = useMemo(
    () =>
      params.feed.filter((item) => {
        const siteKey = params.sourceSiteKeyMap.get(item.source_id)
        if (!siteKey) return true
        return !params.mutedSiteSet.has(siteKey)
      }),
    [params.feed, params.mutedSiteSet, params.sourceSiteKeyMap],
  )

  const visibleFeed = useMemo(
    () =>
      visibleFeedBase.filter((item) => {
        if (params.unreadOnly && params.readArticleIDSet.has(item.id)) return false
        if (params.favoriteOnly && !params.favoriteArticleIDSet.has(item.id)) return false
        return true
      }),
    [params.favoriteArticleIDSet, params.favoriteOnly, params.readArticleIDSet, params.unreadOnly, visibleFeedBase],
  )

  const feedBriefingAnchorArticleIDSet = useMemo(() => new Set(params.feedBriefingAnchorArticleIDs), [params.feedBriefingAnchorArticleIDs])
  const feedBriefingInsertIndex = useMemo(() => {
    if (!params.hasFeedBriefingEntry) {
      return -1
    }
    if (visibleFeed.length === 0 || feedBriefingAnchorArticleIDSet.size === 0) {
      return 0
    }
    const index = visibleFeed.findIndex((item) => feedBriefingAnchorArticleIDSet.has(item.id))
    return index >= 0 ? index : 0
  }, [params.hasFeedBriefingEntry, visibleFeed, feedBriefingAnchorArticleIDSet])

  const feedBriefingNewArticleCount = useMemo(
    () => (feedBriefingInsertIndex > 0 ? feedBriefingInsertIndex : 0),
    [feedBriefingInsertIndex],
  )

  const readerStreamItems = useMemo<ReaderStreamItem[]>(() => {
    const items: ReaderStreamItem[] = visibleFeed.map((item) => ({
      kind: 'article',
      articleID: item.id,
    }))
    if (!params.hasFeedBriefingEntry) {
      return items
    }
    const insertAt = Math.min(Math.max(feedBriefingInsertIndex, 0), items.length)
    items.splice(insertAt, 0, { kind: 'briefing' })
    return items
  }, [visibleFeed, params.hasFeedBriefingEntry, feedBriefingInsertIndex])

  const selectedFeedIndex = useMemo(() => {
    if (params.selectedFeedBriefing) {
      return readerStreamItems.findIndex((item) => item.kind === 'briefing')
    }
    if (!params.selectedArticleID || params.selectedArticleID <= 0) return -1
    return readerStreamItems.findIndex((item) => item.kind === 'article' && item.articleID === params.selectedArticleID)
  }, [readerStreamItems, params.selectedArticleID, params.selectedFeedBriefing])

  const unreadVisibleCount = useMemo(
    () => visibleFeed.filter((item) => !params.readArticleIDSet.has(item.id)).length,
    [visibleFeed, params.readArticleIDSet],
  )

  const favoriteVisibleCount = useMemo(
    () => visibleFeedBase.filter((item) => params.favoriteArticleIDSet.has(item.id)).length,
    [params.favoriteArticleIDSet, visibleFeedBase],
  )

  return {
    visibleFeed,
    feedBriefingInsertIndex,
    feedBriefingNewArticleCount,
    readerStreamItems,
    selectedFeedIndex,
    unreadVisibleCount,
    favoriteVisibleCount,
  }
}
