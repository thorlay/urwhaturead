import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { Source } from '../types'

type ReaderFeedFiltersProps = {
  showFeedSearch: boolean
  showAdvancedFilters: boolean
  hasActiveFilters: boolean
  keyword: string
  tagFilter: string
  sourceFilter: string
  mutedSiteKeys: string[]
  availableTags: string[]
  readerSources: Source[]
  sourceFilterSelectValue: string
  sourceFilterChipLabel: string
  onApplyFilters: () => void
  onToggleAdvancedFilters: () => void
  onChangeKeyword: (value: string) => void
  onChangeTagFilter: (value: string) => void
  onChangeSourceFilter: (value: string) => void
  onClearFilters: () => void
  onRemoveFilter: (type: 'keyword' | 'tag' | 'source' | 'muted_sites' | 'unread' | 'favorite') => void
  unreadOnly: boolean
  favoriteOnly: boolean
}

export function ReaderFeedFilters(props: ReaderFeedFiltersProps) {
  const {
    showFeedSearch,
    showAdvancedFilters,
    hasActiveFilters,
    keyword,
    tagFilter,
    sourceFilter,
    mutedSiteKeys,
    availableTags,
    readerSources,
    sourceFilterSelectValue,
    sourceFilterChipLabel,
    onApplyFilters,
    onToggleAdvancedFilters,
    onChangeKeyword,
    onChangeTagFilter,
    onChangeSourceFilter,
    onClearFilters,
    onRemoveFilter,
    unreadOnly,
    favoriteOnly,
  } = props

  return (
    <>
      {showFeedSearch && (
        <>
          <div className="feed-filters">
            <Input
              value={keyword}
              onChange={(event) => onChangeKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onApplyFilters()
                }
              }}
              placeholder="搜索标题/摘要"
            />
            <div className="feed-filter-actions">
              <Button type="button" onClick={onApplyFilters}>
                搜索
              </Button>
              <Button type="button" variant="outline" onClick={onToggleAdvancedFilters}>
                {showAdvancedFilters ? '收起筛选' : '筛选'}
              </Button>
            </div>
          </div>

          {showAdvancedFilters && (
            <div className="feed-filters-advanced">
              <Select value={tagFilter} onChange={(event) => onChangeTagFilter(event.target.value)}>
                <option value="">全部标签</option>
                {availableTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </Select>
              <Select value={sourceFilterSelectValue} onChange={(event) => onChangeSourceFilter(event.target.value)}>
                <option value="">全部来源</option>
                {readerSources.map((source) => (
                  <option key={source.id} value={String(source.id)}>
                    {source.name}
                  </option>
                ))}
              </Select>
              <Button type="button" variant="outline" onClick={onClearFilters}>
                清空筛选
              </Button>
            </div>
          )}
        </>
      )}

      {hasActiveFilters && (
        <div className="filter-chips">
          {keyword.trim() && (
            <button type="button" className="chip" onClick={() => onRemoveFilter('keyword')}>
              关键词: {keyword.trim()} ×
            </button>
          )}
          {tagFilter && (
            <button type="button" className="chip" onClick={() => onRemoveFilter('tag')}>
              标签: {tagFilter} ×
            </button>
          )}
          {sourceFilter && (
            <button type="button" className="chip" onClick={() => onRemoveFilter('source')}>
              {sourceFilterChipLabel} ×
            </button>
          )}
          {unreadOnly && (
            <button type="button" className="chip" onClick={() => onRemoveFilter('unread')}>
              仅未读 ×
            </button>
          )}
          {favoriteOnly && (
            <button type="button" className="chip" onClick={() => onRemoveFilter('favorite')}>
              仅收藏 ×
            </button>
          )}
          {mutedSiteKeys.length > 0 && (
            <button type="button" className="chip" onClick={() => onRemoveFilter('muted_sites')}>
              已隐藏网站: {mutedSiteKeys.length} ×
            </button>
          )}
        </div>
      )}
    </>
  )
}
