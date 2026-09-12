import { cn } from '@/lib/utils'
import type { Source, SourceStatus } from '../../types'
import { sourceFailureSummary } from './source-health-utils'

export function SourceHealthState({
  source,
  status,
  health,
  healthLabel,
  detailed = false,
}: {
  source: Source
  status?: SourceStatus
  health: SourceStatus['health']
  healthLabel: (health: SourceStatus['health']) => string
  detailed?: boolean
}) {
  const hasFailure = health === 'error' || Boolean(status?.last_error) || (status?.latest_http_status ?? 0) >= 400
  return (
    <div className="source-health-state-wrap">
      <span className={cn('source-health-state', `is-${health}`)}>{healthLabel(health)}</span>
      <p className={cn('source-health-summary', hasFailure && 'is-failure')}>{sourceFailureSummary(source, status)}</p>
      {detailed && status?.last_error && (
        <details className="source-health-details">
          <summary>技术详情</summary>
          <code>{status.last_error}</code>
        </details>
      )}
    </div>
  )
}
