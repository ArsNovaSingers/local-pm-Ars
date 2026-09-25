'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Ban, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Maximize, Minus, Plus } from 'lucide-react'
import styles from './tree.module.css'
import { LAYOUT, formatDay, type Layout, type PlacedNode, type TicketInfo, type TreeModel } from './tree-model'

interface TreeCanvasProps {
  model: TreeModel
  layout: Layout
  today: string
  selectedId: string | null
  onSelect: (id: string | null) => void
  onToggle: (nodeId: string) => void
  onExpandAll: () => void
  onCollapseAll: () => void
  /** Bumped by the parent to request a fit-to-screen. */
  fitSignal: number
}

interface View {
  x: number
  y: number
  k: number
}

const MIN_K = 0.15
const MAX_K = 2.5
const PAD = 40

export function TreeCanvas({
  model,
  layout,
  today,
  selectedId,
  onSelect,
  onToggle,
  onExpandAll,
  onCollapseAll,
  fitSignal,
}: TreeCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const zoomLabelRef = useRef<HTMLSpanElement>(null)
  const view = useRef<View>({ x: PAD, y: PAD, k: 1 })
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const [panning, setPanning] = useState(false)

  /* --- transform: written straight to the DOM, never through React state ---- */
  const apply = useCallback(() => {
    const { x, y, k } = view.current
    if (worldRef.current) worldRef.current.style.transform = `translate(${x}px, ${y}px) scale(${k})`
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(k * 100)}%`
  }, [])

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      const el = canvasRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const px = cx ?? rect.width / 2
      const py = cy ?? rect.height / 2
      const v = view.current
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor))
      v.x = px - ((px - v.x) * k) / v.k
      v.y = py - ((py - v.y) * k) / v.k
      v.k = k
      apply()
    },
    [apply],
  )

  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const fit = useCallback(() => {
    const el = canvasRef.current
    if (!el) return
    const { width, height } = layoutRef.current
    const rect = el.getBoundingClientRect()
    if (!width || !height || !rect.width) return
    // Leave room for the arcs drawn to the right of the ticket column.
    const w = width + 120
    // Fit the width; for a very tall tree, stay readable and start at the top instead
    // of shrinking everything to an unreadable sliver.
    const fitW = (rect.width - PAD * 2) / w
    const fitH = (rect.height - PAD * 2) / height
    const k = Math.max(MIN_K, Math.min(1, fitW, Math.max(fitH, 0.6)))
    view.current = {
      k,
      x: Math.max(PAD, (rect.width - w * k) / 2),
      y: height * k > rect.height - PAD * 2 ? PAD + 48 : (rect.height - height * k) / 2,
    }
    apply()
  }, [apply])

  useEffect(() => {
    fit()
  }, [fit, fitSignal])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
        zoomAt(Math.exp(-delta * 0.0015), e.clientX - rect.left, e.clientY - rect.top)
      } else {
        view.current.x -= e.deltaX
        apply()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, apply])

  /* --- pan: a press only becomes a pan after it moves, so node clicks still work -- */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-no-pan]')) return
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: view.current.x, oy: view.current.y, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) {
      d.moved = true
      setPanning(true)
      canvasRef.current?.setPointerCapture(e.pointerId)
    }
    view.current.x = d.ox + dx
    view.current.y = d.oy + dy
    apply()
  }
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (d.moved) {
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 0)
      setPanning(false)
    }
    drag.current = null
  }

  const onCanvasClick = (e: React.MouseEvent) => {
    if (suppressClick.current) return
    if ((e.target as HTMLElement).closest('[data-node-id],[data-no-pan]')) return
    onSelect(null)
  }

  /* --- measure real node sizes after they mount; edges are drawn from these ---- */
  const [sizes, setSizes] = useState<Map<string, { w: number; h: number }>>(new Map())
  useLayoutEffect(() => {
    const world = worldRef.current
    if (!world) return
    const next = new Map<string, { w: number; h: number }>()
    world.querySelectorAll<HTMLElement>('[data-node-id]').forEach((el) => {
      next.set(el.dataset.nodeId!, { w: el.offsetWidth, h: el.offsetHeight })
    })
    setSizes(next)
  }, [layout])

  const pathSet = useMemo(() => new Set(model.criticalPath), [model.criticalPath])
  const pathEdges = useMemo(() => {
    const set = new Set<string>()
    for (let i = 1; i < model.criticalPath.length; i++) set.add(`${model.criticalPath[i - 1]}>${model.criticalPath[i]}`)
    return set
  }, [model.criticalPath])

  const edges = useMemo(
    () => buildEdges(model, layout, sizes, pathEdges, selectedId),
    [model, layout, sizes, pathEdges, selectedId],
  )

  const handleNodeClick = useCallback(
    (p: PlacedNode) => {
      if (suppressClick.current) return
      if (p.node.kind === 'ticket') onSelect(p.node.id)
      else onToggle(p.node.id)
    },
    [onSelect, onToggle],
  )

  const svgW = layout.width + 400
  const svgH = layout.height + 200

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <div
        ref={canvasRef}
        className={`absolute inset-0 overflow-hidden select-none ${styles.canvas}`}
        data-panning={panning}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onCanvasClick}
        onScroll={(e) => {
          // Keyboard focus can scroll an overflow-hidden box to reveal a node; turn that
          // into a pan so the transform stays the single source of truth.
          const el = e.currentTarget
          if (!el.scrollLeft && !el.scrollTop) return
          view.current.x -= el.scrollLeft
          view.current.y -= el.scrollTop
          el.scrollLeft = 0
          el.scrollTop = 0
          apply()
        }}
        aria-label="Dependency tree canvas. Drag to pan, scroll to zoom."
      >
        <div ref={worldRef} className={`absolute left-0 top-0 ${styles.world}`}>
          <svg
            className="absolute left-0 top-0 pointer-events-none overflow-visible"
            width={svgW}
            height={svgH}
            aria-hidden="true"
          >
            <defs>
              <marker id="tree-arrow-dep" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#a1a1aa" />
              </marker>
              <marker id="tree-arrow-path" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#f87171" />
              </marker>
              <marker id="tree-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#e4e4e7" />
              </marker>
            </defs>
            {edges.tree.map((d, i) => (
              <path key={`t${i}`} d={d} className={styles.edgeTree} />
            ))}
            {edges.deps.map((e) => (
              <path
                key={e.key}
                d={e.d}
                className={[
                  styles.edgeDep,
                  e.done ? styles.edgeDepDone : '',
                  e.path ? styles.edgePath : '',
                  e.active ? styles.edgeActive : '',
                ].join(' ')}
                markerEnd={`url(#tree-arrow-${e.active ? 'active' : e.path ? 'path' : 'dep'})`}
              />
            ))}
          </svg>
          <NodeLayer
            placed={layout.placed}
            model={model}
            today={today}
            selectedId={selectedId}
            pathSet={pathSet}
            onNodeClick={handleNodeClick}
            onToggle={onToggle}
          />
        </div>
      </div>

      {/* Toolbar */}
      <div
        data-no-pan
        className="absolute right-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-1 rounded-lg border border-border/60 bg-card/90 p-1 shadow-lg backdrop-blur"
      >
        <ToolButton label="Expand all" onClick={onExpandAll}>
          <ChevronsUpDown className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Expand all</span>
        </ToolButton>
        <ToolButton label="Collapse all" onClick={onCollapseAll}>
          <ChevronsDownUp className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Collapse all</span>
        </ToolButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolButton label="Zoom out" onClick={() => zoomAt(1 / 1.2)}>
          <Minus className="h-3.5 w-3.5" />
        </ToolButton>
        <span ref={zoomLabelRef} className="w-11 text-center text-xs tabular-nums text-muted-foreground">
          100%
        </span>
        <ToolButton label="Zoom in" onClick={() => zoomAt(1.2)}>
          <Plus className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Fit to screen" onClick={fit}>
          <Maximize className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Fit</span>
        </ToolButton>
      </div>

      <Legend hasPath={model.criticalPath.length > 0} edges={model.summary.edges} />
    </div>
  )
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ legend -- */

