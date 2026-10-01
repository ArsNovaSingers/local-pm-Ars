'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, ChevronDown, ChevronRight, Maximize, Minus, Plus } from 'lucide-react'
import { formatDay } from '@/components/tree/tree-model'
import styles from './network.module.css'
import { CARD, type Conflicts, type Graph, type NetLayout, type NetNode } from './network-model'

export interface ProjectChip {
  name: string
  prefix?: string
  color: string | null
}

interface NetworkCanvasProps {
  graph: Graph
  layout: NetLayout
  today: string
  projects: Map<string, ProjectChip>
  selectedId: string | null
  selectedEdge: string | null
  /** When set, everything outside it is dimmed. */
  focus: Set<string> | null
  pathSet: Set<string>
  pathEdges: Set<string>
  conflicts: Conflicts
  onSelect: (id: string | null) => void
  onSelectEdge: (key: string | null) => void
  /** Drag from blocker's handle onto the blocked ticket. */
  onLink: (blockerId: string, blockedId: string) => void
  fitSignal: number
  centerOn: { id: string; n: number } | null
  gridLabel: string
  /** Pixels on the right covered by the side panel; centring keeps clear of them. */
  rightInset: number
}

interface View {
  x: number
  y: number
  k: number
}

const MARKER_COLORS = {
  open: '#d4d4d8',
  done: '#71717a',
  path: '#f59e0b',
  conflict: '#fb923c',
  selected: '#818cf8',
  link: '#e4e4e7',
}

const MIN_K = 0.1
const MAX_K = 2.5
const PAD = 40

