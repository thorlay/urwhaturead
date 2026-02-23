import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn('relative w-full rounded-lg border border-border/70 bg-card px-4 py-3 text-sm text-card-foreground', className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h5 data-slot="alert-title" className={cn('mb-1 font-semibold leading-none tracking-tight', className)} {...props} />
}

function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p data-slot="alert-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
}

export { Alert, AlertTitle, AlertDescription }