function Legend({ hasPath, edges }: { hasPath: boolean; edges: number }) {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    if (window.matchMedia('(max-width: 640px), (max-height: 760px)').matches) setOpen(false)
  }, [])
  return (
    <div
      data-no-pan
      className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-lg border border-border/60 bg-card/90 text-xs shadow-lg backdrop-blur"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-2 font-medium text-foreground"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Legend
      </button>
      {open && (
        <div className="space-y-2.5 px-3 pb-3">
          <div className="space-y-1.5">
            <LegendLine label="Hierarchy: project, group, ticket">
              <line x1="2" y1="6" x2="34" y2="6" stroke="#52525b" strokeWidth="1.5" />
              </LegendLine>
            <LegendLine label="Blocked by: blocker, then blocked ticket">
              <line x1="2" y1="6" x2="30" y2="6" stroke="#a1a1aa" strokeWidth="1.5" strokeDasharray="5 4" />
              <path d="M28,2 L35,6 L28,10 z" fill="#a1a1aa" />
              </LegendLine>
            {hasPath && (
              <LegendLine label="Critical path (longest open chain)">
                <line x1="2" y1="6" x2="30" y2="6" stroke="#f87171" strokeWidth="2.5" strokeDasharray="5 4" />
                <path d="M28,2 L35,6 L28,10 z" fill="#f87171" />
              </LegendLine>
            )}
            {edges === 0 && (
              <p className="text-muted-foreground">No blocked-by links recorded in this scope.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <Swatch cls={styles['dot-crit']} label="Urgent or overdue" />
            <Swatch cls={styles['dot-soon']} label="Due within 3 days" />
            <Swatch cls={styles['dot-prog']} label="In progress" />
            <Swatch cls={styles['dot-todo']} label="To do" />
            <Swatch cls={styles['dot-done']} label="Done" />
          </div>
        </div>
      )}
    </div>
  )
}

function LegendLine({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <svg width="36" height="12" aria-hidden="true" className="shrink-0">
        {children}
      </svg>
      <span>{label}</span>
    </div>
  )
}

function Swatch({ cls, label }: { cls: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} />
      {label}
    </div>
  )
}

