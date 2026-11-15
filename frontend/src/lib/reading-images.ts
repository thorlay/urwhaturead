import { containsRenderableHTMLTag, plainTextParagraphs, sanitizeRichHTML } from './app-utils'

export function readingParagraphParts(paragraph: string) {
  return paragraph.split(/(^\s*(?:#\d+\s+)?https?:\/\/[^\s]+\.(?:png|jpe?g|webp|gif|avif)(?:\?[^\s]*)?\s*$)/gim).filter((part) => part.trim())
}

export function readingImageURL(paragraph: string): string | null {
  const url = paragraph.trim().replace(/^#\d+\s+/, '')
  return /^https?:\/\/\S+\.(?:png|jpe?g|webp|gif|avif)(?:\?\S*)?$/i.test(url) ? url : null
}

// Use the same sanitized HTML and standalone-image rules as the body renderers.
export function readingBodyHasImages(content?: string, html = false, baseURL?: string): boolean {
  if (html) {
    const sanitized = sanitizeRichHTML(content, baseURL)
    if (sanitized && containsRenderableHTMLTag(sanitized)) {
      return Boolean(new DOMParser().parseFromString(sanitized, 'text/html').querySelector('img[src]'))
    }
  }
  return plainTextParagraphs(content).flatMap(readingParagraphParts).some((part) => readingImageURL(part) !== null)
}
