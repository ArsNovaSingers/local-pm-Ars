'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { LayoutDashboard, GanttChartSquare, Workflow } from 'lucide-react'

const VIEWS = [
  { href: '/board', label: 'Board', icon: LayoutDashboard },
  { href: '/timeline', label: 'Timeline', icon: GanttChartSquare },
  { href: '/network', label: 'Network', icon: Workflow },
]

/**
 * Board / Timeline / Network are three views of one filtered set, not three unrelated
 * pages — so switching between them carries the current filters in the URL rather than
 * resetting them.
 */
export function ViewSwitcher() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams.toString()

  return (
    <div className="inline-flex items-center gap-0.5 bg-secondary/40 border border-border/50 rounded-lg p-0.5">
      {VIEWS.map((view) => {
        const isActive = pathname === view.href || pathname?.startsWith(view.href + '/')
        const Icon = view.icon
        return (
          <Link
            key={view.href}
            href={query ? `${view.href}?${query}` : view.href}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {view.label}
          </Link>
        )
      })}
    </div>
  )
}
