import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { Check, ChevronDown, ChevronRight, ChevronUp, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ArticleSummaryLibraryItem, FeedBriefingLibraryItem } from '../../types'
import { extractBriefingLead, stripMarkdown } from './briefing-utils'

type BriefingArticleRef = FeedBriefingLibraryItem['article_refs'][number]

type DeepReadRecommendation = {
  title: string
  url: string
  reason: string
}

type BriefingDocumentProps = {
  item: FeedBriefingLibraryItem
  articleSummaries: ArticleSummaryLibraryItem[]
  collapsed: boolean
  read: boolean
  formatTimeAgo: (input: string) => string
  onToggleCollapsed: () => void
  onToggleRead: () => void
  onOpenArticle: (articleID: number) => void
  onOpenReadingContext: () => void
}

const INTERNAL_ARTICLE_LINK_PREFIX = '#quick-article-'

function linkBriefingArticleReferences(summary: string): string {
  return summary.replace(/\[A(\d{1,3})\]/g, (match, rawIndex: string, offset: number, source: string) => {
    if (source[offset - 1] === '[' || source[offset + match.length] === ']') return match
    const index = Number.parseInt(rawIndex, 10)
    return Number.isFinite(index) && index > 0 ? `[${index}](${INTERNAL_ARTICLE_LINK_PREFIX}${index})` : match
  })
}

function findDeepReadSectionIndex(lines: string[]): number {
  return lines.findIndex((line) => /(?:^|\s)(?:6[).、]\s*)?值得深读/.test(stripMarkdown(line)))
}

function findNextBriefingSectionIndex(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    const plainLine = stripMarkdown(lines[index])
    if (/^(?:\d+[).、]\s*)?(?:今日判断|内容类型|重点主题|长文论点|风险|争议|不确定性)/.test(plainLine)) return index
  }
  return lines.length
}

function summaryWithoutDeepReadSection(summary: string): string {
  const lines = summary.split('\n')
  const startIndex = findDeepReadSectionIndex(lines)
  if (startIndex < 0) return summary
  const endIndex = findNextBriefingSectionIndex(lines, startIndex + 1)
  return [...lines.slice(0, startIndex), ...lines.slice(endIndex)].join('\n').trim()
}

function cleanDeepReadTitle(value: string): string {
  return value
    .replace(/^\s*(?:[-*+]\s+|\d+[).、]\s*)/, '')
    .replace(/^\s*\[[A-Z]\d{1,3}\]\s*/, '')
    .replace(/\s*[|｜]\s*$/, '')
    .trim()
}

function parseDeepReadLine(rawLine: string): DeepReadRecommendation | null {
  const line = rawLine.trim().replace(/^\s*(?:[-*+]\s+|\d+[).、]\s*)/, '').trim()
  if (!line.includes('｜') && !/^https?:\/\//.test(line)) return null

  const markdownLink = line.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/)
  const bareURL = line.match(/https?:\/\/[^\s<>\])）｜|]+/)
  const url = markdownLink?.[2] ?? bareURL?.[0] ?? ''
  if (!url) return null

  const parts = line
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/, '$1')
    .split('｜')
    .map((part) => stripMarkdown(part).trim())
    .filter(Boolean)
  const title = cleanDeepReadTitle(parts[0] ?? markdownLink?.[1] ?? '原文')
  const urlPartIndex = parts.findIndex((part) => part.includes(url) || part === markdownLink?.[1] || part === '原文')
  return { title, url, reason: parts.filter((_, index) => index !== 0 && index !== urlPartIndex)[0] ?? '' }
}

function parseDeepReadRecommendations(summary: string): DeepReadRecommendation[] {
  const lines = summary.split('\n')
  const startIndex = findDeepReadSectionIndex(lines)
  if (startIndex < 0) return []

  const recommendations: DeepReadRecommendation[] = []
  for (const rawLine of lines.slice(startIndex + 1)) {
    const plainLine = stripMarkdown(rawLine)
    if (!plainLine) continue
    if (/^(?:#{1,6}\s*)?(?:\d+[).、]\s*)?(?:今日判断|内容类型|重点主题|长文论点|风险|争议|不确定性)/.test(plainLine)) break
    const recommendation = parseDeepReadLine(rawLine)
    if (recommendation) recommendations.push(recommendation)
    if (recommendations.length >= 5) break
  }
  return recommendations
}

function canonicalArticleURL(input: string): string {
  const raw = input.trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    return url.toString().replace(/\/$/, '')
  } catch {
    return raw.toLowerCase().replace(/\/$/, '')
  }
}

function normalizeMatchText(input: string): string {
  return stripMarkdown(input).toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^\p{L}\p{N}]+/gu, '').trim()
}

function findMatchingArticleRef(recommendation: DeepReadRecommendation, articleRefs: BriefingArticleRef[]): BriefingArticleRef | null {
  const recommendationURL = canonicalArticleURL(recommendation.url)
  const byURL = articleRefs.find((article) => canonicalArticleURL(article.link) === recommendationURL)
  if (byURL) return byURL

  const recommendationTitle = normalizeMatchText(recommendation.title)
  return articleRefs.find((article) => {
    const title = normalizeMatchText(article.title)
    return title === recommendationTitle || title.includes(recommendationTitle) || recommendationTitle.includes(title)
  }) ?? null
}

