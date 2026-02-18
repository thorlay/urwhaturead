import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  createSource,
  deleteSource,
  getArticle,
  getArticleSummary,
  listFeed,
  listSources,
  listSourceStatus,
  refreshSource,
  summarizeArticle,
  trackArticleThread,
  testSource,
  updateSource,
} from './api'
import type { ArticleDetail, FeedItem, Source, SourceStatus } from './types'
import './App.css'

type Notice = {
  kind: 'info' | 'error'
  text: string
}

type FeedDensity = 'compact' | 'cozy'
type AppTab = 'reader' | 'sources'
type ReaderView = 'stream' | 'detail'
type SourceGroup = {
  siteKey: string
  sources: Source[]
}

const threadPreviewCommentLimit = 3

function App() {
  const floatingDetailRef = useRef<HTMLElement | null>(null)

  const [sources, setSources] = useState<Source[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [selectedArticle, setSelectedArticle] = useState<ArticleDetail | null>(null)
  const [selectedArticleID, setSelectedArticleID] = useState<number | null>(null)
  const [articleSummary, setArticleSummary] = useState('')
  const [articleSummaryMeta, setArticleSummaryMeta] = useState('')
  const [loadingArticleSummary, setLoadingArticleSummary] = useState(false)
  const [articleSummaryError, setArticleSummaryError] = useState<string | null>(null)

  const [loadingSources, setLoadingSources] = useState(false)
  const [loadingFeed, setLoadingFeed] = useState(false)
  const [loadingArticle, setLoadingArticle] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [creatingSource, setCreatingSource] = useState(false)
  const [busySourceID, setBusySourceID] = useState<number | null>(null)

  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [articleError, setArticleError] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [editingSourceID, setEditingSourceID] = useState<number | null>(null)
  const [editSourceName, setEditSourceName] = useState('')
  const [editSourceURL, setEditSourceURL] = useState('')
  const [editSourceCategory, setEditSourceCategory] = useState('')
  const [editSourcePollSec, setEditSourcePollSec] = useState('900')

  const [feedCursor, setFeedCursor] = useState('')
  const [hasMoreFeed, setHasMoreFeed] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [sourceStatus, setSourceStatus] = useState<SourceStatus[]>([])

  const [newSourceName, setNewSourceName] = useState('')
  const [newSourceURL, setNewSourceURL] = useState('')
  const [newSourceCategory, setNewSourceCategory] = useState('general')

  const [keyword, setKeyword] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [mutedSiteKeys, setMutedSiteKeys] = useState<string[]>([])
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [, setNowTick] = useState(Date.now())

  const [activeTab, setActiveTab] = useState<AppTab>('reader')
  const [readerView, setReaderView] = useState<ReaderView>('stream')
  const [showFloatingReader, setShowFloatingReader] = useState(false)
  const [feedDensity, setFeedDensity] = useState<FeedDensity>('cozy')
  const [expandedThreadComments, setExpandedThreadComments] = useState(false)
  const [showSubscriptionSidebar, setShowSubscriptionSidebar] = useState(true)

  const categories = useMemo(() => {
    const values = sources.map((source) => source.category).filter(Boolean)
    return Array.from(new Set(values)).sort()
  }, [sources])

  const sourceSiteKeyMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const source of sources) {
      map.set(source.id, resolveSourceSiteKey(source))
    }
    return map
  }, [sources])

  const sourceGroups = useMemo<SourceGroup[]>(() => {
    const groupMap = new Map<string, Source[]>()
    for (const source of sources) {
      const siteKey = resolveSourceSiteKey(source)
      const bucket = groupMap.get(siteKey)
      if (bucket) {
        bucket.push(source)
      } else {
        groupMap.set(siteKey, [source])
      }
    }

    const groups = Array.from(groupMap.entries()).map(([siteKey, groupedSources]) => ({
      siteKey,
      sources: groupedSources.sort((a, b) => b.id - a.id),
    }))
    groups.sort((a, b) => a.siteKey.localeCompare(b.siteKey))
    return groups
  }, [sources])

  const mutedSiteSet = useMemo(() => new Set(mutedSiteKeys), [mutedSiteKeys])
  const visibleFeed = useMemo(
    () =>
      feed.filter((item) => {
        const siteKey = sourceSiteKeyMap.get(item.source_id)
        if (!siteKey) return true
        return !mutedSiteSet.has(siteKey)
      }),
    [feed, mutedSiteSet, sourceSiteKeyMap],
  )

  const selectedFeedIndex = useMemo(() => {
    if (!selectedArticleID) return -1
    return visibleFeed.findIndex((item) => item.id === selectedArticleID)
  }, [visibleFeed, selectedArticleID])

  const hasActiveFilters = keyword.trim() || categoryFilter || sourceFilter || mutedSiteKeys.length > 0
  const threadComments = selectedArticle?.thread?.comments ?? []
  const hasHiddenThreadComments =
    Boolean(selectedArticle?.thread) && !expandedThreadComments && threadComments.length > threadPreviewCommentLimit
  const visibleThreadComments = expandedThreadComments
    ? threadComments
    : threadComments.slice(0, threadPreviewCommentLimit)

  async function loadSources() {
    try {
      setLoadingSources(true)
      setSourcesError(null)
      const data = await listSources()
      setSources(data)
    } catch (error) {
      const message = toErrorMessage(error)
      setSourcesError(message)
      setNotice({
        kind: 'error',
        text: `加载来源失败: ${message}`,
      })
    } finally {
      setLoadingSources(false)
    }
  }

  async function loadStatus() {
    try {
      setLoadingStatus(true)
      setStatusError(null)
      const response = await listSourceStatus(24)
      setSourceStatus(response.data)
    } catch (error) {
      const message = toErrorMessage(error)
      setStatusError(message)
      setNotice({
        kind: 'error',
        text: `加载来源状态失败: ${message}`,
      })
    } finally {
      setLoadingStatus(false)
    }
  }

  async function refreshStatusIfVisible() {
    if (activeTab !== 'sources') return
    await loadStatus()
  }

  async function loadFeed(
    append = false,
    overrides?: Partial<{ category: string; sourceID: string; keyword: string; cursor: string }>,
  ) {
    try {
      setLoadingFeed(true)
      setFeedError(null)
      const activeCategory = overrides?.category ?? categoryFilter
      const activeSourceID = overrides?.sourceID ?? sourceFilter
      const activeKeyword = (overrides?.keyword ?? keyword).trim()

      const response = await listFeed({
        limit: 20,
        cursor: overrides?.cursor ?? (append ? feedCursor : ''),
        category: activeCategory,
        sourceID: activeSourceID,
        keyword: activeKeyword,
      })

      const articleItems: FeedItem[] = response.data.map((item) => ({ ...item }))

      if (append) {
        setFeed((previous) => [...previous, ...articleItems])
      } else {
        setFeed(articleItems)
      }

      setFeedCursor(response.meta.next_cursor || '')
      setHasMoreFeed(Boolean(response.meta.next_cursor))
    } catch (error) {
      const message = toErrorMessage(error)
      setFeedError(message)
      setNotice({
        kind: 'error',
        text: `加载 feed 失败: ${message}`,
      })
    } finally {
      setLoadingFeed(false)
    }
  }

  async function openArticle(articleID: number) {
    try {
      setLoadingArticle(true)
      setReaderView('stream')
      setShowFloatingReader(true)
      setArticleError(null)
      setSelectedArticleID(articleID)
      setArticleSummary('')
      setArticleSummaryMeta('')
      setArticleSummaryError(null)
      setLoadingArticleSummary(false)
      setExpandedThreadComments(false)

      const detail = await getArticle(articleID)
      setSelectedArticle(detail)

      try {
        const cachedSummary = await getArticleSummary(articleID)
        if (cachedSummary?.data?.summary) {
          setArticleSummary(cachedSummary.data.summary)
          setArticleSummaryMeta(`缓存命中 · ${cachedSummary.data.provider} · ${cachedSummary.data.model}`)
          setArticleSummaryError(null)
        }
      } catch (error) {
        setArticleSummaryError(`读取缓存摘要失败: ${toErrorMessage(error)}`)
      }
    } catch (error) {
      const message = toErrorMessage(error)
      setArticleError(message)
      setNotice({
        kind: 'error',
        text: `加载文章详情失败: ${message}`,
      })
    } finally {
      setLoadingArticle(false)
    }
  }

  async function onSummarizeArticle(refresh = false) {
    if (!selectedArticleID || selectedArticleID <= 0) {
      setNotice({ kind: 'error', text: '当前文章不支持 AI 摘要。' })
      return
    }

    try {
      setLoadingArticleSummary(true)
      setArticleSummaryError(null)
      const response = await summarizeArticle(selectedArticleID, refresh)
      setArticleSummary(response.data.summary)
      setArticleSummaryMeta(
        `${response.data.cache_hit ? '缓存命中' : '新生成'} · ${response.data.provider} · ${response.data.model}`,
      )
      setNotice({ kind: 'info', text: response.data.cache_hit ? '已加载缓存摘要。' : 'AI 摘要已生成。' })
    } catch (error) {
      const message = toErrorMessage(error)
      setArticleSummaryError(message)
      setNotice({ kind: 'error', text: `AI 摘要失败: ${message}` })
    } finally {
      setLoadingArticleSummary(false)
    }
  }

  async function onTrackThread() {
    if (!selectedArticleID) {
      setNotice({ kind: 'error', text: '请先选择文章。' })
      return
    }
    try {
      const response = await trackArticleThread(selectedArticleID)
      setNotice({
        kind: 'info',
        text: response.created
          ? `已开始持续跟踪评论：${response.source.name}`
          : `该帖子已在跟踪中：${response.source.name}`,
      })
      await loadSources()
      await refreshStatusIfVisible()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `持续跟踪失败: ${toErrorMessage(error)}`,
      })
    }
  }

  async function onCreateSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newSourceURL.trim()) {
      setNotice({ kind: 'error', text: '请填写 RSS URL。' })
      return
    }

    try {
      setCreatingSource(true)
      const payload: {
        name?: string
        rss_url: string
        category: string
      } = {
        rss_url: newSourceURL.trim(),
        category: newSourceCategory.trim() || 'general',
      }

      const name = newSourceName.trim()
      if (name) {
        payload.name = name
      }

      await createSource(payload)

      setNewSourceName('')
      setNewSourceURL('')
      setNewSourceCategory('general')
      setNotice({ kind: 'info', text: '来源创建成功。' })
      await loadSources()
      await refreshStatusIfVisible()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `创建来源失败: ${toErrorMessage(error)}`,
      })
    } finally {
      setCreatingSource(false)
    }
  }

  async function onTestSource(sourceID: number) {
    try {
      setBusySourceID(sourceID)
      const result = await testSource(sourceID)
      setNotice({
        kind: 'info',
        text: `测试成功: ${result.title}（${result.item_count} 条）`,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `测试来源失败: ${toErrorMessage(error)}`,
      })
    } finally {
      setBusySourceID(null)
    }
  }

  async function onRefreshSource(sourceID: number) {
    try {
      setBusySourceID(sourceID)
      await refreshSource(sourceID)
      setNotice({
        kind: 'info',
        text: `来源 ${sourceID} 刷新成功。`,
      })
      await loadFeed(false)
      await refreshStatusIfVisible()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `刷新来源失败: ${toErrorMessage(error)}`,
      })
    } finally {
      setBusySourceID(null)
    }
  }

  function onStartEdit(source: Source) {
    setEditingSourceID(source.id)
    setEditSourceName(source.name)
    setEditSourceURL(source.rss_url)
    setEditSourceCategory(source.category)
    setEditSourcePollSec(String(source.poll_interval_sec))
  }

  function onCancelEdit() {
    setEditingSourceID(null)
    setEditSourceName('')
    setEditSourceURL('')
    setEditSourceCategory('')
    setEditSourcePollSec('900')
  }

  async function onSaveSourceEdit(sourceID: number) {
    const name = editSourceName.trim()
    const rssURL = editSourceURL.trim()
    const category = editSourceCategory.trim() || 'general'
    const pollIntervalSec = Number.parseInt(editSourcePollSec, 10)

    if (!name || !rssURL) {
      setNotice({ kind: 'error', text: '名称和 RSS URL 不能为空。' })
      return
    }
    if (Number.isNaN(pollIntervalSec) || pollIntervalSec <= 0) {
      setNotice({ kind: 'error', text: '抓取间隔必须是正整数。' })
      return
    }

    try {
      setBusySourceID(sourceID)
      await updateSource(sourceID, {
        name,
        rss_url: rssURL,
        category,
        poll_interval_sec: pollIntervalSec,
      })
      setNotice({ kind: 'info', text: `来源 ${sourceID} 更新成功。` })
      onCancelEdit()
      await loadSources()
      await loadFeed(false)
      await refreshStatusIfVisible()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `更新来源失败: ${toErrorMessage(error)}`,
      })
    } finally {
      setBusySourceID(null)
    }
  }

  async function onToggleSourceEnabled(source: Source) {
    try {
      setBusySourceID(source.id)
      await updateSource(source.id, { enabled: !source.enabled })
      setNotice({
        kind: 'info',
        text: `来源 ${source.id} 已${source.enabled ? '停用' : '启用'}。`,
      })
      await loadSources()
      await refreshStatusIfVisible()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `切换状态失败: ${toErrorMessage(error)}`,
      })
    } finally {
      setBusySourceID(null)
    }
  }

  async function onDeleteSource(source: Source) {
    if (!window.confirm(`确定删除来源「${source.name}」吗？`)) {
      return
    }

    try {
      setBusySourceID(source.id)
      await deleteSource(source.id)
      if (sourceFilter === String(source.id)) {
        setSourceFilter('')
      }
      if (selectedArticle?.source_id === source.id) {
        setSelectedArticle(null)
        setSelectedArticleID(null)
      }
      setNotice({ kind: 'info', text: `来源 ${source.id} 已删除。` })
      await loadSources()
      await loadFeed(false, sourceFilter === String(source.id) ? { sourceID: '' } : undefined)
      await refreshStatusIfVisible()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `删除来源失败: ${toErrorMessage(error)}`,
      })
    } finally {
      if (editingSourceID === source.id) {
        onCancelEdit()
      }
      setBusySourceID(null)
    }
  }

  function applyFilters() {
    setSelectedArticle(null)
    setSelectedArticleID(null)
    setFeedCursor('')
    void loadFeed(false)
  }

  function clearFilters() {
    setKeyword('')
    setCategoryFilter('')
    setSourceFilter('')
    setMutedSiteKeys([])
    setSelectedArticle(null)
    setSelectedArticleID(null)
    setFeedCursor('')
    void loadFeed(false, {
      category: '',
      sourceID: '',
      keyword: '',
      cursor: '',
    })
  }

  function removeFilter(type: 'keyword' | 'category' | 'source' | 'muted_sites') {
    if (type === 'keyword') {
      setKeyword('')
      void loadFeed(false, { keyword: '' })
      return
    }
    if (type === 'category') {
      setCategoryFilter('')
      void loadFeed(false, { category: '' })
      return
    }
    if (type === 'muted_sites') {
      setMutedSiteKeys([])
      return
    }

    setSourceFilter('')
    void loadFeed(false, { sourceID: '' })
  }

  function toggleSiteMuted(siteKey: string) {
    setMutedSiteKeys((previous) => {
      if (previous.includes(siteKey)) {
        return previous.filter((item) => item !== siteKey)
      }
      return [...previous, siteKey]
    })
  }

  function applySourceFilterFromSidebar(sourceID: string) {
    setSourceFilter(sourceID)
    setSelectedArticle(null)
    setSelectedArticleID(null)
    setFeedCursor('')
    void loadFeed(false, { sourceID })
  }

  async function refreshAll() {
    const tasks = [loadSources(), loadFeed(false)]
    if (activeTab === 'sources') {
      tasks.push(loadStatus())
    }
    await Promise.allSettled(tasks)
    setNotice({ kind: 'info', text: '已刷新最新数据。' })
  }

  function loadMore() {
    if (!feedCursor || loadingFeed) return
    void loadFeed(true)
  }

  useEffect(() => {
    void loadSources()
    void loadFeed(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (activeTab === 'sources' && sourceStatus.length === 0 && !loadingStatus) {
      void loadStatus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  useEffect(() => {
    const validSiteKeys = new Set(sourceGroups.map((group) => group.siteKey))
    setMutedSiteKeys((previous) => previous.filter((siteKey) => validSiteKeys.has(siteKey)))
  }, [sourceGroups])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      if (event.key === 'j' || event.key === 'k') {
        if (visibleFeed.length === 0) return
        event.preventDefault()

        const direction = event.key === 'j' ? 1 : -1
        const baseIndex = selectedFeedIndex >= 0 ? selectedFeedIndex : 0
        const nextIndex = Math.min(Math.max(baseIndex + direction, 0), visibleFeed.length - 1)
        const nextItem = visibleFeed[nextIndex]
        if (nextItem) {
          void openArticle(nextItem.id)
        }
        return
      }

      if (event.key === 'o') {
        if (selectedArticle?.link) {
          event.preventDefault()
          window.open(selectedArticle.link, '_blank', 'noopener,noreferrer')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visibleFeed, selectedFeedIndex, selectedArticle])

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (activeTab !== 'reader' || readerView !== 'stream' || !showFloatingReader) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const panel = floatingDetailRef.current
      if (!panel) return

      const target = event.target as Node | null
      if (target && panel.contains(target)) {
        return
      }
      setShowFloatingReader(false)
    }

    function handleEscKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowFloatingReader(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscKey)
    }
  }, [activeTab, readerView, showFloatingReader])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Quick News Aggregator</p>
          <h1>新闻聚合后台演示</h1>
        </div>
        <div className="topbar-actions">
          <div className="view-tabs" role="tablist" aria-label="页面">
            <button
              className={`ghost-btn view-tab ${activeTab === 'reader' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('reader')
                setReaderView('stream')
                setShowFloatingReader(false)
              }}
            >
              阅读流
            </button>
            <button
              className={`ghost-btn view-tab ${activeTab === 'sources' ? 'active' : ''}`}
              onClick={() => setActiveTab('sources')}
            >
              来源与健康 ({sources.length})
            </button>
          </div>
          <button
            className="ghost-btn"
            onClick={() => void refreshAll()}
            disabled={loadingSources || loadingFeed}
          >
            刷新全部
          </button>
        </div>
      </header>

      {notice && (
        <div className={`notice ${notice.kind}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)}>关闭</button>
        </div>
      )}

      {activeTab === 'reader' && (
        <>
          <main className="reader-layout">
            <div className={`reader-stack ${showSubscriptionSidebar ? 'sidebar-open' : 'sidebar-closed'}`}>
              <aside className={`panel subscription-sidebar ${showSubscriptionSidebar ? 'open' : 'collapsed'}`}>
                <div className="subscription-sidebar-header">
                  {showSubscriptionSidebar && <h3>订阅源</h3>}
                  <button
                    type="button"
                    className="ghost-btn subscription-sidebar-toggle"
                    onClick={() => setShowSubscriptionSidebar((value) => !value)}
                  >
                    {showSubscriptionSidebar ? '收起' : '展开'}
                  </button>
                </div>
                {showSubscriptionSidebar && (
                  <>
                    <button
                      type="button"
                      className={`subscription-item all ${!sourceFilter ? 'active' : ''}`}
                      onClick={() => applySourceFilterFromSidebar('')}
                    >
                      全部来源
                      <span>{sources.length}</span>
                    </button>

                    <div className="subscription-tree">
                      {sourceGroups.map((group) => (
                        <article key={group.siteKey} className="subscription-group">
                          <div className="subscription-group-head">
                            <p className="subscription-group-title">{group.siteKey}</p>
                            <span>{group.sources.length}</span>
                          </div>
                          <div className="subscription-items">
                            {group.sources.map((source) => (
                              <button
                                key={source.id}
                                type="button"
                                className={`subscription-item ${sourceFilter === String(source.id) ? 'active' : ''}`}
                                onClick={() => applySourceFilterFromSidebar(String(source.id))}
                              >
                                <span className="subscription-item-name">{source.name}</span>
                                <span className={`subscription-item-state ${source.enabled ? '' : 'disabled'}`}>
                                  {source.enabled ? 'ON' : 'OFF'}
                                </span>
                              </button>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </aside>

              <section className={`panel feed reader-panel ${showFloatingReader && readerView === 'stream' ? 'feed-with-floating' : ''}`}>
                <div className="feed-header">
                  <h2>聚合流</h2>
                  <div className="density-toggle">
                    <button
                      className={feedDensity === 'compact' ? 'active' : ''}
                      onClick={() => setFeedDensity('compact')}
                    >
                      紧凑
                    </button>
                    <button
                      className={feedDensity === 'cozy' ? 'active' : ''}
                      onClick={() => setFeedDensity('cozy')}
                    >
                      舒适
                    </button>
                  </div>
                </div>

                <div className="feed-filters compact">
                  <input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        applyFilters()
                      }
                    }}
                    placeholder="搜索标题/摘要"
                  />
                  <div className="feed-filter-actions">
                    <button onClick={applyFilters}>搜索</button>
                    <button className="btn-muted" onClick={() => setShowAdvancedFilters((value) => !value)}>
                      {showAdvancedFilters ? '收起筛选' : '筛选'}
                    </button>
                  </div>
                </div>

                {showAdvancedFilters && (
                  <div className="feed-filters-advanced">
                    <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                      <option value="">全部分类</option>
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                    <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                      <option value="">全部来源</option>
                      {sources.map((source) => (
                        <option key={source.id} value={String(source.id)}>
                          {source.name}
                        </option>
                      ))}
                    </select>
                    <button className="btn-muted" onClick={clearFilters}>
                      清空筛选
                    </button>
                  </div>
                )}

                {hasActiveFilters && (
                  <div className="filter-chips">
                    {keyword.trim() && (
                      <button className="chip" onClick={() => removeFilter('keyword')}>
                        关键词: {keyword.trim()} ×
                      </button>
                    )}
                    {categoryFilter && (
                      <button className="chip" onClick={() => removeFilter('category')}>
                        分类: {categoryFilter} ×
                      </button>
                    )}
                    {sourceFilter && (
                      <button className="chip" onClick={() => removeFilter('source')}>
                        来源: {sources.find((item) => String(item.id) === sourceFilter)?.name ?? sourceFilter} ×
                      </button>
                    )}
                    {mutedSiteKeys.length > 0 && (
                      <button className="chip" onClick={() => removeFilter('muted_sites')}>
                        已隐藏网站: {mutedSiteKeys.length} ×
                      </button>
                    )}
                  </div>
                )}

                <div className={`feed-list ${feedDensity}`}>
                  {loadingFeed && visibleFeed.length === 0 && (
                    <>
                      <FeedSkeleton />
                      <FeedSkeleton />
                      <FeedSkeleton />
                    </>
                  )}

                  {feedError && visibleFeed.length === 0 && (
                    <div className="inline-error">
                      <span>聚合流加载失败: {feedError}</span>
                      <button className="ghost-btn" onClick={() => void loadFeed(false)}>
                        重试
                      </button>
                    </div>
                  )}

                  {!loadingFeed && !feedError && visibleFeed.length === 0 && (
                    <p className="hint">{feed.length > 0 ? '当前网站都被临时隐藏了，可点击“恢复全部”。' : '暂无文章'}</p>
                  )}

                  {visibleFeed.map((item) => (
                    <article
                      key={item.id}
                      className={`feed-item ${selectedArticleID === item.id ? 'active' : ''}`}
                      onClick={() => void openArticle(item.id)}
                    >
                      <div className="feed-topline">
                        <span>{item.source_name}</span>
                        <span>{formatTimeAgo(item.published_at ?? item.created_at)}</span>
                      </div>
                      <h3>{item.title}</h3>
                      <p>{truncate(plainText(item.summary), feedDensity === 'compact' ? 95 : 160)}</p>
                    </article>
                  ))}
                </div>

                <div className="feed-footer">
                  <button onClick={loadMore} disabled={!hasMoreFeed || loadingFeed}>
                    {loadingFeed ? '加载中...' : hasMoreFeed ? '加载更多' : '没有更多了'}
                  </button>
                </div>
              </section>
            </div>
          </main>

          {(showFloatingReader || readerView === 'detail') && (
            <section
              ref={floatingDetailRef}
              className={`panel detail reader-panel ${readerView === 'detail' ? 'detail-page' : 'detail-floating'}`}
            >
              <div className="detail-page-header">
                <div className="detail-mode-actions">
                  {readerView === 'detail' ? (
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => {
                        setReaderView('stream')
                        setShowFloatingReader(false)
                      }}
                    >
                      返回列表
                    </button>
                  ) : (
                    <>
                      <button type="button" className="ghost-btn" onClick={() => setShowFloatingReader(false)}>
                        关闭
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => {
                          setReaderView('detail')
                          setShowFloatingReader(false)
                        }}
                        disabled={!selectedArticleID}
                      >
                        沉浸阅读
                      </button>
                    </>
                  )}
                </div>
                <h2>文章详情</h2>
              </div>

              {!selectedArticle && !loadingArticle && !articleError && (
                <div className="hint-group">
                  <p className="hint">请先从列表选择一篇文章</p>
                  <p className="hint">快捷键: j/k 切换文章，o 打开原文</p>
                </div>
              )}

              {loadingArticle && (
                <div className="detail-content">
                  <div className="skeleton skeleton-title" />
                  <div className="skeleton skeleton-line" />
                  <div className="skeleton skeleton-line" />
                  <div className="skeleton skeleton-line short" />
                </div>
              )}

              {articleError && selectedArticleID && !loadingArticle && (
                <div className="inline-error">
                  <span>文章详情加载失败: {articleError}</span>
                  <button className="ghost-btn" onClick={() => void openArticle(selectedArticleID)}>
                    重试
                  </button>
                </div>
              )}

              {selectedArticle && !loadingArticle && (
                <article className="detail-content">
                  <header className="detail-header">
                    <p className="detail-meta">
                      {selectedArticle.source_name} · {formatTimeAgo(selectedArticle.published_at ?? selectedArticle.created_at)}
                    </p>
                    <h3 className="detail-title">{selectedArticle.title}</h3>
                    <div className="detail-toolbar">
                      {selectedArticle.author && <p className="detail-author">作者: {selectedArticle.author}</p>}
                      <div className="detail-toolbar-actions">
                        <a href={selectedArticle.link} target="_blank" rel="noreferrer" className="ghost-btn detail-open-link">
                          打开原文
                        </a>
                        {isTrackableForumLink(selectedArticle.link) && (
                          <button className="ghost-btn" onClick={() => void onTrackThread()}>
                            持续跟踪评论
                          </button>
                        )}
                        {selectedArticleID && selectedArticleID > 0 && (
                          <div className="summary-actions">
                            <button className="ghost-btn" onClick={() => void onSummarizeArticle(false)} disabled={loadingArticleSummary}>
                              {loadingArticleSummary ? '生成中...' : '生成 AI 摘要'}
                            </button>
                            <button className="ghost-btn" onClick={() => void onSummarizeArticle(true)} disabled={loadingArticleSummary}>
                              强制重算
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </header>

                  {articleSummaryError && <p className="hint">AI 摘要错误: {articleSummaryError}</p>}

                  {articleSummary && (
                    <section className="ai-summary">
                      <h4>AI 摘要</h4>
                      {articleSummaryMeta && <p className="hint">{articleSummaryMeta}</p>}
                      <p className="reading-block">{plainTextBlock(articleSummary)}</p>
                    </section>
                  )}

                  {selectedArticle.summary && (
                    <section className="detail-section">
                      <h4>原始摘要</h4>
                      <p className="reading-block">{plainTextBlock(selectedArticle.summary)}</p>
                    </section>
                  )}

                  {selectedArticle.content && (
                    <section className="detail-section">
                      <h4>正文</h4>
                      <p className="reading-block prose">{plainTextBlock(selectedArticle.content)}</p>
                    </section>
                  )}

                  {selectedArticle.external?.content && (
                    <section className="detail-section">
                      <h4>原文抓取（实验）</h4>
                      <p className="hint">{selectedArticle.external.title}</p>
                      <p className="reading-block prose">{plainTextBlock(selectedArticle.external.content)}</p>
                      <div className="detail-toolbar-actions">
                        <a href={selectedArticle.external.url} target="_blank" rel="noreferrer" className="ghost-btn detail-open-link">
                          打开抓取原文
                        </a>
                      </div>
                      {selectedArticle.external.truncated && <p className="hint">原文较长，已截断显示。</p>}
                    </section>
                  )}

                  {selectedArticle.thread && (
                    <section className="thread-section detail-section">
                      <div className="thread-header">
                        <h4>话题全文与评论</h4>
                        <span className="thread-counts">
                          共 {selectedArticle.thread.total_posts} 帖 · 展示 {visibleThreadComments.length}
                        </span>
                      </div>
                      <p className="hint">{selectedArticle.thread.topic_title}</p>
                      {selectedArticle.thread.full_content && (
                        <p className="reading-block prose">{plainTextBlock(selectedArticle.thread.full_content)}</p>
                      )}

                      {threadComments.length > 0 && (
                        <>
                          <div className="thread-comments">
                            {visibleThreadComments.map((comment, index) => (
                              <article key={`${comment.link}-${index}`} className="thread-comment">
                                <p className="thread-comment-meta">
                                  #{comment.post_number || index + 2} · {comment.author || 'unknown'} ·{' '}
                                  {comment.published_at ? formatTimeAgo(comment.published_at) : '-'}
                                </p>
                                <p className="reading-block">{plainTextBlock(comment.content)}</p>
                                <a href={comment.link} target="_blank" rel="noreferrer">
                                  定位到该评论
                                </a>
                              </article>
                            ))}
                          </div>
                          {threadComments.length > threadPreviewCommentLimit && (
                            <button
                              type="button"
                              className="ghost-btn comment-toggle"
                              onClick={() => setExpandedThreadComments((value) => !value)}
                            >
                              {expandedThreadComments ? '收起评论' : `查看全部评论（${threadComments.length}）`}
                            </button>
                          )}
                        </>
                      )}

                      {hasHiddenThreadComments && (
                        <p className="hint">默认只展示前 {threadPreviewCommentLimit} 条评论，避免打断正文阅读。</p>
                      )}
                      {selectedArticle.thread.truncated && <p className="hint">评论过多，仅展示前 120 条。</p>}
                    </section>
                  )}
                </article>
              )}
            </section>
          )}
        </>
      )}

      {activeTab === 'sources' && (
        <main className="source-page-grid">
          <section className="panel status-panel">
              <div className="status-header">
                <h3>来源健康面板（最近 24h）</h3>
                <button className="ghost-btn" onClick={() => void loadStatus()} disabled={loadingStatus}>
                  {loadingStatus ? '刷新中...' : '刷新状态'}
                </button>
              </div>
              {loadingStatus && sourceStatus.length === 0 && <p className="hint">加载状态中...</p>}
              {!loadingStatus && sourceStatus.length === 0 && <p className="hint">暂无来源状态</p>}

              {sourceStatus.length > 0 && (
                <div className="status-list">
                  {sourceStatus.map((item) => (
                    <article key={item.source_id} className="status-card">
                      <div className="status-main">
                        <div>
                          <p className="status-name">{item.name}</p>
                          <p className="status-meta">
                            {item.category} · {item.enabled ? '启用' : '停用'}
                          </p>
                        </div>
                        <span className={`health-badge health-${item.health}`}>{healthLabel(item.health)}</span>
                      </div>

                      <div className="status-stats">
                        <span>成功率: {item.window_success_rate.toFixed(1)}%</span>
                        <span>失败: {item.window_failed}</span>
                        <span>总抓取: {item.window_total}</span>
                        <span>连续失败: {item.consecutive_failures}</span>
                        <span>当前间隔: {item.effective_poll_interval_sec}s</span>
                        <span>最新状态: {item.latest_status ?? '-'}</span>
                      </div>

                      {item.last_error && <p className="status-error">最近错误: {truncate(item.last_error, 140)}</p>}
                    </article>
                  ))}
                </div>
              )}

              {statusError && (
                <div className="inline-error">
                  <span>状态加载失败: {statusError}</span>
                  <button className="ghost-btn" onClick={() => void loadStatus()}>
                    重试
                  </button>
                </div>
              )}
          </section>

          <section className="panel sources">
            <h3>来源管理</h3>
            <form className="source-form" onSubmit={onCreateSource}>
              <label>
                名称（可选）
                <input
                  value={newSourceName}
                  onChange={(event) => setNewSourceName(event.target.value)}
                  placeholder="留空则自动使用 RSS title"
                />
              </label>
              <label>
                RSS URL
                <input
                  value={newSourceURL}
                  onChange={(event) => setNewSourceURL(event.target.value)}
                  placeholder="https://example.com/feed.xml"
                />
              </label>
              <label>
                分类
                <input
                  value={newSourceCategory}
                  onChange={(event) => setNewSourceCategory(event.target.value)}
                  placeholder="tech"
                />
              </label>
              <button type="submit" disabled={creatingSource}>
                {creatingSource ? '创建中...' : '新增来源'}
              </button>
            </form>

            {sourcesError && (
              <div className="inline-error">
                <span>来源加载失败: {sourcesError}</span>
                <button className="ghost-btn" onClick={() => void loadSources()}>
                  重试
                </button>
              </div>
            )}

            <div className="site-groups">
              {loadingSources && <p className="hint">加载来源中...</p>}
              {!loadingSources && sources.length === 0 && <p className="hint">暂无来源</p>}

              {sourceGroups.map((group) => (
                <section key={group.siteKey} className="site-group-card">
                  <div className="site-group-header">
                    <div>
                      <p className="site-group-title">{group.siteKey}</p>
                      <p className="hint">{group.sources.length} 个订阅源</p>
                    </div>
                    <button
                      type="button"
                      className="btn-muted source-visibility-reset"
                      onClick={() => toggleSiteMuted(group.siteKey)}
                    >
                      {mutedSiteSet.has(group.siteKey) ? '恢复到聚合流' : '从聚合流隐藏'}
                    </button>
                  </div>

                  <div className="source-list">
                    {group.sources.map((source) => (
                      <article key={source.id} className="source-card">
                        {editingSourceID === source.id ? (
                          <div className="source-edit-grid">
                            <label>
                              名称
                              <input value={editSourceName} onChange={(event) => setEditSourceName(event.target.value)} />
                            </label>
                            <label>
                              RSS URL
                              <input value={editSourceURL} onChange={(event) => setEditSourceURL(event.target.value)} />
                            </label>
                            <label>
                              分类
                              <input
                                value={editSourceCategory}
                                onChange={(event) => setEditSourceCategory(event.target.value)}
                              />
                            </label>
                            <label>
                              间隔(秒)
                              <input value={editSourcePollSec} onChange={(event) => setEditSourcePollSec(event.target.value)} />
                            </label>
                          </div>
                        ) : (
                          <div>
                            <p className="source-title">{source.name}</p>
                            <p className="source-url">{source.rss_url}</p>
                            <p className="source-meta">
                              <span>{source.category}</span>
                              <span>{source.enabled ? '启用' : '停用'}</span>
                              <span>{source.poll_interval_sec}s</span>
                            </p>
                          </div>
                        )}
                        <div className="source-actions">
                          {editingSourceID === source.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void onSaveSourceEdit(source.id)}
                                disabled={busySourceID === source.id}
                              >
                                保存
                              </button>
                              <button
                                type="button"
                                className="btn-muted"
                                onClick={onCancelEdit}
                                disabled={busySourceID === source.id}
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => void onTestSource(source.id)}
                                disabled={busySourceID === source.id}
                              >
                                测试
                              </button>
                              <button
                                type="button"
                                onClick={() => void onRefreshSource(source.id)}
                                disabled={busySourceID === source.id}
                              >
                                刷新
                              </button>
                              <button
                                type="button"
                                className="btn-muted"
                                onClick={() => onStartEdit(source)}
                                disabled={busySourceID === source.id}
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                className="btn-muted"
                                onClick={() => void onToggleSourceEnabled(source)}
                                disabled={busySourceID === source.id}
                              >
                                {source.enabled ? '停用' : '启用'}
                              </button>
                              <button
                                type="button"
                                className="btn-danger"
                                onClick={() => void onDeleteSource(source)}
                                disabled={busySourceID === source.id}
                              >
                                删除
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </main>
      )}
    </div>
  )
}

function FeedSkeleton() {
  return (
    <article className="feed-item skeleton-block">
      <div className="skeleton skeleton-line short" />
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line" />
    </article>
  )
}

function resolveSourceSiteKey(source: Pick<Source, 'site_key' | 'rss_url'>): string {
  const normalized = source.site_key?.trim().toLowerCase()
  if (normalized && normalized !== 'rsshub.rssforever.com') return normalized
  return deriveSiteKeyFromURL(source.rss_url)
}

function deriveSiteKeyFromURL(rawURL: string): string {
  try {
    const parsed = new URL(rawURL)
    const host = parsed.hostname.trim().toLowerCase()
    if (!host) return 'unknown-site'
    if (host === 'rsshub.rssforever.com') {
      const firstSegment = parsed.pathname
        .split('/')
        .map((item) => item.trim().toLowerCase())
        .find((item) => item.length > 0)
      if (firstSegment) return firstSegment
    }
    if (host === 'localhost') return host
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host
    const parts = host.split('.').filter(Boolean)
    if (parts.length >= 2) {
      return parts.slice(-2).join('.')
    }
    return host
  } catch {
    return 'unknown-site'
  }
}

function isTrackableForumLink(rawURL: string): boolean {
  try {
    const parsed = new URL(rawURL)
    const host = parsed.hostname.trim().toLowerCase()
    const path = parsed.pathname.trim()
    if ((host === 'www.uscardforum.com' || host === 'uscardforum.com') && /^\/t\/topic\/\d+/.test(path)) {
      return true
    }
    if ((host === 'www.v2ex.com' || host === 'v2ex.com') && /^\/t\/\d+/.test(path)) {
      return true
    }
    return false
  } catch {
    return false
  }
}

function plainText(input?: string): string {
  if (!input) return ''
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function plainTextBlock(input?: string): string {
  if (!input) return ''
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function truncate(input: string, size: number): string {
  if (input.length <= size) return input
  return `${input.slice(0, size)}...`
}

function formatTimeAgo(input: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return '-'

  const diffMS = Date.now() - date.getTime()
  if (diffMS < 60 * 1000) return '刚刚'

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day

  if (diffMS < hour) return `${Math.floor(diffMS / minute)} 分钟前`
  if (diffMS < day) return `${Math.floor(diffMS / hour)} 小时前`
  if (diffMS < week) return `${Math.floor(diffMS / day)} 天前`

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function healthLabel(health: SourceStatus['health']): string {
  switch (health) {
    case 'ok':
      return '健康'
    case 'warn':
      return '警告'
    case 'error':
      return '错误'
    case 'stale':
      return '陈旧'
    case 'disabled':
      return '停用'
    default:
      return '新来源'
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export default App
