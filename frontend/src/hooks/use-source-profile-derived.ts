import { useMemo } from 'react'
import type { Source, SourceStatus } from '../types'

type UseSourceProfileDerivedParams = {
  sourceProfileSource: Source | null
  sourceStatusMap: Map<number, SourceStatus>
  resolveSourceHealth: (source: Source, sourceStatusMap: Map<number, SourceStatus>) => SourceStatus['health']
  sourceTagList: (source: Pick<Source, 'tags'>) => string[]
  availableTags: string[]
  sourceProfileTagInput: string
  parseSourceTagInput: (input: string) => string[]
}

export function useSourceProfileDerived({
  sourceProfileSource,
  sourceStatusMap,
  resolveSourceHealth,
  sourceTagList,
  availableTags,
  sourceProfileTagInput,
  parseSourceTagInput,
}: UseSourceProfileDerivedParams) {
  const sourceProfileStatus = sourceProfileSource ? sourceStatusMap.get(sourceProfileSource.id) ?? null : null
  const sourceProfileHealth = sourceProfileSource ? resolveSourceHealth(sourceProfileSource, sourceStatusMap) : null
  const sourceProfileTags = useMemo(() => sourceTagList(sourceProfileSource ?? { tags: [] }), [sourceProfileSource, sourceTagList])
  const sourceProfileTagSet = useMemo(() => new Set(sourceProfileTags), [sourceProfileTags])

  const sourceProfileTagCandidates = useMemo(() => {
    const keyword = sourceProfileTagInput.trim().toLowerCase()
    return availableTags.filter((tag) => {
      if (sourceProfileTagSet.has(tag)) {
        return false
      }
      if (!keyword) {
        return true
      }
      return tag.includes(keyword)
    })
  }, [availableTags, sourceProfileTagInput, sourceProfileTagSet])

  const sourceProfileTagDrafts = useMemo(
    () => parseSourceTagInput(sourceProfileTagInput).filter((tag) => !sourceProfileTagSet.has(tag)),
    [parseSourceTagInput, sourceProfileTagInput, sourceProfileTagSet],
  )

  return {
    sourceProfileStatus,
    sourceProfileHealth,
    sourceProfileTags,
    sourceProfileTagCandidates,
    sourceProfileTagDrafts,
  }
}