function LinkedBriefingMarkdown(props: {
  content: string
  articleRefs: BriefingArticleRef[]
  onOpenArticle: (articleID: number) => void
}) {
  const content = useMemo(() => linkBriefingArticleReferences(props.content), [props.content])
  if (!content.trim()) return null

  return (
    <div className="ai-briefing-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ href, children, ...linkProps }) => {
            if (href?.startsWith(INTERNAL_ARTICLE_LINK_PREFIX)) {
              const index = Number.parseInt(href.slice(INTERNAL_ARTICLE_LINK_PREFIX.length), 10)
              const article = props.articleRefs[index - 1]
              if (!article) return <sup className="ai-citation-missing">{children}</sup>
              return (
                <Button
                  type="button"
                  variant="ghost"
                  className="ai-citation-link"
                  title={article.title}
                  aria-label={`打开关联文章：${article.title}`}
                  onClick={() => props.onOpenArticle(article.id)}
                >
                  {children}
                </Button>
              )
            }
            return <a {...linkProps} href={href} target="_blank" rel="noreferrer">{children}</a>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export function BriefingDocument(props: BriefingDocumentProps) {
  const { item, articleSummaries, collapsed, read, formatTimeAgo, onToggleCollapsed, onToggleRead, onOpenArticle, onOpenReadingContext } = props
  const [showAllReferences, setShowAllReferences] = useState(false)
  const recommendations = parseDeepReadRecommendations(item.summary)
  const summary = recommendations.length > 0 ? summaryWithoutDeepReadSection(item.summary) : item.summary
  const visibleReferences = showAllReferences ? item.article_refs : item.article_refs.slice(0, 6)
  const scope = item.scope_label || '当前阅读流'

  return (
    <article className={`ai-briefing-document ${read ? 'is-read' : 'is-unread'}`}>
      <header className="ai-briefing-document-head">
        <Button type="button" variant="ghost" className="ai-briefing-title-button" onClick={onToggleCollapsed} aria-expanded={!collapsed}>
          <span className="ai-briefing-source">{scope}</span>
          <span className="ai-briefing-meta">
            {formatTimeAgo(item.generated_at)} · {item.article_count || item.article_refs.length} 篇文章
            {item.truncated ? ' · 输出不完整' : ''}
          </span>
        </Button>
        <div className="ai-briefing-actions">
          <Button type="button" variant="ghost" size="sm" className={`ai-briefing-read-button ${read ? 'active' : ''}`} onClick={onToggleRead}>
            <Check aria-hidden="true" />
            {read ? '已读' : '标为已读'}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="ai-icon-button" onClick={onOpenReadingContext} title="回到生成这份速览时的阅读视角">
            <ExternalLink aria-hidden="true" />
            <span className="sr-only">回到阅读视角</span>
          </Button>
          <Button type="button" variant="ghost" size="icon" className="ai-icon-button" onClick={onToggleCollapsed} aria-label={collapsed ? '展开简报' : '收起简报'}>
            {collapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
          </Button>
        </div>
      </header>

      {collapsed ? (
        <Button type="button" variant="ghost" className="ai-briefing-collapsed-preview" onClick={onToggleCollapsed}>
          {extractBriefingLead(item.summary)}
        </Button>
      ) : (
        <div className="ai-briefing-document-body">
          {recommendations.length > 0 && (
            <section className="ai-priority-reading" aria-labelledby={`priority-${item.digest_key}`}>
              <div className="ai-section-label" id={`priority-${item.digest_key}`}>优先阅读</div>
              <div className="ai-priority-list">
                {recommendations.map((recommendation, index) => {
                  const article = findMatchingArticleRef(recommendation, item.article_refs)
                  const content = (
                    <>
                      <span className="ai-priority-index">{index + 1}</span>
                      <span className="ai-priority-copy">
                        <strong>{recommendation.title}</strong>
                        {recommendation.reason && <span>{recommendation.reason}</span>}
                      </span>
                      <ChevronRight aria-hidden="true" />
                    </>
                  )
                  return article ? (
                    <Button key={`${recommendation.url}-${index}`} type="button" variant="ghost" className="ai-priority-item" onClick={() => onOpenArticle(article.id)}>{content}</Button>
                  ) : (
                    <a key={`${recommendation.url}-${index}`} className="ai-priority-item" href={recommendation.url} target="_blank" rel="noreferrer">{content}</a>
                  )
                })}
              </div>
            </section>
          )}

          <LinkedBriefingMarkdown content={summary} articleRefs={item.article_refs} onOpenArticle={onOpenArticle} />

          {item.article_refs.length > 0 && (
            <section className="ai-briefing-sources">
              <Button type="button" variant="ghost" className="ai-briefing-sources-toggle" onClick={() => setShowAllReferences((current) => !current)} aria-expanded={showAllReferences}>
                <span>本次简报依据 {item.article_refs.length} 篇文章</span>
                {showAllReferences ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              </Button>
              {showAllReferences && (
                <div className="ai-briefing-source-list">
                  {visibleReferences.map((article, index) => {
                    const hasSummary = articleSummaries.some((summaryItem) => summaryItem.article_id === article.id)
                    return (
                      <Button key={article.id} type="button" variant="ghost" className="ai-briefing-source-item" onClick={() => onOpenArticle(article.id)}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <span>
                          <strong>{article.title}</strong>
                          <small>{article.source_name || `来源 ${article.source_id}`}{article.published_at ? ` · ${formatTimeAgo(article.published_at)}` : ''}{hasSummary ? ' · 已有摘要' : ''}</small>
                        </span>
                        <ChevronRight aria-hidden="true" />
                      </Button>
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </article>
  )
}
