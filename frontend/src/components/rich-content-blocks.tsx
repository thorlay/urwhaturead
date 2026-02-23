import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { containsRenderableHTMLTag, plainTextBlock, sanitizeRichHTML } from '@/lib/app-utils'

export function SafeHTMLBlock(props: { content?: string; baseURL?: string }) {
  const fallbackText = useMemo(() => plainTextBlock(props.content), [props.content])
  const sanitizedHTML = useMemo(() => sanitizeRichHTML(props.content, props.baseURL), [props.content, props.baseURL])

  if (!sanitizedHTML || !containsRenderableHTMLTag(sanitizedHTML)) {
    return <p className="reading-block prose">{fallbackText}</p>
  }

  return <div className="html-block" dangerouslySetInnerHTML={{ __html: sanitizedHTML }} />
}

export function MarkdownBlock(props: { content?: string }) {
  const content = props.content?.trim()
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
