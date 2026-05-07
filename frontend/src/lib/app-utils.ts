import type { ArticleDetail, Source, SourceStatus } from '../types'
import type { BulkSourceAction } from '../hooks/use-source-management-state'

export const maxStoredReadArticles = 3000
export const maxStoredFavoriteArticles = 3000
const readMarkLongDwellMs = 8_000
const compactInlineSummaryMaxRunes = 180

export function parseStoredReadArticleIDs(raw: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return normalizeReadArticleIDs(parsed)
  } catch {
    return []
  }
}

export function parseStoredFavoriteArticleIDs(raw: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return normalizeFavoriteArticleIDs(parsed)
  } catch {
    return []
  }
}

export function normalizeReadArticleIDs(values: unknown[]): number[] {
  const seen = new Set<number>()
  const output: number[] = []
  for (const value of values) {
    const articleID = normalizeArticleID(value)
    if (!articleID || seen.has(articleID)) continue
    seen.add(articleID)
    output.push(articleID)
    if (output.length >= maxStoredReadArticles) break
  }
  return output
}

export function normalizeFavoriteArticleIDs(values: unknown[]): number[] {
  const seen = new Set<number>()
  const output: number[] = []
  for (const value of values) {
    const articleID = normalizeArticleID(value)
    if (!articleID || seen.has(articleID)) continue
    seen.add(articleID)
    output.push(articleID)
    if (output.length >= maxStoredFavoriteArticles) break
  }
  return output
}

export function normalizeArticleID(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isInteger(value)) return null
  if (value <= 0) return null
  return value
}

export function upsertReadArticleID(previous: number[], articleID: number): number[] {
  const normalized = normalizeArticleID(articleID)
  if (!normalized) return previous
  const next = [normalized, ...previous.filter((value) => value !== normalized)]
  return next.slice(0, maxStoredReadArticles)
}

export function toggleFavoriteArticleID(previous: number[], articleID: number): number[] {
  const normalized = normalizeArticleID(articleID)
  if (!normalized) return previous
  if (previous.includes(normalized)) {
    return previous.filter((value) => value !== normalized)
  }
  return [normalized, ...previous].slice(0, maxStoredFavoriteArticles)
}

export function resolveReadDwellThresholdMs(article: ArticleDetail): number {
  const readableChars = resolveArticleReadableCharCount(article)
  if (readableChars <= 180) {
    return 2_000
  }
  if (readableChars <= 500) {
    return 4_000
  }
  if (readableChars <= 1200) {
    return 6_000
  }
  return readMarkLongDwellMs
}

export function resolveArticleReadableCharCount(article: ArticleDetail): number {
  const chunks: string[] = []
  if (article.content_html) {
    chunks.push(plainTextBlock(article.content_html))
  } else if (article.content) {
    chunks.push(plainTextBlock(article.content))
  } else if (article.summary) {
    chunks.push(plainTextBlock(article.summary))
  }
  if (article.thread?.full_content) {
    chunks.push(plainTextBlock(article.thread.full_content))
  }
  if (article.thread?.comments?.length) {
    chunks.push(article.thread.comments.map((comment) => plainTextBlock(comment.content)).join('\n'))
  }
  if (chunks.length === 0) {
    return 0
  }
  const merged = chunks.join('\n')
  return merged.replace(/\s+/g, '').length
}

export function resolveSourceSiteKey(source: Pick<Source, 'site_key' | 'rss_url'>): string {
  const normalized = source.site_key?.trim().toLowerCase()
  if (normalized && normalized !== 'rsshub.rssforever.com' && normalized !== 'rsshub.app' && normalized !== 'www.rsshub.app') {
    return normalized
  }
  return deriveSiteKeyFromURL(source.rss_url)
}

export function sourceTagList(source: Pick<Source, 'tags'>): string[] {
  const tags = normalizeSourceTags(source.tags)
  if (tags.length > 0) {
    return tags
  }
  return ['general']
}

