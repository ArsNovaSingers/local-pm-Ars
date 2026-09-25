'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Ban, CalendarX, GitFork, ListTree, Route, UserX } from 'lucide-react'
import { ViewSwitcher } from '@/components/ViewSwitcher'
import { TicketDetailModal } from '@/components/kanban/TicketDetailModal'
import type { BoardStatus } from '@/components/kanban/status-utils'
import type { Milestone, Project, Team, Ticket } from '@/payload-types'
import { TreeCanvas } from './TreeCanvas'
import { TreeOutline } from './TreeOutline'
import { TreeDetailPanel } from './TreeDetailPanel'
import styles from './tree.module.css'
import { buildTreeModel, dayString, layoutTree, type Person } from './tree-model'

export interface TreeViewProps {
  tickets: Ticket[]
  projects: Array<{ id: string; name: string; prefix?: string; color?: string | null }>
  people: Person[]
  milestones: Array<{ id: string; name: string; date?: string | null; color?: string | null; project?: string | null }>
  statuses: BoardStatus[]
  truncated: boolean
  totalInScope: number
  limit: number
  filters: { project: string | null; team: string | null; milestone: string | null }
}

type Tab = 'tree' | 'outline'

/** Above this many tickets the tree opens with its groups collapsed. */
const AUTO_COLLAPSE_OVER = 80

