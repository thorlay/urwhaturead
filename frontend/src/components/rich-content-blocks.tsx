import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { containsRenderableHTMLTag, plainTextParagraphs, sanitizeRichHTML } from '@/lib/app-utils'

export function PlainTextBlock(props: { content?: string; className?: string }) {
  const paragraphs = useMemo(() => plainTextParagraphs(props.content), [props.content])
  if (paragraphs.length === 0) return null

  return (
    <div className={props.className ? `plain-text-block ${props.className}` : 'plain-text-block'}>
      {paragraphs.map((paragraph, index) => (
        <p key={`plain-text-paragraph-${index}`} className="plain-text-paragraph">
          {paragraph}
        </p>
      ))}
    </div>
  )
}

export function SafeHTMLBlock(props: { content?: string; baseURL?: string }) {
  const sanitizedHTML = useMemo(() => sanitizeRichHTML(props.content, props.baseURL), [props.content, props.baseURL])

  if (!sanitizedHTML || !containsRenderableHTMLTag(sanitizedHTML)) {
    return <PlainTextBlock content={props.content} className="reading-block prose" />
  }

  return <div className="html-block" dangerouslySetInnerHTML={{ __html: sanitizedHTML }} />
}

export function MarkdownBlock(props: { content?: string }) {
  const content = useMemo(() => normalizeMarkdownLinks(props.content), [props.content])
  if (!content) return null

  return (
    <div className="markdown-block">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ ...linkProps }) => <a {...linkProps} target="_blank" rel="noreferrer" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export function normalizeMarkdownLinks(rawContent?: string): string {
  const content = rawContent?.trim()
  if (!content) return ''

  return content
    .split('\n')
    .map((line) => linkifyPipeSeparatedURL(line))
    .join('\n')
}

function linkifyPipeSeparatedURL(line: string): string {
  if (!line.includes('｜')) return line

  return line.replace(/https?:\/\/[^\s<>\])）｜|]+/g, (url, offset, source) => {
    if (isMarkdownLinkURL(source, offset)) {
      return url
    }
    return `[原文](${url})`
  })
}

function isMarkdownLinkURL(source: string, offset: number): boolean {
  return offset >= 2 && source[offset - 1] === '(' && source[offset - 2] === ']'
}
