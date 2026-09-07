import { ViewSwitcher } from '@/components/ViewSwitcher'
import type { ScopeData } from '@/lib/scope'

interface Stat {
  label: string
  value: number
}

interface ViewPlaceholderProps {
  title: string
  phase: string
  summary: string
  scope: ScopeData
  stats: Stat[]
  note: string
}

/**
 * The scaffolding for a view whose data layer is finished and whose canvas is not.
 *
 * It deliberately reports real numbers from the live scope rather than showing a
 * "coming soon" card: the numbers are what tell you whether the view will be worth
 * anything on the day it lands, and whether the data it needs actually exists yet.
 */
export function ViewPlaceholder({ title, phase, summary, scope, stats, note }: ViewPlaceholderProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-8 py-5 border-b border-border/50 bg-background/50 backdrop-blur-sm">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{title}</h1>
          <div className="h-6 w-px bg-border/50" />
          <ViewSwitcher />
        </div>
        <span className="text-xs font-medium text-muted-foreground px-2.5 py-1 rounded-full border border-border/50">
          {phase}
        </span>
      </div>

      <div className="flex-1 overflow-auto px-8 py-8">
        <div className="max-w-3xl">
          <p className="text-sm text-muted-foreground mb-8">{summary}</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border/40 bg-secondary/10 px-4 py-3">
                <div className="text-2xl font-semibold text-foreground tabular-nums">{stat.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border/40 border-dashed px-5 py-4 text-sm text-muted-foreground">
            {note}
          </div>

          <p className="text-xs text-muted-foreground mt-6">
            {scope.totalInScope} ticket{scope.totalInScope === 1 ? '' : 's'} in scope
            {scope.truncated ? ` — showing the first ${scope.limit}. Narrow the filters for a complete picture.` : '.'}
          </p>
        </div>
      </div>
    </div>
  )
}
