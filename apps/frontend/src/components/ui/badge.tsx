import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.01em]',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted/60 text-muted-foreground',
        primary: 'border-primary/25 bg-primary/[0.12] text-primary',
        success: 'border-success/25 bg-success/[0.12] text-success',
        warning: 'border-warning/25 bg-warning/[0.12] text-warning',
        destructive:
          'border-destructive/25 bg-destructive/[0.12] text-destructive',
        outline: 'border-border bg-transparent text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
