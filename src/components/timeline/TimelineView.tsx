'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CalendarClock, CalendarX, Diamond, GitBranch, GanttChart, Unlink } from 'lucide-react'
import { ViewSwitcher } from '@/components/ViewSwitcher'
import { TicketDetailModal } from '@/components/kanban/TicketDetailModal'
import type { BoardStatus } from '@/components/kanban/status-utils'
import { TreeDetailPanel } from '@/components/tree/TreeDetailPanel'
import { buildTreeModel, dayString, type Person } from '@/components/tree/tree-model'
import type { Milestone, Project, Team, Ticket } from '@/payload-types'
import { TimelineChart, type ChartMilestone, type TimelineChartHandle, type ZoomPreset } from './TimelineChart'
import { TimelineFilters } from './TimelineFilters'
import { buildLanes, dayNum, dayStr, seasonRange, shortDay, type GroupBy } from './timeline-model'

export interface TimelineViewProps {
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

interface DatePatch {
  dueDate: string | null
  startDate?: string | null
}

interface Toast {
  key: number
  message: string
  tone: 'ok' | 'error'
  undo?: () => void
}

const TOAST_MS = 10_000

const GROUPS: Array<{ key: GroupBy; label: string }> = [
  { key: 'project', label: 'Project' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'milestone', label: 'Milestone' },
]

const ZOOMS: Array<{ key: ZoomPreset; label: string; short: string }> = [
  { key: '2w', label: '2 weeks', short: '2W' },
  { key: 'month', label: 'Month', short: 'M' },
  { key: 'quarter', label: 'Quarter', short: 'Q' },
  { key: 'season', label: 'Season', short: 'S' },
  { key: 'fit', label: 'Fit', short: 'Fit' },
]

/** Stored dates are ISO timestamps at UTC midnight; a picked day becomes exactly that. */
function toStored(value: string | null | undefined): string | null {
  if (!value) return null
  return value.length === 10 ? `${value}T00:00:00.000Z` : value
}

export function TimelineView(props: TimelineViewProps) {
  const { projects, people, milestones, statuses, truncated, totalInScope, limit, filters } = props
  const [tickets, setTickets] = useState<Ticket[]>(props.tickets)
  useEffect(() => setTickets(props.tickets), [props.tickets])
  const ticketsRef = useRef(tickets)
  ticketsRef.current = tickets

  // "Today" comes from the viewer's clock after mount (same rule as the Tree view).
  const [todayStr, setTodayStr] = useState<string | null>(null)
  useEffect(() => setTodayStr(dayString(new Date())), [])

  const [groupBy, setGroupBy] = useState<GroupBy>('project')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [openTrays, setOpenTrays] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fullTicketId, setFullTicketId] = useState<string | null>(null)
  const [showDeps, setShowDeps] = useState(false)
  const [preset, setPreset] = useState<ZoomPreset | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const chartRef = useRef<TimelineChartHandle>(null)

  const model = useMemo(
    () => (todayStr ? buildTreeModel({ tickets, projects, people, milestones, statuses, today: todayStr }) : null),
    [tickets, projects, people, milestones, statuses, todayStr],
  )
  const built = useMemo(
    () => (model ? buildLanes({ model, groupBy, projects, milestones, people }) : null),
    [model, groupBy, projects, milestones, people],
  )

  const today = todayStr ? dayNum(todayStr) : 0
  const season = useMemo(() => seasonRange(today), [today])

  // Milestones that apply to this scope: global ones plus those of the filtered project.
  const chartMilestones = useMemo<ChartMilestone[]>(
    () =>
      milestones
        .filter((m) => m.date && (!filters.project || !m.project || m.project === filters.project))
        .map((m) => ({ id: m.id, name: m.name, day: dayNum(String(m.date)), color: m.color || '#a855f7' })),
    [milestones, filters.project],
  )

  const span = built?.span ?? null
  const fit = useMemo(() => {
    const days = chartMilestones.map((m) => m.day)
    if (span) days.push(span.min, span.max)
    if (!days.length) return { start: today - 14, end: today + 60 }
    return { start: Math.min(...days) - 7, end: Math.max(...days) + 7 }
  }, [span, chartMilestones, today])

  // The scrollable domain. Snapped to whole months so it only changes when something is
  // dated outside it, never on every drag.
  const domain = useMemo(() => {
    const lo = Math.min(fit.start, season.start, today) - 31
    const hi = Math.max(fit.end, season.end, today) + 62
    const loS = dayStr(lo)
    const hiS = dayStr(hi)
    return { start: dayNum(`${loS.slice(0, 7)}-01`), end: dayNum(`${hiS.slice(0, 7)}-28`) }
  }, [fit, season, today])

