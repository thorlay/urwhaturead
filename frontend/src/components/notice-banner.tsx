import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Notice = {
  kind: 'info' | 'error'
  text: string
}

type NoticeBannerProps = {
  notice: Notice | null
  onClose: () => void
}

export function NoticeBanner(props: NoticeBannerProps) {
  const { notice, onClose } = props

  if (!notice) {
    return null
  }

  return (
    <Alert className={cn('notice', notice.kind === 'error' && 'border-destructive/60 bg-destructive/5')}>
      <div className="flex items-center justify-between gap-3">
        <AlertDescription className={notice.kind === 'error' ? 'text-destructive' : undefined}>{notice.text}</AlertDescription>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          关闭
        </Button>
      </div>
    </Alert>
  )
}
