import type { Dispatch, FormEvent, SetStateAction } from 'react'
import {
  bulkUpdateSourceTags,
  createSource,
  deleteSource,
  discoverSources,
  exportSources,
  importSources,
  reclassifySources,
  refreshSource,
  testSource,
  updateSource,
} from '../api'
import type { DiscoverSourceCandidate, Source } from '../types'
import { formatAIBriefingInterval } from '../lib/app-utils'
import type { BulkSourceAction } from './use-source-management-state'

type FeedLoadOverrides = {
  tag?: string
  sourceID?: string
  keyword?: string
  cursor?: string
}

type NoticeKind = 'info' | 'error'
type NoticePayload = {
  kind: NoticeKind
  text: string
}

export type UseSourceManagementActionsParams = {
  newSourceName: string
  newSourceURL: string
  newSourceTags: string
  batchSourceURLs: string
  batchSourceTags: string
  discoverURL: string
  editSourceName: string
  editSourceURL: string
  editSourceTags: string
  editSourcePollSec: string
  sourceFilter: string
  editingSourceID: number | null
  selectedSourceIDs: number[]
  bulkTagInput: string
  bulkPollSec: string
  sourceProfileSource: Source | null
  sourceProfileTags: string[]
  pendingDeleteSource: Source | null
  sourceByID: Map<number, Source>
  setNotice: Dispatch<SetStateAction<NoticePayload | null>>
  setCreatingSource: Dispatch<SetStateAction<boolean>>
  setNewSourceName: Dispatch<SetStateAction<string>>
  setNewSourceURL: Dispatch<SetStateAction<string>>
  setNewSourceTags: Dispatch<SetStateAction<string>>
  setBatchCreatingSources: Dispatch<SetStateAction<boolean>>
  setBatchCreateResult: Dispatch<
    SetStateAction<{ success: string[]; failed: Array<{ url: string; error: string }> } | null>
  >
  setDiscoveringSources: Dispatch<SetStateAction<boolean>>
  setDiscoveredSources: Dispatch<SetStateAction<DiscoverSourceCandidate[]>>
  setBusySourceID: Dispatch<SetStateAction<number | null>>
  setReclassifyingSources: Dispatch<SetStateAction<boolean>>
  setExportingSources: Dispatch<SetStateAction<boolean>>
  setImportingSources: Dispatch<SetStateAction<boolean>>
  setBulkSourceAction: Dispatch<SetStateAction<BulkSourceAction | null>>
  setSources: Dispatch<SetStateAction<Source[]>>
  setSourceProfileSource: Dispatch<SetStateAction<Source | null>>
  setSourceProfileTagInput: Dispatch<SetStateAction<string>>
  clearSourceContextMenu: () => void
  onCancelEdit: () => void
  onAfterDeleteSourceStateSync: (source: Source, containsSourceInFilter: boolean) => void
  loadSources: () => Promise<void>
  loadFeed: (append?: boolean, overrides?: FeedLoadOverrides) => Promise<void>
  refreshStatusIfVisible: () => Promise<void>
  parseSourceTagInput: (input: string) => string[]
  parseRSSLines: (input: string) => string[]
  parseSourceIDFilter: (input: string) => number[]
  normalizeSourceTags: (values?: string[]) => string[]
  sourceTagList: (source: Pick<Source, 'tags'>) => string[]
  equalStringList: (left: string[], right: string[]) => boolean
  bulkActionLabel: (action: BulkSourceAction) => string
  toErrorMessage: (error: unknown) => string
}

