import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type SummaryTaskStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'

type SummaryTaskBase = {
  kind: 'article_summary' | 'feed_briefing'
  key: string
  title: string
  sourceName: string
  status: SummaryTaskStatus
  updatedAt: string
  error?: string
}

type SummaryTaskStats = {
  running: number
  queued: number
  failed: number
  succeeded: number
}

type SummaryTaskStripProps<TTask extends SummaryTaskBase> = {
  tasks: TTask[]
  stats: SummaryTaskStats
  onClearCompleted: () => void
  onOpenTask: (task: TTask) => void
  onDismissTask: (taskKey: string) => void
  summaryTaskKindLabel: (kind: TTask['kind']) => string
  summaryTaskStatusLabel: (status: SummaryTaskStatus) => string
  formatTimeAgo: (input: string) => string
}

export function SummaryTaskStrip<TTask extends SummaryTaskBase>(props: SummaryTaskStripProps<TTask>) {
  const {
    tasks,
    stats,
    onClearCompleted,
    onOpenTask,
    onDismissTask,
    summaryTaskKindLabel,
    summaryTaskStatusLabel,
    formatTimeAgo,
  } = props

  if (tasks.length === 0) {
    return null
  }

  const finishedCount = stats.failed + stats.succeeded

  return (
    <section className="panel ai-task-strip">
      <div className="ai-task-strip-head">
        <div className="ai-task-strip-title">
          <h3>AI 任务队列</h3>
          <p className="hint">包含文章摘要与 AI 速览。点击任务可定位到对应内容。</p>
        </div>
        <div className="ai-task-strip-controls">
          <div className="ai-task-strip-badges" aria-label="AI 任务状态统计">
            {stats.running > 0 && <Badge variant="outline">运行中 {stats.running}</Badge>}
            {stats.queued > 0 && <Badge variant="outline">排队 {stats.queued}</Badge>}
            {stats.failed > 0 && <Badge variant="outline">失败 {stats.failed}</Badge>}
            {stats.succeeded > 0 && <Badge variant="outline">完成 {stats.succeeded}</Badge>}
          </div>
          {finishedCount > 0 && (
            <div className="ai-task-strip-actions">
              <Button type="button" variant="outline" size="sm" onClick={onClearCompleted}>
                清理已结束
              </Button>
            </div>
          )}
        </div>
      </div>
      <div className="ai-task-list">
        {tasks.map((task) => (
          <article key={task.key} className={cn('ai-task-item', `status-${task.status}`)}>
            <button type="button" className="ai-task-open" onClick={() => onOpenTask(task)}>
              <span className="ai-task-title">{task.title}</span>
              <span className="ai-task-meta">
                {summaryTaskKindLabel(task.kind)} · {task.sourceName} · {formatTimeAgo(task.updatedAt)}
              </span>
            </button>
            <div className="ai-task-row-actions">
              <Badge variant="outline" className={cn('ai-task-status', `status-${task.status}`)}>
                {summaryTaskStatusLabel(task.status)}
              </Badge>
              <Button type="button" variant="ghost" size="sm" onClick={() => onDismissTask(task.key)}>
                隐藏
              </Button>
            </div>
            {task.error && <p className="ai-task-error">{task.error}</p>}
          </article>
        ))}
      </div>
    </section>
  )
}
