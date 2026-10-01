'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CalendarClock, Crosshair, Link2, Route, Trash2, X } from 'lucide-react'
import { ViewSwitcher } from '@/components/ViewSwitcher'
import { TicketDetailModal } from '@/components/kanban/TicketDetailModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { BoardStatus } from '@/components/kanban/status-utils'
import { buildTreeModel, dayString, formatDay, type Person } from '@/components/tree/tree-model'
import type { Milestone, Project, Team, Ticket } from '@/payload-types'
import { NetworkCanvas, type ProjectChip } from './NetworkCanvas'
import { NetworkDetailPanel } from './NetworkDetailPanel'
import { NetworkFilters } from './NetworkFilters'
import { TicketPicker } from './TicketPicker'
import { addBlocker, DependencyError, removeBlocker } from './dependency-api'
import styles from './network.module.css'
import {
  buildGraph,
  cyclePath,
  downstreamOf,
  edgeKey,
  findConflicts,
  layoutNetwork,
  longestChainInto,
  upstreamOf,
  type NetEdge,
} from './network-model'

export interface NetworkViewProps {
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

interface Toast {
  n: number
  message: string
  undo?: () => Promise<void>
}

function idOf(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) return String((value as { id: unknown }).id)
  return null
}

const TOAST_MS = 15000

