import { useMemo } from 'react'
import type { AppliedSourceGroupFilter } from '../lib/app-domain'
import type { Source } from '../types'
import { buildFeedBriefingTaskKey, resolveFeedBriefingScopeLabel } from '../lib/summary-task-utils'

type UseFeedBriefingDerivedParams = {
  sourceFilter: string
  sourceGroupFilter: AppliedSourceGroupFilter | null
  readerSources: Source[]
  visibleFeed: Array<{ id: number }>
  aiModel: string
  tagFilter: string
  keyword: string
  unreadOnly: boolean
  mutedSiteKeys: string[]
  sourceByID: Map<number, Source>
  parseSourceIDFilter: (value: string) => number[]
}

export function useFeedBriefingDerived({
  sourceFilter,
  sourceGroupFilter,
  readerSources,
  visibleFeed,
  aiModel,
  tagFilter,
  keyword,
  unreadOnly,
  mutedSiteKeys,
  sourceByID,
  parseSourceIDFilter,
}: UseFeedBriefingDerivedParams) {
  const sourceFilterIDs = useMemo(() => parseSourceIDFilter(sourceFilter), [parseSourceIDFilter, sourceFilter])
  const activeFeedBriefingSourceIDs = useMemo(
    () => [...sourceFilterIDs].sort((left, right) => left - right),
    [sourceFilterIDs],
  )
  const activeFeedBriefingKeyword = useMemo(() => keyword.trim(), [keyword])
  const activeFeedBriefingMutedSiteKeys = useMemo(
    () => [...mutedSiteKeys].map((item) => item.trim().toLowerCase()).filter(Boolean).sort(),
    [mutedSiteKeys],
  )
  const activeFeedBriefingTaskKey = useMemo(
    () =>
      buildFeedBriefingTaskKey({
        model: aiModel,
        sourceIDs: activeFeedBriefingSourceIDs,
        tag: tagFilter,
        keyword: activeFeedBriefingKeyword,
        unreadOnly,
        mutedSiteKeys: activeFeedBriefingMutedSiteKeys,
      }),
    [aiModel, activeFeedBriefingKeyword, activeFeedBriefingMutedSiteKeys, activeFeedBriefingSourceIDs, tagFilter, unreadOnly],
  )
  const activeFeedBriefingScopeLabel = useMemo(
    () => resolveFeedBriefingScopeLabel(activeFeedBriefingSourceIDs, sourceByID, tagFilter),
    [activeFeedBriefingSourceIDs, sourceByID, tagFilter],
  )
  const visibleFeedArticleIDs = useMemo(() => visibleFeed.map((item) => item.id), [visibleFeed])
  const activeFeedBriefingAnchorArticleIDs = useMemo(() => visibleFeed.slice(0, 30).map((item) => item.id), [visibleFeed])
  const sourceFilterSelectValue = useMemo(() => {
    if (sourceGroupFilter) return ''
    if (sourceFilterIDs.length !== 1) return ''
    return String(sourceFilterIDs[0])
  }, [sourceFilterIDs, sourceGroupFilter])
  const sourceFilterChipLabel = useMemo(() => {
    if (!sourceFilter) return ''
    if (sourceGroupFilter) {
      const prefix = sourceGroupFilter.kind === 'site' || sourceGroupFilter.key.startsWith('site:') ? '站点' : '标签'
      return `${prefix}: ${sourceGroupFilter.label}`
    }
    if (sourceFilterIDs.length === 1) {
      const matched = readerSources.find((item) => item.id === sourceFilterIDs[0])
      return matched ? `来源: ${matched.name}` : `来源: ${sourceFilterIDs[0]}`
    }
    return `来源: ${sourceFilterIDs.length} 个来源`
  }, [sourceFilter, sourceGroupFilter, sourceFilterIDs, readerSources])

  return {
    sourceFilterIDs,
    activeFeedBriefingSourceIDs,
    activeFeedBriefingKeyword,
    activeFeedBriefingTaskKey,
    activeFeedBriefingScopeLabel,
    visibleFeedArticleIDs,
    activeFeedBriefingAnchorArticleIDs,
    sourceFilterSelectValue,
    sourceFilterChipLabel,
  }
}
