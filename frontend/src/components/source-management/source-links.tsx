import { ExternalLink } from 'lucide-react'

function safeExternalURL(rawURL: string): string | null {
  try {
    const url = new URL(rawURL.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function SourceURLLink({ url }: { url: string }) {
  const href = safeExternalURL(url)
  if (!href) return <>{url}</>
  return (
    <a className="source-url-link" href={href} target="_blank" rel="noreferrer" title={`打开 RSS：${url}`}>
      <span>{url}</span>
      <ExternalLink aria-hidden="true" />
    </a>
  )
}

export function SourceURLIconLink({ url }: { url: string }) {
  const href = safeExternalURL(url)
  if (!href) return null
  return (
    <a className="source-url-icon" href={href} target="_blank" rel="noreferrer" aria-label={`打开 RSS：${url}`} title={`打开 RSS：${url}`}>
      <ExternalLink aria-hidden="true" />
    </a>
  )
}
