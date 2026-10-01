'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Person } from '@/components/tree/tree-model'

/**
 * Project / assignee / milestone scope filters, written to the URL so they carry through
 * view switches (ViewSwitcher forwards the query string). Same behaviour and markup as the
 * Tree view's filter bar, which is private to TreeView.tsx.
 */
export function NetworkFilters({
  projects,
  people,
  milestones,
  filters,
}: {
  projects: Array<{ id: string; name: string; prefix?: string }>
  people: Person[]
  milestones: Array<{ id: string; name: string; project?: string | null }>
  filters: { project: string | null; team: string | null; milestone: string | null }
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const set = (key: 'project' | 'team' | 'milestone', value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    const q = params.toString()
    router.push(q ? `${pathname}?${q}` : pathname)
  }

  const visibleMilestones = filters.project ? milestones.filter((m) => !m.project || m.project === filters.project) : milestones

  const selectCls =
    'h-8 max-w-[180px] rounded-md border border-border/60 bg-secondary/30 px-2 text-xs text-foreground outline-none focus:border-primary'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Project" className={selectCls} value={filters.project ?? ''} onChange={(e) => set('project', e.target.value)}>
        <option value="">All projects</option>
        {[...projects]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.prefix ? `${p.prefix} · ` : ''}
              {p.name}
            </option>
          ))}
      </select>
      <select aria-label="Assignee" className={selectCls} value={filters.team ?? ''} onChange={(e) => set('team', e.target.value)}>
        <option value="">Everyone</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select aria-label="Milestone" className={selectCls} value={filters.milestone ?? ''} onChange={(e) => set('milestone', e.target.value)}>
        <option value="">All milestones</option>
        {visibleMilestones.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  )
}
