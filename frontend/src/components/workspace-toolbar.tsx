import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function WorkspaceToolbar({ className, ...props }: ComponentProps<'header'>) {
  return <header className={cn('workspace-toolbar', className)} {...props} />
}
