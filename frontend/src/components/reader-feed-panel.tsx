import { cn } from '@/lib/utils'
import { ReaderFeedList, type ReaderFeedListProps } from './reader-feed-list'
import { ReaderFeedToolbar, type ReaderFeedToolbarProps } from './reader-feed-toolbar'

export type ReaderFeedPanelProps = ReaderFeedToolbarProps & ReaderFeedListProps

export function ReaderFeedPanel(props: ReaderFeedPanelProps) {
  const { showFloatingReader, readerView, feedTitleOnlyMode } = props

  return (
    <section
      className={cn(
        'panel feed reader-panel',
        showFloatingReader && readerView === 'stream' && 'feed-with-floating',
        feedTitleOnlyMode && 'feed-title-only',
      )}
    >
      <ReaderFeedToolbar {...props} />

      <ReaderFeedList {...props} />
    </section>
  )
}
