import type { Dispatch, SetStateAction } from 'react'
import type { ReadingPreferences } from '../hooks/use-reader-reading-preferences'

type ReaderReadingSettingsProps = {
  readingPreferences: ReadingPreferences
  setReadingPreferences: Dispatch<SetStateAction<ReadingPreferences>>
}

export function ReaderReadingSettings({ readingPreferences, setReadingPreferences }: ReaderReadingSettingsProps) {
  return (
    <details className="detail-reading-settings">
      <summary>阅读设置<span>字号 · 行宽 · 行距</span></summary>
      <div className="detail-reading-controls" aria-label="阅读设置">
        <div className="detail-reading-control-group">
          <span>字号</span>
          {[
            ['compact', '小'],
            ['default', '中'],
            ['large', '大'],
          ].map(([value, label]) => (
            <button
              key={`font-${value}`}
              type="button"
              className={`detail-reading-control ${readingPreferences.fontSize === value ? 'active' : ''}`}
              onClick={() => setReadingPreferences((current) => ({ ...current, fontSize: value as ReadingPreferences['fontSize'] }))}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="detail-reading-control-group">
          <span>行宽</span>
          {[
            ['narrow', '窄'],
            ['default', '中'],
            ['wide', '宽'],
          ].map(([value, label]) => (
            <button
              key={`width-${value}`}
              type="button"
              className={`detail-reading-control ${readingPreferences.width === value ? 'active' : ''}`}
              onClick={() => setReadingPreferences((current) => ({ ...current, width: value as ReadingPreferences['width'] }))}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="detail-reading-control-group">
          <span>行距</span>
          {[
            ['tight', '紧'],
            ['default', '中'],
            ['loose', '松'],
          ].map(([value, label]) => (
            <button
              key={`line-${value}`}
              type="button"
              className={`detail-reading-control ${readingPreferences.lineHeight === value ? 'active' : ''}`}
              onClick={() => setReadingPreferences((current) => ({ ...current, lineHeight: value as ReadingPreferences['lineHeight'] }))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </details>
  )
}
