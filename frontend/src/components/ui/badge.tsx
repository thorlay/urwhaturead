/* eslint-disable react-refresh/only-export-components */
import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[0.7rem] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary/70 text-secondary-foreground',
        outline: 'border-border/80 bg-transparent text-muted-foreground',
        destructive: 'border-transparent bg-destructive/12 text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({ className, variant, ...props }: HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