export function NetworkView(props: NetworkViewProps) {
  const { projects, people, milestones, statuses, truncated, totalInScope, limit, filters } = props
  const [tickets, setTickets] = useState<Ticket[]>(props.tickets)
  useEffect(() => setTickets(props.tickets), [props.tickets])

  // "Today" from the viewer's clock, after mount (same rule as the Tree view).
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => setToday(dayString(new Date())), [])

  const [showUnconnected, setShowUnconnected] = useState(false)
  const [pathMilestone, setPathMilestone] = useState('')
  const [focusId, setFocusId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [confirmEdge, setConfirmEdge] = useState<NetEdge | null>(null)
  const [fullTicketId, setFullTicketId] = useState<string | null>(null)
  const [fitSignal, setFitSignal] = useState(0)
  const [centerOn, setCenterOn] = useState<{ id: string; n: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [error, setError] = useState<string | null>(null)

  /* --- model ---------------------------------------------------------------- */
  const model = useMemo(
    () => (today ? buildTreeModel({ tickets, projects, people, milestones, statuses, today }) : null),
    [tickets, projects, people, milestones, statuses, today],
  )
  const graph = useMemo(() => (model ? buildGraph(model, statuses) : null), [model, statuses])

  const milestone = useMemo(() => milestones.find((m) => m.id === pathMilestone) ?? null, [milestones, pathMilestone])
  const milestoneDate = milestone?.date ? String(milestone.date).slice(0, 10) : null

  /** Milestone mode: the concert's own tickets plus everything upstream of them. */
  const msFocus = useMemo(() => {
    if (!graph || !pathMilestone) return null
    const targets: string[] = []
    for (const n of graph.nodes.values()) if (idOf(n.info.raw.milestone) === pathMilestone) targets.push(n.id)
    const all = new Set(targets)
    for (const t of targets) for (const u of upstreamOf(graph, t)) all.add(u)
    return { targets, all }
  }, [graph, pathMilestone])

  const { graphIds, gridIds } = useMemo(() => {
    if (!graph) return { graphIds: [] as string[], gridIds: [] as string[] }
    if (msFocus) {
      const linked = new Set<string>()
      for (const e of graph.edges) {
        if (msFocus.all.has(e.from) && msFocus.all.has(e.to)) {
          linked.add(e.from)
          linked.add(e.to)
        }
      }
      return { graphIds: [...linked], gridIds: [...msFocus.all].filter((id) => !linked.has(id)) }
    }
    const graphIds = [...graph.connected]
    const gridIds = showUnconnected ? [...graph.nodes.keys()].filter((id) => !graph.connected.has(id)) : []
    return { graphIds, gridIds }
  }, [graph, msFocus, showUnconnected])

  const layout = useMemo(() => (graph ? layoutNetwork(graph, graphIds, gridIds) : null), [graph, graphIds, gridIds])
  const drawn = useMemo(() => new Set([...graphIds, ...gridIds]), [graphIds, gridIds])

  const criticalPath = useMemo(() => {
    if (!graph || !model) return []
    if (msFocus) return longestChainInto(graph, msFocus.targets, msFocus.all)
    return model.criticalPath.filter((id) => graph.nodes.has(id))
  }, [graph, model, msFocus])
  const pathSet = useMemo(() => new Set(criticalPath), [criticalPath])
  const pathEdges = useMemo(() => {
    const s = new Set<string>()
    for (let i = 1; i < criticalPath.length; i++) s.add(edgeKey(criticalPath[i - 1], criticalPath[i]))
    return s
  }, [criticalPath])

  const conflicts = useMemo(() => {
    if (!graph) return { edges: new Map<string, string>(), nodes: new Map<string, string[]>() }
    return findConflicts(
      graph,
      drawn,
      milestone ? { name: milestone.name, date: milestoneDate } : null,
      (d) => formatDay(d, today ?? undefined),
    )
  }, [graph, drawn, milestone, milestoneDate, today])

  const focus = useMemo(() => {
    if (!graph || !focusId || !graph.nodes.has(focusId)) return null
    return new Set([focusId, ...upstreamOf(graph, focusId), ...downstreamOf(graph, focusId)])
  }, [graph, focusId])

  const summary = useMemo(() => {
    let ready = 0
    let blocked = 0
    let edges = 0
    if (graph) {
      const ids = new Set(graphIds)
      // Ready / blocked count what is on screen: the connected graph, plus the grid when shown.
      for (const id of drawn) {
        const s = graph.nodes.get(id)!.state
        if (s === 'ready') ready += 1
        else if (s === 'blocked') blocked += 1
      }
      for (const e of graph.edges) if (ids.has(e.from) && ids.has(e.to)) edges += 1
    }
    return { ready, blocked, connected: graphIds.length, edges, chain: criticalPath.length }
  }, [graph, graphIds, drawn, criticalPath])

  const candidates = useMemo(
    () => (graph ? [...graph.nodes.values()].sort((a, b) => a.info.ref.localeCompare(b.info.ref, undefined, { numeric: true })) : []),
    [graph],
  )
  const projectChips = useMemo(
    () => new Map<string, ProjectChip>(projects.map((p) => [p.id, { name: p.name, prefix: p.prefix, color: p.color ?? null }])),
    [projects],
  )

  // Refit when the drawn set changes shape (filters, milestone, toggle) — not on edits.
  const shapeKey = `${pathMilestone}|${showUnconnected}|${props.tickets.length}|${today}`
  const lastShape = useRef('')
  useEffect(() => {
    if (!layout || lastShape.current === shapeKey) return
    lastShape.current = shapeKey
    setFitSignal((n) => n + 1)
  }, [layout, shapeKey])

  /* --- focus / selection ------------------------------------------------------ */
  const focusOn = useCallback(
    (id: string) => {
      if (!graph) return
      if (!drawn.has(id)) {
        if (msFocus && !msFocus.all.has(id)) setPathMilestone('')
        if (!graph.connected.has(id)) setShowUnconnected(true)
      }
      setFocusId(id)
      setSelectedId(id)
      setSelectedEdge(null)
      setCenterOn({ id, n: Date.now() })
    },
    [graph, drawn, msFocus],
  )

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
  }, [])

  const selectEdge = useCallback((key: string | null) => {
    setSelectedEdge(key)
    if (key) setSelectedId(null)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || fullTicketId || confirmEdge) return
      if (selectedEdge) setSelectedEdge(null)
      else if (selectedId) setSelectedId(null)
      else if (focusId) setFocusId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullTicketId, confirmEdge, selectedEdge, selectedId, focusId])

  /* --- toasts ------------------------------------------------------------------- */
  // Auto-dismiss, but never while the pointer is on the toast (someone reaching for Undo).
  const [toastHover, setToastHover] = useState(false)
  useEffect(() => {
    if (!toast || toastHover) return
    const t = setTimeout(() => setToast((cur) => (cur?.n === toast.n ? null : cur)), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast, toastHover])
  useEffect(() => {
    if (!toast) setToastHover(false)
  }, [toast])

  /* --- dependency writes ------------------------------------------------------- */
  const refOf = useCallback((id: string) => graph?.nodes.get(id)?.info.ref ?? 'ticket', [graph])

  /** Keep the browser copy in step with what the server saved. */
  const applyIds = useCallback((ticketId: string, ids: string[]) => {
    setTickets((prev) =>
      prev.map((t) => {
        if (t.id !== ticketId) return t
        const old = new Map((t.blockedBy ?? []).map((b) => [idOf(b) ?? '', b]))
        return { ...t, blockedBy: ids.map((id) => old.get(id) ?? id) }
      }),
    )
  }, [])

  const explain = useCallback(
    (err: unknown, blockedId: string, blockerId: string, verb: 'add' | 'restore') => {
      const server = err instanceof DependencyError ? `${err.message} (HTTP ${err.status})` : err instanceof Error ? err.message : String(err)
      const loop = graph ? cyclePath(graph, blockedId, blockerId) : null
      const A = refOf(blockerId)
      const B = refOf(blockedId)
      const head = `Could not ${verb === 'add' ? 'add' : 'restore'} "${B} is blocked by ${A}".`
      if (loop && loop.length > 1) {
        const chain = loop.map(refOf).join(' waits on ')
        return `${head} It would create a cycle: ${chain}, so ${B} waiting on ${A} would loop forever. Nothing was changed. Server said: ${server}`
      }
      return `${head} Nothing was changed. Server said: ${server}`
    },
    [graph, refOf],
  )

  const link = useCallback(
    async (blockerId: string, blockedId: string) => {
      if (busy || blockerId === blockedId) return
      setBusy(true)
      setError(null)
      try {
        const res = await addBlocker(blockedId, blockerId)
        applyIds(blockedId, res.ids)
        if (!res.changed) {
          setToast({ n: Date.now(), message: `${refOf(blockedId)} was already blocked by ${refOf(blockerId)}.` })
          return
        }
        setSelectedEdge(edgeKey(blockerId, blockedId))
        setToast({
          n: Date.now(),
          message: `Added: ${refOf(blockedId)} is blocked by ${refOf(blockerId)}.`,
          undo: async () => {
            const r = await removeBlocker(blockedId, blockerId)
            applyIds(blockedId, r.ids)
            setSelectedEdge(null)
          },
        })
      } catch (err) {
        setError(explain(err, blockedId, blockerId, 'add'))
      } finally {
        setBusy(false)
      }
    },
    [busy, applyIds, refOf, explain],
  )

  const unlink = useCallback(
    async (edge: NetEdge) => {
      setBusy(true)
      setError(null)
      try {
        const res = await removeBlocker(edge.to, edge.from)
        applyIds(edge.to, res.ids)
        setSelectedEdge(null)
        setToast({
          n: Date.now(),
          message: res.changed
            ? `Removed: ${refOf(edge.to)} no longer waits on ${refOf(edge.from)}.`
            : `${refOf(edge.to)} was no longer blocked by ${refOf(edge.from)}.`,
          undo: res.changed
            ? async () => {
                const r = await addBlocker(edge.to, edge.from)
                applyIds(edge.to, r.ids)
              }
            : undefined,
        })
      } catch (err) {
        const server = err instanceof DependencyError ? `${err.message} (HTTP ${err.status})` : String(err)
        setError(`Could not remove the dependency. Nothing was changed. Server said: ${server}`)
      } finally {
        setBusy(false)
      }
    },
    [applyIds, refOf],
  )

  const runUndo = useCallback(async () => {
    if (!toast?.undo) return
    const undo = toast.undo
    setToast(null)
    setBusy(true)
    try {
      await undo()
      setToast({ n: Date.now(), message: 'Undone.' })
    } catch (err) {
      const server = err instanceof DependencyError ? `${err.message} (HTTP ${err.status})` : String(err)
      setError(`Undo failed; the change is still in place. Server said: ${server}`)
    } finally {
      setBusy(false)
    }
  }, [toast])

  /* --- render ------------------------------------------------------------------ */
  const selected = selectedId && graph ? (graph.nodes.get(selectedId) ?? null) : null
  const selEdge = selectedEdge && graph ? (graph.edgeByKey.get(selectedEdge) ?? null) : null
  const fullTicket = fullTicketId ? (tickets.find((t) => t.id === fullTicketId) ?? null) : null
  const nothingConnected = graph && graph.connected.size === 0
  // Floating bars centre over the canvas area left of the side panel when it is open.
  const overlayLeft = selected ? 'left-1/2 sm:left-[calc((100%-400px)/2)]' : 'left-1/2'

  return (
    <div className={`${styles.root} flex h-full flex-col`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-background/50 px-4 py-4 backdrop-blur-sm sm:px-8 sm:py-5">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-4 sm:gap-6">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Network</h1>
          <div className="hidden h-6 w-px bg-border/50 sm:block" />
          <div className="max-w-full overflow-x-auto">
            <ViewSwitcher />
          </div>
        </div>
        <NetworkFilters projects={projects} people={people} milestones={milestones} filters={filters} />
      </div>

      {/* Controls + summary */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/50 px-4 py-2.5 sm:px-8">
        {focusId && graph?.nodes.get(focusId) ? (
          <span className="flex h-8 items-center gap-1.5 rounded-md border border-primary/60 bg-primary/10 pl-2 pr-1 text-xs text-foreground">
            <Crosshair className="h-3.5 w-3.5 text-primary" />
            Focus: <span className="font-mono">{graph.nodes.get(focusId)!.info.ref}</span>
            <span className="text-muted-foreground">({(focus?.size ?? 1) - 1} linked)</span>
            <button type="button" aria-label="Clear focus" onClick={() => setFocusId(null)} className="rounded p-0.5 hover:bg-secondary">
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : (
          <TicketPicker
            candidates={candidates}
            ariaLabel="Focus on a ticket"
            placeholder="Focus: search key or title"
            onPick={focusOn}
            className="w-56"
          />
        )}

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Route className="h-3.5 w-3.5" />
          Path to
          <select
            aria-label="Path to milestone"
            value={pathMilestone}
            onChange={(e) => {
              setPathMilestone(e.target.value)
              setFocusId(null)
              setSelectedEdge(null)
            }}
            className="h-8 max-w-[200px] rounded-md border border-border/60 bg-secondary/30 px-2 text-xs text-foreground outline-none focus:border-primary"
          >
            <option value="">Whole network</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.date ? ` (${formatDay(String(m.date).slice(0, 10), today ?? undefined)})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className={`flex items-center gap-1.5 text-xs ${msFocus ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>
          <input
            type="checkbox"
            checked={showUnconnected}
            disabled={!!msFocus}
            onChange={(e) => setShowUnconnected(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--primary)]"
          />
          Show unconnected tickets{graph ? ` (${graph.nodes.size - graph.connected.size})` : ''}
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Network summary">
          <Stat value={summary.ready} label="ready" tone="text-green-300" />
          <Stat value={summary.blocked} label="blocked" tone={summary.blocked ? 'text-red-300' : ''} />
          <Stat value={summary.connected} label="connected tickets" />
          <Stat value={summary.edges} label="edges" />
          <Stat value={summary.chain} label="longest open chain" tone={summary.chain ? 'text-amber-300' : ''} />
        </div>
      </div>

      {msFocus && milestone && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs sm:px-8">
          <span className="font-semibold text-amber-200">
            Path to {milestone.name}
            {milestoneDate ? `, ${formatDay(milestoneDate, today ?? undefined)}` : ', no date set'}
          </span>
          <span className="text-muted-foreground">
            {msFocus.targets.length} ticket{msFocus.targets.length === 1 ? '' : 's'} on the milestone, {msFocus.all.size - msFocus.targets.length} upstream
          </span>
          {criticalPath.length > 0 ? (
            <span className="text-amber-300">Longest open chain: {criticalPath.map(refOf).join(' → ')}</span>
          ) : (
            <span className="text-muted-foreground">No open chain into it yet. Add blockers to see the path.</span>
          )}
          {conflicts.nodes.size > 0 && (
            <span className="flex items-center gap-1 font-semibold text-orange-300">
              <CalendarClock className="h-3.5 w-3.5" />
              {conflicts.nodes.size} ticket{conflicts.nodes.size === 1 ? '' : 's'} with a date conflict
            </span>
          )}
        </div>
      )}

      {truncated && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200 sm:px-8">
          Showing the first {limit} of {totalInScope} tickets in scope. Dependencies to tickets beyond that are not drawn. Narrow the filters for a
          complete picture.
        </div>
      )}

      {/* Body */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {!graph || !layout || !today ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Laying out the network</div>
        ) : graph.nodes.size === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">No tickets in this scope. Change the filters above.</div>
        ) : (
          <>
            <NetworkCanvas
              graph={graph}
              layout={layout}
              today={today}
              projects={projectChips}
              selectedId={selectedId}
              selectedEdge={selectedEdge}
              focus={focus}
              pathSet={pathSet}
              pathEdges={pathEdges}
              conflicts={conflicts}
              onSelect={select}
              onSelectEdge={selectEdge}
              onLink={link}
              fitSignal={fitSignal}
              centerOn={centerOn}
              gridLabel={msFocus ? 'On this milestone, no dependencies recorded' : 'Unconnected tickets'}
              rightInset={selected ? 400 : 0}
            />
            {nothingConnected && !showUnconnected && !msFocus && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
                <div className="pointer-events-auto max-w-md rounded-xl border border-border bg-card/95 p-5 text-center text-sm shadow-2xl">
                  <Link2 className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                  <p className="font-medium text-foreground">No dependencies recorded in this scope yet.</p>
                  <p className="mt-1 text-muted-foreground">
                    Show the unconnected tickets, then drag one card&apos;s handle onto another, or select a card and use Add blocker.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowUnconnected(true)}
                    className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-[var(--primary-hover)]"
                  >
                    Show {graph.nodes.size} tickets
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Selected edge bar */}
        {selEdge && graph && (
          <div
            data-no-pan
            className={`absolute top-3 z-20 flex ${overlayLeft} max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-indigo-400/50 bg-card/95 px-3 py-2 text-xs shadow-xl backdrop-blur`}
          >
            <span className="text-foreground">
              <span className="font-mono">{refOf(selEdge.to)}</span> is blocked by <span className="font-mono">{refOf(selEdge.from)}</span>
              {selEdge.done && <span className="text-muted-foreground"> (blocker done)</span>}
            </span>
            {conflicts.edges.get(selEdge.key) && <span className="text-orange-300">Date conflict</span>}
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmEdge(selEdge)}
              className="flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-1 font-medium text-red-300 transition-colors hover:bg-red-500/25 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove dependency
            </button>
            <button type="button" aria-label="Deselect edge" onClick={() => setSelectedEdge(null)} className="rounded p-0.5 text-muted-foreground hover:bg-secondary">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            role="alert"
            data-no-pan
            className={`absolute top-16 z-50 flex w-[min(640px,calc(100%-1.5rem))] -translate-x-1/2 items-start ${overlayLeft} gap-2 rounded-lg border border-red-500/50 bg-red-950/95 px-4 py-3 text-sm text-red-100 shadow-2xl`}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <p className="flex-1">{error}</p>
            <button type="button" aria-label="Dismiss error" onClick={() => setError(null)} className="rounded p-0.5 hover:bg-red-500/20">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div
            role="status"
            data-no-pan
            onMouseEnter={() => setToastHover(true)}
            onMouseLeave={() => setToastHover(false)}
            className={`absolute bottom-4 z-50 flex ${overlayLeft} max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground shadow-2xl`}
          >
            <span>{toast.message}</span>
            {toast.undo && (
              <button
                type="button"
                disabled={busy}
                onClick={runUndo}
                className="rounded-md border border-border px-2 py-0.5 text-xs font-semibold text-primary hover:bg-secondary disabled:opacity-50"
              >
                Undo
              </button>
            )}
            <button type="button" aria-label="Dismiss" onClick={() => setToast(null)} className="rounded p-0.5 text-muted-foreground hover:bg-secondary">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {selected && graph && today && (
          <>
            <div className="fixed inset-0 z-30 bg-black/40 sm:hidden" onClick={() => setSelectedId(null)} />
            <NetworkDetailPanel
              key={selected.id}
              node={selected}
              graph={graph}
              today={today}
              candidates={candidates}
              pathIndex={criticalPath.indexOf(selected.id)}
              pathLength={criticalPath.length}
              conflicts={conflicts.nodes.get(selected.id) ?? null}
              busy={busy}
              onClose={() => setSelectedId(null)}
              onSelect={(id) => {
                setSelectedId(id)
                setCenterOn({ id, n: Date.now() })
              }}
              onFocus={focusOn}
              onOpenFull={() => setFullTicketId(selected.id)}
              onLink={link}
              onRemove={(edge) => setConfirmEdge(edge)}
            />
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!confirmEdge}
        onClose={() => setConfirmEdge(null)}
        onConfirm={() => {
          const e = confirmEdge
          setConfirmEdge(null)
          if (e) void unlink(e)
        }}
        title="Remove dependency?"
        message={confirmEdge ? `${refOf(confirmEdge.to)} will no longer be blocked by ${refOf(confirmEdge.from)}. You can undo this right after.` : ''}
        confirmText="Remove dependency"
        isDestructive
        isLoading={busy}
      />

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
            } catch (err) {
              console.error('Failed to delete ticket:', err)
            }
          }}
        />
      )}
    </div>
  )
}

function Stat({ value, label, tone = '' }: { value: number; label: string; tone?: string }) {
  return (
    <span className={`tabular-nums ${tone}`}>
      <span className="font-semibold">{value}</span> {label}
    </span>
  )
}