/* ------------------------------------------------------------------- nodes -- */

interface NodeLayerProps {
  placed: PlacedNode[]
  model: TreeModel
  today: string
  selectedId: string | null
  pathSet: Set<string>
  onNodeClick: (p: PlacedNode) => void
  onToggle: (id: string) => void
}

const NodeLayer = memo(function NodeLayer({ placed, model, today, selectedId, pathSet, onNodeClick, onToggle }: NodeLayerProps) {
  return (
    <>
      {placed.map((p) =>
        p.node.kind === 'ticket' ? (
          <TicketNode
            key={p.node.id}
            p={p}
            info={model.tickets.get(p.node.id)!}
            today={today}
            selected={selectedId === p.node.id}
            onPath={pathSet.has(p.node.id)}
            onClick={onNodeClick}
          />
        ) : (
          <GroupNode key={p.node.id} p={p} onClick={onNodeClick} onToggle={onToggle} />
        ),
      )}
    </>
  )
})

function TicketNode({
  p,
  info,
  today,
  selected,
  onPath,
  onClick,
}: {
  p: PlacedNode
  info: TicketInfo
  today: string
  selected: boolean
  onPath: boolean
  onClick: (p: PlacedNode) => void
}) {
  const w = info.warnings
  return (
    <div
      role="button"
      tabIndex={0}
      data-node-id={p.node.id}
      aria-pressed={selected}
      aria-label={`${info.ref} ${info.title}`}
      onClick={() => onClick(p)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(p)
        }
      }}
      className={[
        styles.node,
        styles[`state-${info.state}`],
        onPath ? styles.onPath : '',
        selected ? styles.selected : '',
        'cursor-pointer px-3 py-2',
      ].join(' ')}
      style={{ left: p.x, top: p.y, width: LAYOUT.width.ticket, height: LAYOUT.height.ticket }}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles[`dot-${info.state}`]}`} />
        <span className="font-mono text-[11px] font-medium text-muted-foreground">{info.ref}</span>
        <div className="ml-auto flex items-center gap-1">
          {w.overdue && (
            <span className="flex items-center gap-0.5 rounded bg-red-500/15 px-1 py-px text-[10px] font-semibold text-red-300">
              <AlertTriangle className="h-2.5 w-2.5" />
              Overdue
            </span>
          )}
          {w.blocked && (
            <span className="flex items-center gap-0.5 rounded bg-orange-500/15 px-1 py-px text-[10px] font-semibold text-orange-300">
              <Ban className="h-2.5 w-2.5" />
              Blocked
            </span>
          )}
        </div>
      </div>
      <div className={`${styles.title} mt-0.5 truncate text-[13px] font-medium leading-snug text-foreground`} title={info.title}>
        {info.title}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {info.assignee ? (
          <>
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
              style={{ backgroundColor: info.assignee.color || '#52525b' }}
            >
              {info.assignee.initials}
            </span>
            <span className="truncate">{info.assignee.name}</span>
          </>
        ) : (
          <span className={`flex items-center gap-1 ${w.unassigned ? 'text-muted-foreground/70' : ''}`} title="No assignee">
            <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-muted-foreground/50" />
            {w.unassigned ? 'No assignee' : 'Unassigned'}
          </span>
        )}
        <span className="ml-auto shrink-0 tabular-nums">
          {info.due ? (
            <span className={w.overdue ? 'text-red-300' : info.state === 'soon' ? 'text-amber-300' : ''}>
              {formatDay(info.due, today)}
            </span>
          ) : w.noDue ? (
            <span className="italic text-muted-foreground/60">No due date</span>
          ) : null}
        </span>
      </div>
    </div>
  )
}

function GroupNode({ p, onClick, onToggle }: { p: PlacedNode; onClick: (p: PlacedNode) => void; onToggle: (id: string) => void }) {
  const n = p.node
  const isProject = n.kind === 'project'
  return (
    <div
      role="button"
      tabIndex={0}
      data-node-id={n.id}
      aria-expanded={!p.collapsed}
      onClick={() => onClick(p)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle(n.id)
        }
      }}
      className={`${styles.node} cursor-pointer ${isProject ? 'bg-card px-3 py-2.5' : 'px-2.5 py-2'}`}
      style={{
        left: p.x,
        top: p.y,
        width: LAYOUT.width[n.kind],
        height: LAYOUT.height[n.kind],
        borderColor: isProject ? '#3f3f46' : undefined,
        borderLeft: n.color ? `3px solid ${n.color}` : undefined,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">
          {p.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          {n.sublabel && (
            <div className={`text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${isProject ? 'font-mono' : ''}`}>
              {n.sublabel}
            </div>
          )}
          <div className={`truncate font-semibold text-foreground ${isProject ? 'text-sm' : 'text-[13px]'}`} title={n.label}>
            {n.label}
          </div>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1.5 whitespace-nowrap pl-5 text-[11px] text-muted-foreground">
        <span className="tabular-nums" title={`${n.openCount} open of ${n.ticketCount} tickets`}>
          {n.openCount}/{n.ticketCount} open
        </span>
        {n.alertCount > 0 && (
          <span className="rounded bg-red-500/15 px-1 font-semibold tabular-nums text-red-300" title="Overdue or blocked">
            {n.alertCount} alert{n.alertCount === 1 ? '' : 's'}
          </span>
        )}
        {p.collapsed && (
          <span className="ml-auto rounded-full bg-secondary px-1.5 font-medium tabular-nums text-foreground" title={`${p.hidden} tickets hidden`}>
            +{p.hidden} hidden
          </span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- edges -- */

interface DepEdge {
  key: string
  d: string
  done: boolean
  path: boolean
  active: boolean
}

function buildEdges(
  model: TreeModel,
  layout: Layout,
  sizes: Map<string, { w: number; h: number }>,
  pathEdges: Set<string>,
  selectedId: string | null,
): { tree: string[]; deps: DepEdge[] } {
  const widthOf = (p: PlacedNode) => sizes.get(p.node.id)?.w ?? LAYOUT.width[p.node.kind]

  const tree: string[] = []
  for (const p of layout.placed) {
    for (const child of p.collapsed ? [] : p.node.children) {
      const c = layout.byId.get(child.id)
      if (!c) continue
      const x1 = p.x + widthOf(p)
      const x2 = c.x
      const mid = (x1 + x2) / 2
      tree.push(`M${x1},${p.y} C${mid},${p.y} ${mid},${c.y} ${x2},${c.y}`)
    }
  }

  const deps: DepEdge[] = []
  const seen = new Set<string>()
  for (const info of model.tickets.values()) {
    for (const b of info.blockers) {
      if (!model.tickets.has(b.id)) continue
      const fromId = layout.visibleFor.get(b.id)
      const toId = layout.visibleFor.get(info.id)
      if (!fromId || !toId || fromId === toId) continue
      const key = `${fromId}>${toId}`
      const isPath = pathEdges.has(`${b.id}>${info.id}`) && fromId === b.id && toId === info.id
      if (seen.has(key)) {
        if (isPath) {
          const existing = deps.find((d) => d.key === key)
          if (existing) existing.path = true
        }
        continue
      }
      seen.add(key)
      const from = layout.byId.get(fromId)!
      const to = layout.byId.get(toId)!
      const fx = from.x + widthOf(from)
      const fy = from.y
      let d: string
      if (to.x > fx + 8) {
        const tx = to.x
        const mid = (fx + tx) / 2
        d = `M${fx},${fy} C${mid},${fy} ${mid},${to.y} ${tx},${to.y}`
      } else {
        // Same column (the common case): bow out to the right and come back in.
        const tx = to.x + widthOf(to)
        const off = 36 + Math.min(180, Math.abs(to.y - fy) * 0.22)
        const cx = Math.max(fx, tx) + off
        d = `M${fx},${fy} C${cx},${fy} ${cx},${to.y} ${tx + 2},${to.y}`
      }
      deps.push({
        key,
        d,
        done: b.done,
        path: isPath,
        active: !!selectedId && (b.id === selectedId || info.id === selectedId),
      })
    }
  }
  // Critical and active edges paint on top.
  deps.sort((a, b) => Number(a.path || a.active) - Number(b.path || b.active))
  return { tree, deps }
}