  /* --- toasts ----------------------------------------------------------- */
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast((cur) => (cur?.key === toast.key ? null : cur)), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast])

  /* --- writes ----------------------------------------------------------- */
  const applyLocal = useCallback((id: string, patch: DatePatch) => {
    setTickets((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              dueDate: toStored(patch.dueDate),
              ...(patch.startDate !== undefined ? { startDate: toStored(patch.startDate) } : {}),
            }
          : t,
      ),
    )
  }, [])

  const writeDates = useCallback(
    async (id: string, next: DatePatch, prev: DatePatch, describe: string, isUndo = false) => {
      applyLocal(id, next)
      try {
        const res = await fetch(`/api/tickets/${id}?depth=0`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(next),
        })
        if (!res.ok) {
          let msg = `Save failed (${res.status})`
          try {
            const body = await res.json()
            msg = body?.errors?.[0]?.message ?? msg
          } catch {}
          throw new Error(msg)
        }
        const body = await res.json()
        const doc = body?.doc ?? body
        // Take the server's stored values (and updatedAt) as the truth.
        setTickets((list) =>
          list.map((t) =>
            t.id === id
              ? { ...t, dueDate: doc.dueDate ?? null, startDate: doc.startDate ?? null, updatedAt: doc.updatedAt ?? t.updatedAt }
              : t,
          ),
        )
        setToast({
          key: Date.now(),
          tone: 'ok',
          message: isUndo ? `Undone: ${describe}` : describe,
          undo: isUndo ? undefined : () => void writeDates(id, prev, next, describe, true),
        })
      } catch (err) {
        applyLocal(id, prev)
        setToast({ key: Date.now(), tone: 'error', message: err instanceof Error ? err.message : 'Save failed' })
      }
    },
    [applyLocal],
  )

  const onMove = useCallback(
    (id: string, delta: number) => {
      const item = built?.items.get(id)
      const ticket = ticketsRef.current.find((t) => t.id === id)
      if (!item || !ticket || !delta) return
      const next: DatePatch = { dueDate: dayStr(item.end + delta) }
      const prev: DatePatch = { dueDate: ticket.dueDate ?? null }
      if (item.kind === 'bar') {
        next.startDate = dayStr(item.start + delta)
        prev.startDate = ticket.startDate ?? null
      }
      const what = item.kind === 'bar' ? `${shortDay(item.start + delta)} to ${shortDay(item.end + delta)}` : `due ${shortDay(item.end + delta, true)}`
      void writeDates(id, next, prev, `${item.info.ref} moved: ${what}`)
    },
    [built, writeDates],
  )

  const onSchedule = useCallback(
    (id: string, day: number) => {
      const ticket = ticketsRef.current.find((t) => t.id === id)
      const info = model?.tickets.get(id)
      if (!ticket || !info) return
      void writeDates(id, { dueDate: dayStr(day) }, { dueDate: ticket.dueDate ?? null }, `${info.ref} scheduled: due ${shortDay(day, true)}`)
    },
    [model, writeDates],
  )

  /* --- lane state --------------------------------------------------------- */
  const toggleLane = useCallback((id: string) => setCollapsed((prev) => toggled(prev, id)), [])
  const toggleTray = useCallback((id: string) => setOpenTrays((prev) => toggled(prev, id)), [])

  const allCollapsed = !!built && built.lanes.length > 0 && built.lanes.every((l) => collapsed.has(l.id))
  const toggleAllLanes = () => setCollapsed(allCollapsed ? new Set() : new Set(built?.lanes.map((l) => l.id)))
  const lanesWithTrays = built?.lanes.filter((l) => l.unscheduled.length) ?? []
  const allTraysOpen = lanesWithTrays.length > 0 && lanesWithTrays.every((l) => openTrays.has(l.id))
  const toggleAllTrays = () => setOpenTrays(allTraysOpen ? new Set() : new Set(lanesWithTrays.map((l) => l.id)))

  const select = useCallback((id: string | null) => setSelectedId(id), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !fullTicketId) setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullTicketId])

  const selected = selectedId && model ? model.tickets.get(selectedId) ?? null : null
  const fullTicket = fullTicketId ? tickets.find((t) => t.id === fullTicketId) ?? null : null

  const segBtn = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
      active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-background/50 px-4 py-4 backdrop-blur-sm sm:px-8 sm:py-5">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-4 sm:gap-6">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Timeline</h1>
          <div className="hidden h-6 w-px bg-border/50 sm:block" />
          <div className="max-w-full overflow-x-auto">
            <ViewSwitcher />
          </div>
        </div>
        <TimelineFilters projects={projects} people={people} milestones={milestones} filters={filters} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/50 px-4 py-2 sm:px-8">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Lanes</span>
          <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border/50 bg-secondary/40 p-0.5" role="radiogroup" aria-label="Group lanes by">
            {GROUPS.map((g) => (
              <button key={g.key} type="button" role="radio" aria-checked={groupBy === g.key} className={segBtn(groupBy === g.key)} onClick={() => setGroupBy(g.key)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Zoom</span>
          <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border/50 bg-secondary/40 p-0.5" role="radiogroup" aria-label="Zoom">
            {ZOOMS.map((z) => (
              <button
                key={z.key}
                type="button"
                role="radio"
                aria-checked={preset === z.key}
                title={z.key === 'season' ? `Season: ${shortDay(season.start, true)} to ${shortDay(season.end, true)}` : z.label}
                className={segBtn(preset === z.key)}
                onClick={() => chartRef.current?.zoom(z.key)}
              >
                <span className="hidden md:inline">{z.label}</span>
                <span className="md:hidden">{z.short}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => chartRef.current?.scrollToToday()}
            className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary/60"
          >
            Today
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={showDeps}
            onClick={() => setShowDeps((v) => !v)}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              showDeps ? 'border-primary/60 bg-primary/15 text-primary' : 'border-border/60 text-muted-foreground hover:text-foreground'
            }`}
          >
            <GitBranch className="h-3.5 w-3.5" />
            Dependencies
          </button>
          <button type="button" onClick={toggleAllLanes} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
          {lanesWithTrays.length > 0 && (
            <button type="button" onClick={toggleAllTrays} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
              {allTraysOpen ? 'Hide undated' : 'Show undated'}
            </button>
          )}
        </div>
      </div>

      {/* Summary strip */}
      {built && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/50 px-4 py-2 text-xs text-muted-foreground sm:px-8">
          <Stat icon={<GanttChart className="h-3.5 w-3.5" />} value={built.summary.bars} label="scheduled" />
          <Stat icon={<Diamond className="h-3.5 w-3.5" />} value={built.summary.points} label="due-only" />
          <Stat icon={<CalendarX className="h-3.5 w-3.5" />} value={built.summary.unscheduled} label="unscheduled" />
          <Stat icon={<AlertTriangle className="h-3.5 w-3.5" />} value={built.summary.overdue} label="overdue" tone={built.summary.overdue ? 'text-red-300' : ''} />
          <Stat
            icon={<Unlink className="h-3.5 w-3.5" />}
            value={built.summary.conflicts}
            label={built.summary.conflicts === 1 ? 'date conflict' : 'date conflicts'}
            tone={built.summary.conflicts ? 'text-red-300' : ''}
            title="A blocker is due after the ticket it blocks"
          />
          <span className="hidden items-center gap-1 lg:flex">
            <CalendarClock className="h-3.5 w-3.5" />
            Drag a marker to reschedule; Alt+Arrow keys move a focused one by a day.
          </span>
        </div>
      )}

      {truncated && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200 sm:px-8">
          Showing the first {limit} of {totalInScope} tickets in scope. Narrow the filters for a complete timeline.
        </div>
      )}

      {/* Body */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {!built || !model || !todayStr ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Laying out the timeline</div>
        ) : model.summary.total === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            No tickets in this scope. Change the filters above.
          </div>
        ) : (
          <TimelineChart
            ref={chartRef}
            lanes={built.lanes}
            items={built.items}
            conflicts={built.conflicts}
            milestones={chartMilestones}
            today={today}
            domain={domain}
            season={season}
            fit={fit}
            collapsed={collapsed}
            openTrays={openTrays}
            selectedId={selectedId}
            showDeps={showDeps}
            onToggleLane={toggleLane}
            onToggleTray={toggleTray}
            onSelect={select}
            onMove={onMove}
            onSchedule={onSchedule}
            onPresetChange={setPreset}
          />
        )}

        {selected && model && todayStr && (
          <>
            <div className="fixed inset-0 z-30 bg-black/40 sm:hidden" onClick={() => setSelectedId(null)} />
            <TreeDetailPanel
              key={selected.id}
              info={selected}
              model={model}
              today={todayStr}
              onClose={() => setSelectedId(null)}
              onSelect={select}
              onOpenFull={() => setFullTicketId(selected.id)}
            />
          </>
        )}

        {toast && (
          <div
            role="status"
            aria-live="polite"
            className={`absolute bottom-4 left-4 z-50 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-2xl ${
              toast.tone === 'error' ? 'border-red-500/50 bg-red-950 text-red-100' : 'border-border bg-card text-foreground'
            }`}
          >
            <span className="truncate">{toast.message}</span>
            {toast.undo && (
              <button
                type="button"
                onClick={() => {
                  const undo = toast.undo
                  setToast(null)
                  undo?.()
                }}
                className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-[var(--primary-hover)]"
              >
                Undo
              </button>
            )}
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
              Close
            </button>
          </div>
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

function toggled(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function Stat({
  icon,
  value,
  label,
  tone = '',
  title,
}: {
  icon: React.ReactNode
  value: number
  label: string
  tone?: string
  title?: string
}) {
  return (
    <span className={`flex items-center gap-1 tabular-nums ${tone}`} title={title}>
      {icon}
      <span className="font-semibold">{value}</span>
      {label}
    </span>
  )
}