export function parseSourceTagInput(input: string): string[] {
  if (!input.trim()) return []
  return normalizeSourceTags(input.split(/[,\n，]/g))
}

export function normalizeSourceTags(values?: string[]): string[] {
  if (!values || values.length === 0) return []
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    const normalized = normalizeSourceTagValue(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
  }
  return output
}

export function normalizeSourceTagValue(value?: string): string {
  const normalized = value?.trim().toLowerCase() ?? ''
  if (!normalized) return ''
  return normalized
}

export function normalizeSourceKind(kind?: string): 'feed' | 'thread' {
  const value = kind?.trim().toLowerCase()
  if (value === 'thread') return 'thread'
  return 'feed'
}

export function deriveSiteKeyFromURL(rawURL: string): string {
  try {
    const parsed = new URL(rawURL)
    const host = parsed.hostname.trim().toLowerCase()
    if (!host) return 'unknown-site'
    if (host === 'rsshub.rssforever.com' || host === 'rsshub.app' || host === 'www.rsshub.app') {
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

export function isTrackableForumLink(rawURL: string): boolean {
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

export function normalizeImageURL(rawURL?: string): string | null {
  const value = rawURL?.trim()
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

export function formatAIStopReason(reason?: string, truncated?: boolean): string {
  const normalized = reason?.trim().toLowerCase() ?? ''
  if (normalized === 'max_tokens' || normalized === 'length' || normalized === 'max_output_tokens') {
    return '输出触顶'
  }
  if (normalized === 'stop' || normalized === 'end_turn') {
    return '正常结束'
  }
  if (normalized) {
    return normalized
  }
  return truncated ? '可能截断' : '已完成'
}

const allowedRichHTMLTags = new Set([
  'a',
  'p',
  'div',
  'span',
  'br',
  'hr',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'blockquote',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
])

const blockedRichHTMLTags = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'meta',
  'link',
  'svg',
  'math',
  'base',
])

export function sanitizeRichHTML(input?: string, baseURL?: string): string {
  const source = input?.trim()
  if (!source) return ''
  const decoded = decodeHTMLEntities(source)
  const candidate = /<[^>]+>/.test(source) ? source : decoded
  if (!/<[^>]+>/.test(candidate)) {
    return ''
  }

  if (typeof document === 'undefined') {
    return ''
  }

  const parser = new DOMParser()
  const parsed = parser.parseFromString(`<div>${candidate}</div>`, 'text/html')
  const sourceRoot = parsed.body.firstElementChild
  if (!sourceRoot) return ''

  const outputDoc = document.implementation.createHTMLDocument('')
  const outputRoot = outputDoc.createElement('div')
  for (const child of Array.from(sourceRoot.childNodes)) {
    const sanitized = sanitizeRichHTMLNode(child, outputDoc, baseURL)
    if (sanitized) {
      outputRoot.appendChild(sanitized)
    }
  }
  return outputRoot.innerHTML.trim()
}

export function sanitizeRichHTMLNode(node: Node, outputDoc: Document, baseURL?: string): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return outputDoc.createTextNode(node.textContent ?? '')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null
  }

  const sourceElement = node as HTMLElement
  const tag = sourceElement.tagName.toLowerCase()

  if (blockedRichHTMLTags.has(tag)) {
    return null
  }

  if (!allowedRichHTMLTags.has(tag)) {
    const fragment = outputDoc.createDocumentFragment()
    for (const child of Array.from(sourceElement.childNodes)) {
      const sanitizedChild = sanitizeRichHTMLNode(child, outputDoc, baseURL)
      if (sanitizedChild) {
        fragment.appendChild(sanitizedChild)
      }
    }
    return fragment.childNodes.length > 0 ? fragment : null
  }

  if (tag === 'img') {
    const src = sanitizeRichImageURL(sourceElement.getAttribute('src'), baseURL)
    if (!src) {
      return null
    }
    const image = outputDoc.createElement('img')
    image.setAttribute('src', src)
    image.setAttribute('loading', 'lazy')
    image.setAttribute('referrerpolicy', 'no-referrer')

    const alt = sourceElement.getAttribute('alt')?.trim()
    if (alt) image.setAttribute('alt', alt.slice(0, 400))
    const title = sourceElement.getAttribute('title')?.trim()
    if (title) image.setAttribute('title', title.slice(0, 400))

    const width = sanitizePositiveIntAttribute(sourceElement.getAttribute('width'))
    if (width) image.setAttribute('width', width)
    const height = sanitizePositiveIntAttribute(sourceElement.getAttribute('height'))
    if (height) image.setAttribute('height', height)

    return image
  }

  const element = outputDoc.createElement(tag)

  if (tag === 'a') {
    const href = sanitizeRichLinkURL(sourceElement.getAttribute('href'), baseURL)
    if (href) {
      element.setAttribute('href', href)
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer nofollow ugc')
    }
    const title = sourceElement.getAttribute('title')?.trim()
    if (title) {
      element.setAttribute('title', title.slice(0, 400))
    }
  }

  if (tag === 'td' || tag === 'th') {
    const colspan = sanitizePositiveIntAttribute(sourceElement.getAttribute('colspan'))
    if (colspan) element.setAttribute('colspan', colspan)
    const rowspan = sanitizePositiveIntAttribute(sourceElement.getAttribute('rowspan'))
    if (rowspan) element.setAttribute('rowspan', rowspan)
  }

  for (const child of Array.from(sourceElement.childNodes)) {
    const sanitizedChild = sanitizeRichHTMLNode(child, outputDoc, baseURL)
    if (sanitizedChild) {
      element.appendChild(sanitizedChild)
    }
  }

  return element
}

export function sanitizeRichLinkURL(rawURL: string | null, baseURL?: string): string | null {
  const value = rawURL?.trim()
  if (!value) return null
  if (value.startsWith('#')) {
    return value
  }
  try {
    const parsed = baseURL ? new URL(value, baseURL) : new URL(value)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
      return parsed.toString()
    }
    return null
  } catch {
    return null
  }
}