export function TreeView(props: TreeViewProps) {
  const { projects, people, milestones, statuses, truncated, totalInScope, limit, filters } = props
  const [tickets, setTickets] = useState<Ticket[]>(props.tickets)
  useEffect(() => setTickets(props.tickets), [props.tickets])

  // "Today" comes from the viewer's clock, after mount, so overdue is judged in their
  // timezone rather than the server's (and server/client markup cannot disagree).
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => setToday(dayString(new Date())), [])

  const [tab, setTab] = useState<Tab>('tree')
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fullTicketId, setFullTicketId] = useState<string | null>(null)
  const [fitSignal, setFitSignal] = useState(0)

  const model = useMemo(
    () => (today ? buildTreeModel({ tickets, projects, people, milestones, statuses, today }) : null),
    [tickets, projects, people, milestones, statuses, today],
  )
  const layout = useMemo(() => (model ? layoutTree(model.roots, closed) : null), [model, closed])

  // A large scope opens as a table of contents (groups collapsed) rather than as a
  // 15%-zoom wall of cards. Re-evaluated whenever the filters load a new ticket set.
  const [autoCollapsedFor, setAutoCollapsedFor] = useState<Ticket[] | null>(null)
  useEffect(() => {
    if (!model || autoCollapsedFor === props.tickets) return
    setAutoCollapsedFor(props.tickets)
    const next = new Set<string>()
    if (model.summary.total > AUTO_COLLAPSE_OVER) {
      for (const p of model.roots) for (const g of p.children) next.add(g.id)
    }
    setClosed(next)
    setSelectedId(null)
    setFitSignal((n) => n + 1)
  }, [model, props.tickets, autoCollapsedFor])

  const toggle = useCallback((id: string) => {
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    setClosed(new Set())
    setFitSignal((n) => n + 1)
  }, [])
  const collapseAll = useCallback(() => {
    if (!model) return
    // Collapse groups, keep projects open: the useful "table of contents" state.
    const next = new Set<string>()
    for (const p of model.roots) for (const g of p.children) next.add(g.id)
    setClosed(next)
    setFitSignal((n) => n + 1)
  }, [model])

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id)
      if (!id || !model) return
      // Selecting a ticket hidden inside a collapsed group opens the way to it.
      setClosed((prev) => {
        let cur = model.parentOf.get(id)
        let changed = false
        const next = new Set(prev)
        while (cur) {
          if (next.delete(cur)) changed = true
          cur = model.parentOf.get(cur)
        }
        return changed ? next : prev
      })
    },
    [model],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !fullTicketId) setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullTicketId])

  const selected = selectedId && model ? model.tickets.get(selectedId) ?? null : null
  const fullTicket = fullTicketId ? tickets.find((t) => t.id === fullTicketId) ?? null : null

  return (
    <div className={`${styles.root} flex h-full flex-col`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-background/50 px-4 py-4 backdrop-blur-sm sm:px-8 sm:py-5">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-4 sm:gap-6">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Tree</h1>
          <div className="hidden h-6 w-px bg-border/50 sm:block" />
          <div className="max-w-full overflow-x-auto">
            <ViewSwitcher />
          </div>
        </div>
        <Filters projects={projects} people={people} milestones={milestones} filters={filters} />
      </div>

      {/* Summary strip + tabs */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/50 px-4 py-2.5 sm:px-8">
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/50 bg-secondary/40 p-0.5" role="tablist">
          <TabButton active={tab === 'tree'} onClick={() => setTab('tree')} icon={<GitFork className="h-3.5 w-3.5" />} label="Tree" />
          <TabButton active={tab === 'outline'} onClick={() => setTab('outline')} icon={<ListTree className="h-3.5 w-3.5" />} label="Outline" />
        </div>
        {model && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">
              <span className="font-semibold text-foreground">{model.summary.open}</span> open of {model.summary.total}
            </span>
            <Stat icon={<AlertTriangle className="h-3.5 w-3.5" />} value={model.summary.overdue} label="overdue" tone={model.summary.overdue ? 'text-red-300' : ''} />
            <Stat icon={<Ban className="h-3.5 w-3.5" />} value={model.summary.blocked} label="blocked" tone={model.summary.blocked ? 'text-orange-300' : ''} />
            <Stat icon={<UserX className="h-3.5 w-3.5" />} value={model.summary.unassigned} label="unassigned" />
            <Stat icon={<CalendarX className="h-3.5 w-3.5" />} value={model.summary.noDue} label="no due date" />
            <Stat
              icon={<Route className="h-3.5 w-3.5" />}
              value={model.criticalPath.length}
              label={model.criticalPath.length ? 'on critical path' : 'critical path: no open chain'}
              tone={model.criticalPath.length ? 'text-red-300' : ''}
              hideZero
            />
          </div>
        )}
      </div>

      {truncated && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200 sm:px-8">
          Showing the first {limit} of {totalInScope} tickets in scope. Blocked-by links and the critical path may be
          incomplete. Narrow the filters for a complete picture.
        </div>
      )}

      {/* Body */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {!model || !layout || !today ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Laying out the tree</div>
        ) : model.summary.total === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            No tickets in this scope. Change the filters above.
          </div>
        ) : tab === 'tree' ? (
          <TreeCanvas
            model={model}
            layout={layout}
            today={today}
            selectedId={selectedId}
            onSelect={select}
            onToggle={toggle}
            onExpandAll={expandAll}
            onCollapseAll={collapseAll}
            fitSignal={fitSignal}
          />
        ) : (
          <TreeOutline model={model} today={today} selectedId={selectedId} closed={closed} onToggle={toggle} onSelect={select} />
        )}

        {selected && model && today && (
          <>
            <div className="fixed inset-0 z-30 bg-black/40 sm:hidden" onClick={() => setSelectedId(null)} />
            <TreeDetailPanel
              key={selected.id}
              info={selected}
              model={model}
              today={today}
              onClose={() => setSelectedId(null)}
              onSelect={select}
              onOpenFull={() => setFullTicketId(selected.id)}
            />
          </>
        )}
      </div>

      {fullTicket && (
        <TicketDetailModal
          isOpen
          onClose={() => setFullTicketId(null)}
          ticket={fullTicket}
          projects={projects as unknown as Project[]}
          teams={people as unknown as Team[]}
          statuses={statuses}
          milestones={milestones as unknown as Milestone[]}
          allTickets={tickets}
          onUpdate={(updated) => setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))}
          onDelete={async (id) => {
            try {
              const res = await fetch(`/api/tickets/${id}`, { method: 'DELETE' })
              if (!res.ok) throw new Error(`Delete failed (${res.status})`)
              setTickets((prev) => prev.filter((t) => t.id !== id))
              setFullTicketId(null)
              setSelectedId(null)
            } catch (error) {
              console.error('Failed to delete ticket:', error)
            }
          }}
        />
      )}
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function Stat({
  icon,
  value,
  label,
  tone = '',
  hideZero,
}: {
  icon: React.ReactNode
  value: number
  label: string
  tone?: string
  hideZero?: boolean
}) {
  return (
    <span className={`flex items-center gap-1 tabular-nums ${tone}`}>
      {icon}
      {!(hideZero && value === 0) && <span className="font-semibold">{value}</span>}
      {label}
    </span>
  )
}

function Filters({
  projects,
  people,
  milestones,
  filters,
}: {
  projects: TreeViewProps['projects']
  people: Person[]
  milestones: TreeViewProps['milestones']
  filters: TreeViewProps['filters']
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

  const visibleMilestones = filters.project
    ? milestones.filter((m) => {
        return !m.project || m.project === filters.project
      })
    : milestones

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
