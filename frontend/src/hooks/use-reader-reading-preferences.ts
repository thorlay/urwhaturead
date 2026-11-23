import { useEffect, useState } from 'react'
import type { ReaderView } from '../lib/app-domain'

type ReadingFontSize = 'compact' | 'default' | 'large'
type ReadingWidth = 'narrow' | 'default' | 'wide'
type ReadingLineHeight = 'tight' | 'default' | 'loose'

export type ReadingPreferences = {
  fontSize: ReadingFontSize
  width: ReadingWidth
  lineHeight: ReadingLineHeight
}

const READING_PREFERENCES_STORAGE_KEY = 'quick.reader.detail_preferences'
const DEFAULT_READING_PREFERENCES: ReadingPreferences = {
  fontSize: 'default',
  width: 'default',
  lineHeight: 'default',
}

function isReadingFontSize(value: unknown): value is ReadingFontSize {
  return value === 'compact' || value === 'default' || value === 'large'
}

function isReadingWidth(value: unknown): value is ReadingWidth {
  return value === 'narrow' || value === 'default' || value === 'wide'
}

function isReadingLineHeight(value: unknown): value is ReadingLineHeight {
  return value === 'tight' || value === 'default' || value === 'loose'
}

function readStoredReadingPreferences(): ReadingPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_READING_PREFERENCES
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(READING_PREFERENCES_STORAGE_KEY) || '{}') as Partial<ReadingPreferences>
    return {
      fontSize: isReadingFontSize(parsed.fontSize) ? parsed.fontSize : DEFAULT_READING_PREFERENCES.fontSize,
      width: isReadingWidth(parsed.width) ? parsed.width : DEFAULT_READING_PREFERENCES.width,
      lineHeight: isReadingLineHeight(parsed.lineHeight) ? parsed.lineHeight : DEFAULT_READING_PREFERENCES.lineHeight,
    }
  } catch {
    return DEFAULT_READING_PREFERENCES
  }
}

export function useReaderReadingPreferences(readerView: ReaderView) {
  const [readingPreferences, setReadingPreferences] = useState<ReadingPreferences>(readStoredReadingPreferences)
  const readingPreferenceClassName =
    readerView === 'detail'
      ? `detail-font-${readingPreferences.fontSize} detail-width-${readingPreferences.width} detail-line-${readingPreferences.lineHeight}`
      : ''

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.setItem(READING_PREFERENCES_STORAGE_KEY, JSON.stringify(readingPreferences))
    } catch {
      // Ignore storage failures; controls still work for the current session.
    }
  }, [readingPreferences])

  return { readingPreferences, setReadingPreferences, readingPreferenceClassName }
}