export function NetworkCanvas({
  graph,
  layout,
  today,
  projects,
  selectedId,
  selectedEdge,
  focus,
  pathSet,
  pathEdges,
  conflicts,
  onSelect,
  onSelectEdge,
  onLink,
  fitSignal,
  centerOn,
  gridLabel,
  rightInset,
}: NetworkCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const zoomLabelRef = useRef<HTMLSpanElement>(null)
  const linkPathRef = useRef<SVGPathElement>(null)
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
  const insetRef = useRef(rightInset)
  insetRef.current = rightInset

  const fit = useCallback(() => {
    const el = canvasRef.current
    if (!el) return
    const { width, height } = layoutRef.current
    const rect = el.getBoundingClientRect()
    if (!width || !height || !rect.width) return
    const fitW = (rect.width - PAD * 2) / width
    const fitH = (rect.height - PAD * 2) / height
    // Fit the whole thing when it can stay readable; otherwise fit the width and start
    // at the top rather than shrinking 400 cards to confetti.
    const k = Math.max(MIN_K, Math.min(1.1, fitW, Math.max(fitH, 0.45)))
    view.current = {
      k,
      x: Math.max(PAD, (rect.width - width * k) / 2),
      y: height * k > rect.height - PAD * 2 ? PAD + 24 : (rect.height - height * k) / 2,
    }
    apply()
  }, [apply])

  useEffect(() => {
    fit()
  }, [fit, fitSignal])

  useEffect(() => {
    if (!centerOn) return
    const el = canvasRef.current
    const p = layoutRef.current.pos.get(centerOn.id)
    if (!el || !p) return
    const rect = el.getBoundingClientRect()
    const v = view.current
    if (v.k < 0.6) v.k = 0.8
    const visibleW = rect.width > 900 ? rect.width - insetRef.current : rect.width
    v.x = visibleW / 2 - (p.x + CARD.w / 2) * v.k
    v.y = rect.height / 2 - (p.y + CARD.h / 2) * v.k
    apply()
  }, [centerOn, apply])

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

  /* --- pan: a press only becomes a pan after it moves, so card clicks still work -- */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || linking.current) return
    if ((e.target as Element).closest('[data-no-pan]')) return
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
    if ((e.target as Element).closest('[data-node-id],[data-no-pan]')) return
    onSelect(null)
    onSelectEdge(null)
  }

  /* --- measure real card sizes after they mount; edges are drawn from these ---- */
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

  /* --- drag-to-link: handle → card. DOM-only while dragging (no React renders) -- */
  const linking = useRef<{ from: string; pointerId: number; target: HTMLElement | null; source: HTMLElement | null } | null>(null)
  const onLinkRef = useRef(onLink)
  onLinkRef.current = onLink

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const v = view.current
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k }
  }, [])

  const startLink = useCallback(
    (e: React.PointerEvent, fromId: string) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      const p = layoutRef.current.pos.get(fromId)
      if (!p) return
      const source = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-node-id]')
      source?.classList.add(styles.linkSource)
      linking.current = { from: fromId, pointerId: e.pointerId, target: null, source }
      canvasRef.current?.setAttribute('data-linking', 'true')
      const sx = p.x + CARD.w
      const sy = p.y + CARD.h / 2

      const clearTarget = () => {
        const l = linking.current
        if (l?.target) l.target.classList.remove(styles.dropTarget)
        if (l) l.target = null
      }
      const move = (ev: PointerEvent) => {
        const l = linking.current
        if (!l || ev.pointerId !== l.pointerId) return
        const w = toWorld(ev.clientX, ev.clientY)
        const dx = Math.max(40, Math.abs(w.x - sx) / 2)
        linkPathRef.current?.setAttribute('d', `M${sx},${sy} C${sx + dx},${sy} ${w.x - dx},${w.y} ${w.x},${w.y}`)
        const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-node-id]') ?? null
        const valid = hit && hit.dataset.nodeId !== l.from ? hit : null
        if (valid !== l.target) {
          clearTarget()
          if (valid) {
            valid.classList.add(styles.dropTarget)
            l.target = valid
          }
        }
      }
      const finish = (ev: PointerEvent | null, commit: boolean) => {
        const l = linking.current
        if (!l || (ev && ev.pointerId !== l.pointerId)) return
        const target = l.target?.dataset.nodeId ?? null
        clearTarget()
        l.source?.classList.remove(styles.linkSource)
        linkPathRef.current?.setAttribute('d', '')
        canvasRef.current?.removeAttribute('data-linking')
        linking.current = null
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('keydown', key, true)
        suppressClick.current = true
        setTimeout(() => (suppressClick.current = false), 0)
        if (commit && target && target !== l.from) onLinkRef.current(l.from, target)
      }
      const up = (ev: PointerEvent) => finish(ev, true)
      const cancel = (ev: PointerEvent) => finish(ev, false)
      const key = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          ev.stopPropagation()
          finish(null, false)
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      window.addEventListener('keydown', key, true)
    },
    [toWorld],
  )

  /* --- edges --------------------------------------------------------------- */
  const edges = useMemo(() => {
    const out: {
      key: string
      d: string
      cls: string
      z: number
      title: string
      marker: keyof typeof MARKER_COLORS
    }[] = []
    for (const e of graph.edges) {
      const a = layout.pos.get(e.from)
      const b = layout.pos.get(e.to)
      if (!a || !b) continue
      const sa = sizes.get(e.from) ?? { w: CARD.w, h: CARD.h }
      const sb = sizes.get(e.to) ?? { w: CARD.w, h: CARD.h }
      const x1 = a.x + sa.w
      const y1 = a.y + sa.h / 2
      const x2 = b.x - 2
      const y2 = b.y + sb.h / 2
      const dx = Math.max(36, Math.abs(x2 - x1) / 2)
      const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
      const onPath = pathEdges.has(e.key)
      const conflict = conflicts.edges.get(e.key)
      const selected = selectedEdge === e.key
      const active = selectedId !== null && (e.from === selectedId || e.to === selectedId)
      const dim = focus !== null && !(focus.has(e.from) && focus.has(e.to))
      const cls = [
        styles.edge,
        e.done ? styles.edgeDone : styles.edgeOpen,
        conflict ? styles.edgeConflict : '',
        onPath ? styles.edgePath : '',
        selected || active ? styles.edgeSelected : '',
        dim && !selected ? styles.edgeDim : '',
      ].join(' ')
      const fromRef = graph.nodes.get(e.from)!.info.ref
      const toRef = graph.nodes.get(e.to)!.info.ref
      out.push({
        key: e.key,
        d,
        cls,
        z: selected ? 4 : active ? 3 : onPath ? 2 : conflict ? 1 : 0,
        marker: selected || active ? 'selected' : onPath ? 'path' : conflict ? 'conflict' : e.done ? 'done' : 'open',
        title: `${toRef} is blocked by ${fromRef}${e.done ? ' (done)' : ''}${conflict ? ` — date conflict: ${conflict}` : ''}. Click to select.`,
      })
    }
    return out.sort((p, q) => p.z - q.z)
  }, [graph, layout, sizes, pathEdges, conflicts, selectedEdge, selectedId, focus])

  const handleCardClick = useCallback(
    (id: string) => {
      if (suppressClick.current) return
      onSelectEdge(null)
      onSelect(id)
    },
    [onSelect, onSelectEdge],
  )

  const svgW = layout.width + 400
  const svgH = layout.height + 300
  const ids = useMemo(() => [...layout.pos.keys()], [layout])

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={canvasRef}
        className={`absolute inset-0 select-none overflow-hidden ${styles.canvas}`}
        data-panning={panning}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onCanvasClick}
        onScroll={(e) => {
          const el = e.currentTarget
          if (!el.scrollLeft && !el.scrollTop) return
          view.current.x -= el.scrollLeft
          view.current.y -= el.scrollTop
          el.scrollLeft = 0
          el.scrollTop = 0
          apply()
        }}
        aria-label="Dependency network canvas. Drag to pan, scroll to zoom. Drag a card's handle onto another card to add a dependency."
      >
        <div ref={worldRef} className={`absolute left-0 top-0 ${styles.world}`}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={svgW} height={svgH} aria-hidden="true">
            <defs>
              {Object.entries(MARKER_COLORS).map(([name, color]) => (
                <marker
                  key={name}
                  id={`net-arrow-${name}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  markerUnits="userSpaceOnUse"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,5 L0,10 z" fill={color} />
                </marker>
              ))}
            </defs>
            {layout.gridTop !== null && layout.graphHeight > 0 && (
              <line x1={0} x2={Math.max(layout.width, 600)} y1={layout.gridTop - 56} y2={layout.gridTop - 56} stroke="#27272a" strokeWidth={1} />
            )}
            {edges.map((e) => (
              <g key={e.key}>
                <path
                  d={e.d}
                  className={styles.edgeHit}
                  data-no-pan
                  data-edge-key={e.key}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onSelectEdge(e.key)
                  }}
                >
                  <title>{e.title}</title>
                </path>
                <path d={e.d} className={e.cls} markerEnd={`url(#net-arrow-${e.marker})`} />
              </g>
            ))}
            <path ref={linkPathRef} className={styles.linkLine} d="" markerEnd="url(#net-arrow-link)" />
          </svg>

          {layout.gridTop !== null && (
            <div className="absolute left-0 whitespace-nowrap text-sm font-semibold text-muted-foreground" style={{ top: layout.gridTop - 40 }}>
              {gridLabel} ({layout.gridCount})
              <span className="ml-2 font-normal text-muted-foreground/70">
                Drag a card&apos;s handle onto another card to record that it blocks it.
              </span>
            </div>
          )}

          <CardLayer
            ids={ids}
            graph={graph}
            layout={layout}
            today={today}
            projects={projects}
            selectedId={selectedId}
            focus={focus}
            pathSet={pathSet}
            conflicts={conflicts}
            onCardClick={handleCardClick}
            onHandleDown={startLink}
          />
        </div>
      </div>

      <div
        data-no-pan
        className="absolute right-3 top-3 flex items-center gap-1 rounded-lg border border-border/60 bg-card/90 p-1 shadow-lg backdrop-blur"
      >
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

      <Legend />
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

function Legend() {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    if (window.matchMedia('(max-width: 640px), (max-height: 760px)').matches) setOpen(false)
  }, [])
  return (
    <div data-no-pan className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-lg border border-border/60 bg-card/90 text-xs shadow-lg backdrop-blur">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 px-3 py-2 font-medium text-foreground" aria-expanded={open}>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Legend
      </button>
      {open && (
        <div className="space-y-1.5 px-3 pb-3 text-muted-foreground">
          <LegendLine label="Blocker → blocked ticket (open)">
            <line x1="2" y1="6" x2="30" y2="6" stroke="#d4d4d8" strokeWidth="1.6" />
            <path d="M28,2 L35,6 L28,10 z" fill="#d4d4d8" />
          </LegendLine>
          <LegendLine label="Blocker already done">
            <line x1="2" y1="6" x2="30" y2="6" stroke="#a1a1aa" strokeWidth="1.6" strokeDasharray="5 5" opacity="0.5" />
          </LegendLine>
          <LegendLine label="Critical path (longest open chain)">
            <line x1="2" y1="6" x2="30" y2="6" stroke="#f59e0b" strokeWidth="3" />
            <path d="M28,2 L35,6 L28,10 z" fill="#f59e0b" />
          </LegendLine>
          <LegendLine label="Date conflict">
            <line x1="2" y1="6" x2="30" y2="6" stroke="#fb923c" strokeWidth="2.2" strokeDasharray="2 4" />
          </LegendLine>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1">
            <Swatch color="#22c55e" label="Ready" />
            <Swatch color="#ef4444" label="Blocked" />
            <Swatch color="#14b8a6" label="In progress" />
            <Swatch color="#52525b" label="Done" />
          </div>
          <p className="pt-1 text-[11px] text-muted-foreground/80">Hover a card and drag its handle onto another card: the target becomes blocked by it.</p>
        </div>
      )}
    </div>
  )
}

