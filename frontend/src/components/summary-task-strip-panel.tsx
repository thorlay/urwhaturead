import type { SummaryTask } from '../lib/app-domain'
import { SummaryTaskStrip } from './summary-task-strip'

type SummaryTaskStats = {
  running: number
  queued: number
  failed: number
  succeeded: number
}

type SummaryTaskStripPanelProps = {
  tasks: SummaryTask[]
  stats: SummaryTaskStats
  onClearCompleted: () => void
  onOpenTask: (task: SummaryTask) => void
  onDismissTask: (taskKey: string) => void
  summaryTaskKindLabel: (kind: SummaryTask['kind']) => string
  summaryTaskStatusLabel: (status: SummaryTask['status']) => string
  formatTimeAgo: (input: string) => string
}

export function SummaryTaskStripPanel(props: SummaryTaskStripPanelProps) {
  return <SummaryTaskStrip {...props} />
}
