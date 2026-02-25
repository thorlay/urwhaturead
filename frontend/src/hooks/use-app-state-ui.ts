import { useState } from 'react'
import type { Source } from '../types'
import type { AppTab, ReaderView } from '../lib/app-domain'

export function useAppStateUI() {
  const [keyword, setKeyword] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [mutedSiteKeys, setMutedSiteKeys] = useState<string[]>([])
  const [feedTitleOnlyMode, setFeedTitleOnlyMode] = useState(true)
  const [showFeedImages, setShowFeedImages] = useState(false)
  const [showFeedSearch, setShowFeedSearch] = useState(false)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [showFeedAIMoreMenu, setShowFeedAIMoreMenu] = useState(false)
  const [showManageModelPicker, setShowManageModelPicker] = useState(false)

  const [activeTab, setActiveTab] = useState<AppTab>('reader')
  const [readerView, setReaderView] = useState<ReaderView>('stream')
  const [showFloatingReader, setShowFloatingReader] = useState(false)
  const [selectedFeedBriefing, setSelectedFeedBriefing] = useState(false)
  const [expandedThreadComments, setExpandedThreadComments] = useState(false)
  const [threadCommentsNewestFirst, setThreadCommentsNewestFirst] = useState(false)

  const [sourceProfileSource, setSourceProfileSource] = useState<Source | null>(null)
  const [sourceProfileTagPickerOpen, setSourceProfileTagPickerOpen] = useState(false)
  const [sourceProfileTagInput, setSourceProfileTagInput] = useState('')
  const [pendingDeleteSource, setPendingDeleteSource] = useState<Source | null>(null)

  return {
    keyword,
    setKeyword,
    tagFilter,
    setTagFilter,
    sourceFilter,
    setSourceFilter,
    unreadOnly,
    setUnreadOnly,
    mutedSiteKeys,
    setMutedSiteKeys,
    feedTitleOnlyMode,
    setFeedTitleOnlyMode,
    showFeedImages,
    setShowFeedImages,
    showFeedSearch,
    setShowFeedSearch,
    showAdvancedFilters,
    setShowAdvancedFilters,
    showFeedAIMoreMenu,
    setShowFeedAIMoreMenu,
    showManageModelPicker,
    setShowManageModelPicker,
    activeTab,
    setActiveTab,
    readerView,
    setReaderView,
    showFloatingReader,
    setShowFloatingReader,
    selectedFeedBriefing,
    setSelectedFeedBriefing,
    expandedThreadComments,
    setExpandedThreadComments,
    threadCommentsNewestFirst,
    setThreadCommentsNewestFirst,
    sourceProfileSource,
    setSourceProfileSource,
    sourceProfileTagPickerOpen,
    setSourceProfileTagPickerOpen,
    sourceProfileTagInput,
    setSourceProfileTagInput,
    pendingDeleteSource,
    setPendingDeleteSource,
  }
}
