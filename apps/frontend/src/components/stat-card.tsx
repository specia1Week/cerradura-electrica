import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';

export function StatCard({
  label,
  value,
  hint,
  icon,
  trend,
  tone = 'neutral',
  delay,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: React.ReactNode;
  trend?: { value: string; positive?: boolean };
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'destructive';
  delay?: 1 | 2 | 3;
}) {
  const toneClass = {
    neutral: 'bg-muted/60 text-muted-foreground ring-border',
    primary: 'bg-primary/10 text-primary ring-primary/20',
    success: 'bg-success/10 text-success ring-success/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
    destructive: 'bg-destructive/10 text-destructive ring-destructive/20',
  }[tone];

  return (
    <div
      className={cn(
        'surface animate-fade-up p-5',
        delay === 1 && 'animate-delay-1',
        delay === 2 && 'animate-delay-2',
        delay === 3 && 'animate-delay-3',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-[28px] font-semibold tracking-[-0.04em] text-foreground">
            {typeof value === 'number' ? formatNumber(value) : value}
          </p>
        </div>
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1',
            toneClass,
          )}
        >
          {icon}
        </div>
      </div>
      {(hint || trend) && (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          {trend && (
            <span
              className={cn(
                'inline-flex items-center gap-1 font-medium',
                trend.positive ? 'text-success' : 'text-destructive',
              )}
            >
              {trend.positive ? (
                <ArrowUpRight className="h-3.5 w-3.5" />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5" />
              )}
              {trend.value}
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  );
}
