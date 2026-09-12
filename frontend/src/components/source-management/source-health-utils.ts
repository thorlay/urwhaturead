import type { Source, SourceStatus } from '../../types'

export function sourceFailureSummary(source: Source, status?: SourceStatus): string {
  if (!source.enabled) return '已停用'
  const httpStatus = status?.latest_http_status
  const rawError = status?.last_error?.trim().toLowerCase() ?? ''
  if (httpStatus === 429) return '来源限流'
  if (typeof httpStatus === 'number' && httpStatus >= 500) return '上游暂时不可用'
  if (rawError.includes('context deadline exceeded') || rawError.includes('client.timeout')) return 'RSSHub 或网络无响应'
  if (rawError.includes('parse feed failed') || rawError.includes('xml syntax error')) return '订阅源内容无法解析'
  if (rawError) return '抓取失败'
  if (status?.health === 'stale') return '长时间未更新'
  if (status?.health === 'warn') return '需要检查'
  if (!status?.latest_fetched_at) return '等待首次抓取'
  return '近期抓取正常'
}

export function sourceNextFetchLabel(source: Source, status?: SourceStatus): string | null {
  if (!source.enabled || !status?.next_due_at) return null
  const remainingMS = Date.parse(status.next_due_at) - Date.now()
  if (!Number.isFinite(remainingMS) || remainingMS <= 0) return '等待调度'
  const remainingMinutes = Math.ceil(remainingMS / 60_000)
  const action = status.consecutive_failures > 0 ? '重试' : '抓取'
  if (remainingMinutes < 60) return `约 ${remainingMinutes} 分钟后${action}`
  return `约 ${Math.ceil(remainingMinutes / 60)} 小时后${action}`
}