export function sanitizeRichImageURL(rawURL: string | null, baseURL?: string): string | null {
  const value = rawURL?.trim()
  if (!value) return null
  try {
    const parsed = baseURL ? new URL(value, baseURL) : new URL(value)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol === 'http:' || protocol === 'https:') {
      return parsed.toString()
    }
    return null
  } catch {
    return null
  }
}

export function sanitizePositiveIntAttribute(rawValue: string | null): string {
  if (!rawValue) return ''
  const value = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(value) || value <= 0) return ''
  if (value > 4000) return ''
  return String(value)
}

export function containsRenderableHTMLTag(input: string): boolean {
  return /<(img|p|div|blockquote|pre|ul|ol|li|h[1-6]|table|a|br|hr)\b/i.test(input)
}

export function plainText(input?: string): string {
  if (!input) return ''
  const withoutTags = input.replace(/<[^>]*>/g, ' ')
  return sanitizeDisplayText(withoutTags)
}

export function plainTextBlock(input?: string): string {
  if (!input) return ''
  const normalized = input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|h[1-6]|pre|ul|ol)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
  return sanitizeDisplayTextBlock(normalized)
}

export function plainTextParagraphs(input?: string): string[] {
  const normalized = plainTextBlock(input)
  if (!normalized) return []

  const explicitParagraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  if (explicitParagraphs.length > 1) {
    return explicitParagraphs
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length <= 1) {
    return normalized ? [normalized] : []
  }

  const paragraphs: string[] = []
  let current: string[] = []
  const flush = () => {
    if (current.length === 0) return
    paragraphs.push(current.join('\n').trim())
    current = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const next = lines[index + 1]
    current.push(line)

    if (!next) {
      flush()
      continue
    }
    if (shouldSplitPlainTextParagraph(line, next)) {
      flush()
    }
  }

  return paragraphs.length > 0 ? paragraphs : [normalized]
}