function LegendLine({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <svg width="36" height="12" aria-hidden="true" className="shrink-0">
        {children}
      </svg>
      <span>{label}</span>
    </div>
  )
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </div>
  )
}

/* ------------------------------------------------------------------- cards -- */

interface CardLayerProps {
  ids: string[]
  graph: Graph
  layout: NetLayout
  today: string
  projects: Map<string, ProjectChip>
  selectedId: string | null
  focus: Set<string> | null
  pathSet: Set<string>
  conflicts: Conflicts
  onCardClick: (id: string) => void
  onHandleDown: (e: React.PointerEvent, id: string) => void
}

const CardLayer = memo(function CardLayer({
  ids,
  graph,
  layout,
  today,
  projects,
  selectedId,
  focus,
  pathSet,
  conflicts,
  onCardClick,
  onHandleDown,
}: CardLayerProps) {
  return (
    <>
      {ids.map((id) => {
        const node = graph.nodes.get(id)
        const p = layout.pos.get(id)
        if (!node || !p) return null
        return (
          <Card
            key={id}
            node={node}
            x={p.x}
            y={p.y}
            today={today}
            project={projects.get(node.info.projectId) ?? null}
            selected={selectedId === id}
            dimmed={focus !== null && !focus.has(id)}
            onPath={pathSet.has(id)}
            conflict={conflicts.nodes.get(id) ?? null}
            onClick={onCardClick}
            onHandleDown={onHandleDown}
          />
        )
      })}
    </>
  )
})