export function useSourceManagementActions(params: UseSourceManagementActionsParams) {
  async function onExportSources() {
    try {
      params.setExportingSources(true)
      const payload = await exportSources()
      const fileName = `quick-sources-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
      const objectURL = window.URL.createObjectURL(blob)
      const anchor = window.document.createElement('a')
      anchor.href = objectURL
      anchor.download = fileName
      window.document.body.appendChild(anchor)
      anchor.click()
      window.document.body.removeChild(anchor)
      window.URL.revokeObjectURL(objectURL)
      params.setNotice({ kind: 'info', text: `导出完成：${payload.count} 个来源。` })
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `导出来源失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      params.setExportingSources(false)
    }
  }

  async function onImportSourcesFile(file: File) {
    if (!file) {
      return
    }
    try {
      params.setImportingSources(true)
      const text = await file.text()
      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        params.setNotice({ kind: 'error', text: '导入失败: 文件不是有效 JSON。' })
        return
      }

      const response = await importSources(payload)
      await Promise.allSettled([params.loadSources(), params.loadFeed(false), params.refreshStatusIfVisible()])
      params.setNotice({
        kind: response.meta.failed > 0 ? 'error' : 'info',
        text: `导入完成：新增 ${response.meta.created}，更新 ${response.meta.updated}，跳过 ${response.meta.skipped}，失败 ${response.meta.failed}`,
      })
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `导入来源失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      params.setImportingSources(false)
    }
  }

  async function onCreateSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!params.newSourceURL.trim()) {
      params.setNotice({ kind: 'error', text: '请填写 RSS URL。' })
      return
    }

    try {
      params.setCreatingSource(true)
      const payload: {
        name?: string
        rss_url: string
        tags?: string[]
      } = {
        rss_url: params.newSourceURL.trim(),
      }
      const tags = params.parseSourceTagInput(params.newSourceTags)
      if (tags.length > 0) {
        payload.tags = tags
      }

      const name = params.newSourceName.trim()
      if (name) {
        payload.name = name
      }

      await createSource(payload)

      params.setNewSourceName('')
      params.setNewSourceURL('')
      params.setNewSourceTags('')
      params.setNotice({ kind: 'info', text: '来源创建成功。' })
      await params.loadSources()
      await params.refreshStatusIfVisible()
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `创建来源失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      params.setCreatingSource(false)
    }
  }

  async function onDiscoverSources(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = params.discoverURL.trim()
    if (!input) {
      params.setNotice({ kind: 'error', text: '请填写网站地址。' })
      return
    }

    try {
      params.setDiscoveringSources(true)
      const response = await discoverSources(input)
      params.setDiscoveredSources(response.data)
      params.setNotice({
        kind: 'info',
        text: response.data.length > 0 ? `发现 ${response.data.length} 个可用 RSS。` : '没有发现可用 RSS。',
      })
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `自动发现失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      params.setDiscoveringSources(false)
    }
  }

  async function onBatchCreateSources(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const urls = params.parseRSSLines(params.batchSourceURLs)
    if (urls.length === 0) {
      params.setNotice({ kind: 'error', text: '请至少输入一个 RSS URL。' })
      return
    }

    const tags = params.parseSourceTagInput(params.batchSourceTags)
    params.setBatchCreatingSources(true)
    params.setBatchCreateResult(null)

    const results = await Promise.all(
      urls.map(async (rssURL) => {
        try {
          await createSource({
            rss_url: rssURL,
            tags: tags.length > 0 ? tags : undefined,
          })
          return { ok: true as const, url: rssURL }
        } catch (error) {
          return { ok: false as const, url: rssURL, error: params.toErrorMessage(error) }
        }
      }),
    )

    const success = results.filter((item) => item.ok).map((item) => item.url)
    const failed = results.filter((item) => !item.ok).map((item) => ({ url: item.url, error: item.error }))
    params.setBatchCreateResult({ success, failed })
    params.setBatchCreatingSources(false)

    if (success.length > 0) {
      await params.loadSources()
      await params.refreshStatusIfVisible()
    }
    params.setNotice({
      kind: failed.length > 0 ? 'error' : 'info',
      text: `批量添加完成：成功 ${success.length}，失败 ${failed.length}`,
    })
  }

  async function onAddDiscoveredSource(candidate: DiscoverSourceCandidate) {
    if (candidate.existing) return
    try {
      await createSource({
        name: candidate.name,
        rss_url: candidate.rss_url,
        tags: candidate.suggested_tag ? [candidate.suggested_tag] : undefined,
      })
      params.setDiscoveredSources((previous) =>
        previous.map((item) =>
          item.rss_url === candidate.rss_url ? { ...item, existing: true, source_name: candidate.name } : item,
        ),
      )
      params.setNotice({ kind: 'info', text: `已添加来源：${candidate.name}` })
      await params.loadSources()
      await params.refreshStatusIfVisible()
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `添加来源失败: ${params.toErrorMessage(error)}`,
      })
    }
  }

  async function onTestSource(sourceID: number) {
    try {
      params.setBusySourceID(sourceID)
      const result = await testSource(sourceID)
      params.setNotice({
        kind: 'info',
        text: `测试成功: ${result.title}（${result.item_count} 条）`,
      })
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `测试来源失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      params.setBusySourceID(null)
    }
  }

  async function onRefreshSource(sourceID: number) {
    try {
      params.setBusySourceID(sourceID)
      await refreshSource(sourceID)
      params.setNotice({
        kind: 'info',
        text: `来源 ${sourceID} 强制刷新成功。`,
      })
      await params.loadFeed(false)
      await params.refreshStatusIfVisible()
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `强制刷新来源失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      params.setBusySourceID(null)
    }
  }

  async function onSaveSourceEdit(sourceID: number) {
    const name = params.editSourceName.trim()
    const rssURL = params.editSourceURL.trim()
    const tags = params.parseSourceTagInput(params.editSourceTags)
    const pollIntervalSec = Number.parseInt(params.editSourcePollSec, 10)

    if (!name || !rssURL) {
      params.setNotice({ kind: 'error', text: '名称和 RSS URL 不能为空。' })
      return
    }
    if (Number.isNaN(pollIntervalSec) || pollIntervalSec <= 0) {
      params.setNotice({ kind: 'error', text: '抓取间隔必须是正整数。' })
      return
    }

    try {
      params.setBusySourceID(sourceID)
      await updateSource(sourceID, {
        name,
        rss_url: rssURL,
        tags,
        poll_interval_sec: pollIntervalSec,
      })
      params.setNotice({ kind: 'info', text: `来源 ${sourceID} 更新成功。` })
      params.onCancelEdit()
      await params.loadSources()
      await params.loadFeed(false)
      await params.refreshStatusIfVisible()
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `更新来源失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      params.setBusySourceID(null)
    }
  }

  async function onToggleSourceEnabled(source: Source) {
    try {
      params.setBusySourceID(source.id)
      await updateSource(source.id, { enabled: !source.enabled })
      params.setNotice({
        kind: 'info',
        text: `来源 ${source.id} 已${source.enabled ? '停用' : '启用'}。`,
      })
      await params.loadSources()
      await params.refreshStatusIfVisible()
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `切换状态失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      params.setBusySourceID(null)
    }
  }

  async function deleteSourceAndRefresh(source: Source) {
    try {
      params.setBusySourceID(source.id)
      await deleteSource(source.id)
      const filteredIDs = params.parseSourceIDFilter(params.sourceFilter)
      const containsSourceInFilter = filteredIDs.includes(source.id)
      params.onAfterDeleteSourceStateSync(source, containsSourceInFilter)
      params.setNotice({ kind: 'info', text: `来源 ${source.id} 已删除。` })
      await params.loadSources()
      await params.loadFeed(false, containsSourceInFilter ? { sourceID: '' } : undefined)
      await params.refreshStatusIfVisible()
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `删除来源失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      if (params.editingSourceID === source.id) {
        params.onCancelEdit()
      }
      params.setBusySourceID(null)
    }
  }

  async function onDeleteSource(source: Source) {
    if (!window.confirm(`确定删除来源「${source.name}」吗？`)) {
      return
    }
    await deleteSourceAndRefresh(source)
  }

  async function onReclassifySources() {
    try {
      params.setReclassifyingSources(true)
      const response = await reclassifySources({})
      await Promise.allSettled([params.loadSources(), params.loadFeed(false), params.refreshStatusIfVisible()])
      params.setNotice({
        kind: response.meta.errors > 0 ? 'error' : 'info',
        text: `自动重分类完成：变更 ${response.meta.changed}，错误 ${response.meta.errors}，总计 ${response.meta.count}`,
      })
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `自动重分类失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      params.setReclassifyingSources(false)
    }
  }

  async function onRunBulkSourceAction(action: 'enable' | 'disable' | 'refresh' | 'test') {
    if (params.selectedSourceIDs.length === 0) {
      params.setNotice({ kind: 'error', text: '请先勾选至少一个来源。' })
      return
    }

    params.setBulkSourceAction(action)
    try {
      const results = await Promise.all(
        params.selectedSourceIDs.map(async (sourceID) => {
          const source = params.sourceByID.get(sourceID)
          if (!source) {
            return { sourceID, ok: true as const, skipped: true as const }
          }

          try {
            if (action === 'enable') {
              if (source.enabled) {
                return { sourceID, ok: true as const, skipped: true as const }
              }
              await updateSource(sourceID, { enabled: true })
            } else if (action === 'disable') {
              if (!source.enabled) {
                return { sourceID, ok: true as const, skipped: true as const }
              }
              await updateSource(sourceID, { enabled: false })
            } else if (action === 'refresh') {
              await refreshSource(sourceID)
            } else {
              await testSource(sourceID)
            }
            return { sourceID, ok: true as const, skipped: false as const }
          } catch (error) {
            return { sourceID, ok: false as const, skipped: false as const, error: params.toErrorMessage(error) }
          }
        }),
      )

      const succeeded = results.filter((item) => item.ok && !item.skipped).length
      const skipped = results.filter((item) => item.ok && item.skipped).length
      const failed = results.filter((item) => !item.ok)

      if (action === 'enable' || action === 'disable') {
        await Promise.allSettled([params.loadSources(), params.loadFeed(false), params.refreshStatusIfVisible()])
      } else if (action === 'refresh') {
        await Promise.allSettled([params.loadFeed(false), params.refreshStatusIfVisible()])
      } else {
        await params.refreshStatusIfVisible()
      }

      params.setNotice({
        kind: failed.length > 0 ? 'error' : 'info',
        text: `批量${params.bulkActionLabel(action)}完成：成功 ${succeeded}，跳过 ${skipped}，失败 ${failed.length}`,
      })
    } finally {
      params.setBulkSourceAction(null)
    }
  }

  async function onRunBulkTagAction(action: 'add' | 'remove') {
    if (params.selectedSourceIDs.length === 0) {
      params.setNotice({ kind: 'error', text: '请先勾选至少一个来源。' })
      return
    }

    const tags = params.parseSourceTagInput(params.bulkTagInput)
    if (tags.length === 0) {
      params.setNotice({ kind: 'error', text: '请先输入至少一个标签。' })
      return
    }

    params.setBulkSourceAction(action === 'add' ? 'add_tags' : 'remove_tags')
    try {
      const result = await bulkUpdateSourceTags({
        source_ids: params.selectedSourceIDs,
        action,
        tags,
      })
      await Promise.allSettled([params.loadSources(), params.loadFeed(false), params.refreshStatusIfVisible()])
      const actionLabel = action === 'add' ? '添加标签' : '移除标签'
      params.setNotice({
        kind: 'info',
        text: `批量${actionLabel}完成：更新 ${result.updated} / ${result.total}`,
      })
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `批量标签操作失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      params.setBulkSourceAction(null)
    }
  }

  async function onRunBulkPollIntervalUpdate() {
    if (params.selectedSourceIDs.length === 0) {
      params.setNotice({ kind: 'error', text: '请先勾选至少一个来源。' })
      return
    }

    const pollIntervalSec = Number.parseInt(params.bulkPollSec, 10)
    if (Number.isNaN(pollIntervalSec) || pollIntervalSec <= 0) {
      params.setNotice({ kind: 'error', text: '批量抓取间隔必须是正整数秒。' })
      return
    }

    params.setBulkSourceAction('set_poll')
    try {
      const results = await Promise.all(
        params.selectedSourceIDs.map(async (sourceID) => {
          try {
            await updateSource(sourceID, { poll_interval_sec: pollIntervalSec })
            return { ok: true as const }
          } catch (error) {
            return { ok: false as const, error: params.toErrorMessage(error) }
          }
        }),
      )
      const succeeded = results.filter((item) => item.ok).length
      const failed = results.length - succeeded
      await Promise.allSettled([params.loadSources(), params.refreshStatusIfVisible()])
      params.setNotice({
        kind: failed > 0 ? 'error' : 'info',
        text: `批量${params.bulkActionLabel('set_poll')}完成：成功 ${succeeded}，失败 ${failed}`,
      })
    } finally {
      params.setBulkSourceAction(null)
    }
  }

  async function onRunBulkAIBriefingAction(enabled: boolean, intervalMin?: number) {
    if (params.selectedSourceIDs.length === 0) {
      params.setNotice({ kind: 'error', text: '请先勾选至少一个来源。' })
      return
    }

    const action: BulkSourceAction = enabled ? 'enable_ai' : 'disable_ai'
    params.setBulkSourceAction(action)
    try {
      const results = await Promise.all(
        params.selectedSourceIDs.map(async (sourceID) => {
          const source = params.sourceByID.get(sourceID)
          if (!source) {
            return { ok: true as const, skipped: true as const }
          }
          try {
            const nextInterval = intervalMin ?? source.ai_briefing_interval_min ?? 180
            await updateSource(sourceID, {
              ai_briefing_enabled: enabled,
              ai_briefing_interval_min: nextInterval,
            })
            return { ok: true as const, skipped: false as const }
          } catch (error) {
            return { ok: false as const, skipped: false as const, error: params.toErrorMessage(error) }
          }
        }),
      )
      const succeeded = results.filter((item) => item.ok && !item.skipped).length
      const skipped = results.filter((item) => item.ok && item.skipped).length
      const failed = results.filter((item) => !item.ok).length
      await Promise.allSettled([params.loadSources(), params.refreshStatusIfVisible()])
      params.setNotice({
        kind: failed > 0 ? 'error' : 'info',
        text: `批量${params.bulkActionLabel(action)}完成：成功 ${succeeded}，跳过 ${skipped}，失败 ${failed}`,
      })
    } finally {
      params.setBulkSourceAction(null)
    }
  }

  async function onConfirmDeleteSource() {
    if (!params.pendingDeleteSource) return
    await deleteSourceAndRefresh(params.pendingDeleteSource)
  }

  async function onQuickSetSourceEnabled(source: Source, enabled: boolean) {
    if (source.enabled === enabled) {
      params.setNotice({ kind: 'info', text: enabled ? '该订阅源已启用。' : '该订阅源已停用。' })
      return
    }

    try {
      params.setBusySourceID(source.id)
      await updateSource(source.id, { enabled })
      params.clearSourceContextMenu()
      params.setSourceProfileSource((previous) => (previous?.id === source.id ? { ...previous, enabled } : previous))
      params.setNotice({
        kind: 'info',
        text: `订阅源 ${source.name} 已${enabled ? '启用' : '停用'}。`,
      })
      await Promise.allSettled([params.loadSources(), params.loadFeed(false), params.refreshStatusIfVisible()])
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `更新订阅源失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      params.setBusySourceID(null)
    }
  }

  async function saveSourceProfileTags(nextTags: string[]) {
    if (!params.sourceProfileSource) return
    const normalized = params.normalizeSourceTags(nextTags)
    const current = params.sourceTagList(params.sourceProfileSource)
    if (params.equalStringList(current, normalized)) {
      return
    }

    try {
      params.setBusySourceID(params.sourceProfileSource.id)
      const updated = await updateSource(params.sourceProfileSource.id, { tags: normalized })
      params.setSources((previous) => previous.map((source) => (source.id === updated.id ? updated : source)))
      params.setSourceProfileSource(updated)
      await Promise.allSettled([params.loadFeed(false), params.refreshStatusIfVisible()])
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `更新标签失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      params.setBusySourceID(null)
    }
  }

  async function onRemoveSourceProfileTag(tag: string) {
    const next = params.sourceProfileTags.filter((item) => item !== tag)
    await saveSourceProfileTags(next)
  }

  async function onAddSourceProfileTags(tags: string[]) {
    const next = params.normalizeSourceTags([...params.sourceProfileTags, ...tags])
    await saveSourceProfileTags(next)
    params.setSourceProfileTagInput('')
  }

  async function onSetSourceProfileAIBriefing(enabled: boolean, intervalMin?: number) {
    if (!params.sourceProfileSource) return
    const nextIntervalMin =
      intervalMin ?? params.sourceProfileSource.ai_briefing_interval_min ?? 360

    try {
      params.setBusySourceID(params.sourceProfileSource.id)
      const updated = await updateSource(params.sourceProfileSource.id, {
        ai_briefing_enabled: enabled,
        ai_briefing_interval_min: nextIntervalMin,
      })
      params.setSources((previous) => previous.map((source) => (source.id === updated.id ? updated : source)))
      params.setSourceProfileSource(updated)
      params.setNotice({
        kind: 'info',
        text: enabled
          ? `已为 ${updated.name} 开启定时 AI 速览（每 ${formatAIBriefingInterval(updated.ai_briefing_interval_min ?? nextIntervalMin)}）。`
          : `已关闭 ${updated.name} 的定时 AI 速览。`,
      })
      await Promise.allSettled([params.refreshStatusIfVisible()])
    } catch (error) {
      params.setNotice({
        kind: 'error',
        text: `更新定时 AI 速览失败: ${params.toErrorMessage(error)}`,
      })
    } finally {
      params.setBusySourceID(null)
    }
  }

  return {
    onExportSources,
    onImportSourcesFile,
    onCreateSource,
    onDiscoverSources,
    onBatchCreateSources,
    onAddDiscoveredSource,
    onTestSource,
    onRefreshSource,
    onSaveSourceEdit,
    onToggleSourceEnabled,
    onDeleteSource,
    onReclassifySources,
    onRunBulkSourceAction,
    onRunBulkTagAction,
    onRunBulkPollIntervalUpdate,
    onRunBulkAIBriefingAction,
    onConfirmDeleteSource,
    onQuickSetSourceEnabled,
    onRemoveSourceProfileTag,
    onAddSourceProfileTags,
    onSetSourceProfileAIBriefing,
  }
}