export function buildCompactTitleParts(title: string, summary?: string): { title: string; summary: string } {
  const normalizedTitle = plainText(title).trim()
  if (!normalizedTitle) return { title: '', summary: '' }
  if (!summary?.trim()) return { title: normalizedTitle, summary: '' }

  let candidate = plainText(summary).trim()
  if (!candidate) return { title: normalizedTitle, summary: '' }
  if (candidate.startsWith(normalizedTitle)) {
    candidate = candidate
      .slice(normalizedTitle.length)
      .replace(/^[\s:：,，。.!！？?、\-–—]+/, '')
      .trim()
  }
  if (!candidate) return { title: normalizedTitle, summary: '' }
  return { title: normalizedTitle, summary: truncateRunes(candidate, compactInlineSummaryMaxRunes) }
}

export function truncateRunes(input: string, maxRunes: number): string {
  if (maxRunes <= 0) return ''
  const runes = Array.from(input)
  if (runes.length <= maxRunes) return input
  return `${runes.slice(0, maxRunes).join('')}...`
}

export function sanitizeDisplayText(input: string): string {
  let value = decodeHTMLEntities(input)
  value = stripFeedBoilerplate(value)
  value = value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
  return value.trim()
}

export function sanitizeDisplayTextBlock(input: string): string {
  let value = decodeHTMLEntities(input)
  value = stripFeedBoilerplate(value)
  value = value
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
  return value.trim()
}

function shouldSplitPlainTextParagraph(currentLine: string, nextLine: string): boolean {
  if (!currentLine || !nextLine) return false
  if (isPlainTextListLine(nextLine)) return true
  if (/[。！？.!?]["'”’」』)]*$/.test(currentLine) && currentLine.length >= 24 && nextLine.length >= 8) {
    return true
  }
  return false
}

function isPlainTextListLine(line: string): boolean {
  return /^([-*•]\s+|\d+[.)]\s+)/.test(line)
}

export function stripFeedBoilerplate(input: string): string {
  // Common feed boilerplate tail found in Reddit/HN mirrors.
  return input
    .replace(/submitted by\s+\/u\/[a-z0-9_-]+/gi, ' ')
    .replace(/\[(?:link|comments?)\]/gi, ' ')
}

export function decodeHTMLEntities(input: string): string {
  if (!input) return ''

  let value = input

  if (typeof document !== 'undefined') {
    const parser = document.createElement('textarea')
    parser.innerHTML = value
    value = parser.value
  }

  // Fallback decoding for environments or payloads that still keep entities.
  value = value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);?/g, (_m, dec: string) => {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' '
    })
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' '
    })

  return value
}

export function truncate(input: string, size: number): string {
  if (input.length <= size) return input
  return `${input.slice(0, size)}...`
}