interface CardProps {
  node: NetNode
  x: number
  y: number
  today: string
  project: ProjectChip | null
  selected: boolean
  dimmed: boolean
  onPath: boolean
  conflict: string[] | null
  onClick: (id: string) => void
  onHandleDown: (e: React.PointerEvent, id: string) => void
}

const Card = memo(function Card({ node, x, y, today, project, selected, dimmed, onPath, conflict, onClick, onHandleDown }: CardProps) {
  const { info, state } = node
  const overdue = !info.done && !!info.due && info.due < today
  return (
    <div
      role="button"
      tabIndex={0}
      data-node-id={node.id}
      data-state={state}
      aria-pressed={selected}
      aria-label={`${info.ref} ${info.title}, ${state === 'blocked' ? `blocked by ${node.openBlockers}` : state}`}
      onClick={() => onClick(node.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(node.id)
        }
      }}
      className={[
        styles.card,
        styles[`state-${state}`],
        onPath ? styles.onPath : '',
        selected ? styles.selected : '',
        dimmed ? styles.dimmed : '',
        'cursor-pointer px-2.5 py-2',
      ].join(' ')}
      style={{ left: x, top: y, width: CARD.w, height: CARD.h }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: project?.color || '#52525b' }}
          title={project?.name ?? 'No project'}
        />
        <span className="font-mono text-[11px] font-medium text-muted-foreground">{info.ref}</span>
        <div className="ml-auto flex items-center gap-1">
          {conflict && (
            <span className="flex items-center gap-0.5 rounded bg-orange-500/15 px-1 py-px text-[10px] font-semibold text-orange-300" title={conflict.join('\n')}>
              <CalendarClock className="h-2.5 w-2.5" />
              Date conflict
            </span>
          )}
          {state === 'ready' && <span className={`rounded px-1 py-px text-[10px] font-semibold ${styles['chip-ready']}`}>Ready</span>}
          {state === 'blocked' && (
            <span className={`rounded px-1 py-px text-[10px] font-semibold ${styles['chip-blocked']}`}>Blocked by {node.openBlockers}</span>
          )}
          {state === 'prog' && <span className={`rounded px-1 py-px text-[10px] font-semibold ${styles['chip-prog']}`}>In progress</span>}
          {state === 'done' && <span className={`rounded px-1 py-px text-[10px] font-semibold ${styles['chip-done']}`}>Done</span>}
        </div>
      </div>
      <div className={`${styles.title} mt-1 line-clamp-2 text-[12.5px] font-medium leading-[1.3] text-foreground`} title={info.title}>
        {info.title}
      </div>
      <div className="absolute bottom-1.5 left-2.5 right-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {info.assignee ? (
          <span
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
            style={{ backgroundColor: info.assignee.color || '#52525b' }}
            title={info.assignee.name}
          >
            {info.assignee.initials}
          </span>
        ) : (
          <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-muted-foreground/50" title="No assignee" />
        )}
        {node.statusSaysBlocked && (
          <span className="truncate text-[10px] text-amber-300/90" title="Status is Blocked, but no open blocker is recorded. Add the blocker so the network knows.">
            Status: blocked, no blocker
          </span>
        )}
        <span className={`ml-auto shrink-0 tabular-nums ${conflict ? 'text-orange-300' : overdue ? 'text-red-300' : ''}`}>
          {info.due ? formatDay(info.due, today) : <span className="italic text-muted-foreground/60">No due date</span>}
        </span>
      </div>
      <span
        data-no-pan
        className={styles.handle}
        role="button"
        tabIndex={-1}
        aria-label={`Drag from ${info.ref} onto another ticket to make it blocked by ${info.ref}`}
        title={`Drag onto another card: it becomes blocked by ${info.ref}`}
        onPointerDown={(e) => onHandleDown(e, node.id)}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
})