export function formatDateTime(input?: string): string {
  if (!input) return '-'
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatTimeAgo(input: string): string {
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

export function formatTimeAgoCompact(input: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return '-'

  const diffMS = Date.now() - date.getTime()
  if (diffMS < 60 * 1000) return '刚刚'

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day

  if (diffMS < hour) return `${Math.floor(diffMS / minute)}m`
  if (diffMS < day) return `${Math.floor(diffMS / hour)}h`
  if (diffMS < week) return `${Math.floor(diffMS / day)}d`

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function formatReplyCount(value?: number): string {
  if (value === undefined || value === null || !Number.isFinite(value) || value < 0) {
    return ''
  }
  if (value >= 10_000) {
    return `回复 ${(value / 10_000).toFixed(1).replace(/\.0$/, '')}w`
  }
  if (value >= 1_000) {
    return `回复 ${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  }
  return `回复 ${Math.floor(value)}`
}

export function resolveSourceHealth(source: Pick<Source, 'id' | 'enabled'>, statusMap: Map<number, SourceStatus>): SourceStatus['health'] {
  const status = statusMap.get(source.id)
  if (status) {
    return status.health
  }
  return source.enabled ? 'new' : 'disabled'
}

export function sourceHealthPriority(health: SourceStatus['health']): number {
  switch (health) {
    case 'error':
      return 6
    case 'warn':
      return 5
    case 'stale':
      return 4
    case 'new':
      return 3
    case 'ok':
      return 2
    case 'disabled':
      return 1
    default:
      return 0
  }
}

export function bulkActionLabel(action: BulkSourceAction): string {
  switch (action) {
    case 'enable':
      return '启用'
    case 'disable':
      return '停用'
    case 'refresh':
      return '强制刷新'
    case 'set_poll':
      return '更新抓取间隔'
    case 'enable_ai':
      return '开启 AI 速览'
    case 'disable_ai':
      return '关闭 AI 速览'
    case 'add_tags':
      return '添加标签'
    case 'remove_tags':
      return '移除标签'
    default:
      return '测试'
  }
}

export function healthLabel(health: SourceStatus['health']): string {
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

export function healthToneClass(health: SourceStatus['health']): string {
  switch (health) {
    case 'ok':
      return 'border-zinc-300 bg-zinc-100 text-zinc-900'
    case 'warn':
      return 'border-zinc-300 bg-zinc-200 text-zinc-900'
    case 'error':
      return 'border-zinc-400 bg-zinc-900 text-zinc-50'
    case 'stale':
      return 'border-zinc-300 bg-zinc-100 text-zinc-700'
    case 'disabled':
      return 'border-zinc-300 bg-zinc-200 text-zinc-700'
    default:
      return 'border-zinc-300 bg-zinc-50 text-zinc-700'
  }
}

export function confidenceLabel(confidence: 'high' | 'medium' | 'low'): string {
  switch (confidence) {
    case 'high':
      return '高置信'
    case 'medium':
      return '中置信'
    default:
      return '低置信'
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function parseRSSLines(input: string): string[] {
  const items = input
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)

  const seen = new Set<string>()
  const output: string[] = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    output.push(item)
  }
  return output
}

export function clampContextMenuPosition(x: number, y: number, menuWidth: number, menuHeight: number): { x: number; y: number } {
  const margin = 10
  const maxX = Math.max(margin, window.innerWidth - menuWidth - margin)
  const maxY = Math.max(margin, window.innerHeight - menuHeight - margin)
  return {
    x: Math.min(Math.max(x, margin), maxX),
    y: Math.min(Math.max(y, margin), maxY),
  }
}

export function parseSourceIDFilter(input: string): number[] {
  if (!input.trim()) return []
  const parts = input
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item) && item > 0)

  if (parts.length === 0) return []
  return Array.from(new Set(parts))
}

export function equalStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

export function sourceClickCount(source: Pick<Source, 'click_count'>): number {
  return Math.max(0, source.click_count ?? 0)
}

export function compareSourcesByClicksDesc(left: Source, right: Source): number {
  const countGap = sourceClickCount(right) - sourceClickCount(left)
  if (countGap !== 0) {
    return countGap
  }
  const leftTime = left.last_clicked_at ? Date.parse(left.last_clicked_at) : 0
  const rightTime = right.last_clicked_at ? Date.parse(right.last_clicked_at) : 0
  if (rightTime !== leftTime) {
    return rightTime - leftTime
  }
  return right.id - left.id
}

export function compareTrackedSourcesByActivityDesc(left: Source, right: Source): number {
  const rightActivity = sourceActivityTimestamp(right)
  const leftActivity = sourceActivityTimestamp(left)
  if (rightActivity !== leftActivity) {
    return rightActivity - leftActivity
  }
  return compareSourcesByClicksDesc(left, right)
}

export function sourceActivityTimestamp(source: Source): number {
  const fetchedAt = source.last_fetched_at ? Date.parse(source.last_fetched_at) : 0
  const clickedAt = source.last_clicked_at ? Date.parse(source.last_clicked_at) : 0
  const updatedAt = source.updated_at ? Date.parse(source.updated_at) : 0
  return Math.max(
    Number.isFinite(fetchedAt) ? fetchedAt : 0,
    Number.isFinite(clickedAt) ? clickedAt : 0,
    Number.isFinite(updatedAt) ? updatedAt : 0,
  )
}
