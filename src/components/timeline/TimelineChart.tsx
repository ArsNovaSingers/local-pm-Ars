'use client'

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronDown, ChevronRight, Inbox } from 'lucide-react'
import type { TicketInfo } from '@/components/tree/tree-model'
import styles from './timeline.module.css'
import {
  MONTHS,
  POINT_W,
  ROW_H,
  dayParts,
  shortDay,
  stackLane,
  type DateConflict,
  type Lane,
  type Placement,
  type TimelineItem,
} from './timeline-model'

export type ZoomPreset = '2w' | 'month' | 'quarter' | 'season' | 'fit'

export interface ChartMilestone {
  id: string
  name: string
  day: number
  color: string
}

export interface TimelineChartHandle {
  zoom: (preset: ZoomPreset) => void
  scrollToToday: () => void
}

interface TimelineChartProps {
  lanes: Lane[]
  items: Map<string, TimelineItem>
  conflicts: DateConflict[]
  milestones: ChartMilestone[]
  today: number
  domain: { start: number; end: number }
  season: { start: number; end: number }
  fit: { start: number; end: number }
  collapsed: ReadonlySet<string>
  openTrays: ReadonlySet<string>
  selectedId: string | null
  showDeps: boolean
  onToggleLane: (id: string) => void
  onToggleTray: (id: string) => void
  onSelect: (id: string) => void
  /** Shift an existing item by whole days (bars move start and due together). */
  onMove: (id: string, deltaDays: number) => void
  /** Give an undated ticket a due date. */
  onSchedule: (id: string, day: number) => void
  onPresetChange: (preset: ZoomPreset | null) => void
}

const HEADER_H = 64
const LANE_HEAD_H = 34
const TRAY_H = 40
const ROW_TOP_PAD = 6
const DRAG_THRESHOLD = 4

const PRESET_DAYS: Record<'2w' | 'month' | 'quarter', number> = { '2w': 14, month: 31, quarter: 92 }

interface DragState {
  mode: 'move' | 'schedule'
  id: string
  /** For 'move': whole-day offset from the original position. */
  delta: number
  /** For 'schedule': target day under the pointer (null when off-chart), ghost position. */
  day: number | null
  x: number
  y: number
  label: string
}

export const TimelineChart = forwardRef<TimelineChartHandle, TimelineChartProps>(function TimelineChart(props, ref) {
  const {
    lanes,
    items,
    conflicts,
    milestones,
    today,
    domain,
    season,
    fit,
    collapsed,
    openTrays,
    selectedId,
    showDeps,
    onToggleLane,
    onToggleTray,
    onSelect,
    onMove,
    onSchedule,
    onPresetChange,
  } = props

  const scrollerRef = useRef<HTMLDivElement>(null)
  const [viewportW, setViewportW] = useState(0)
  // Lane labels shrink on narrow screens so the chart keeps most of the width.
  const labelW = viewportW && viewportW < 640 ? Math.round(Math.min(128, Math.max(84, viewportW * 0.38))) : 220
  const [ppd, setPpd] = useState<number | null>(null)
  /** Where the next layout pass should put the scroll position. */
  const pendingScroll = useRef<{ day: number; frac: number } | null>(null)
  const [scrollSeq, setScrollSeq] = useState(0)

  const trackViewport = Math.max(200, viewportW - labelW)
  const days = domain.end - domain.start + 1

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth))
    ro.observe(el)
    setViewportW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const centerDay = useCallback(() => {
    const el = scrollerRef.current
    if (!el || !ppd) return today
    return domain.start + (el.scrollLeft + trackViewport / 2) / ppd
  }, [ppd, domain.start, trackViewport, today])

  const zoom = useCallback(
    (preset: ZoomPreset) => {
      if (!viewportW) return
      if (preset === 'season' || preset === 'fit') {
        const range = preset === 'season' ? season : fit
        const span = range.end - range.start + 1
        setPpd(trackViewport / span)
        pendingScroll.current = { day: range.start, frac: 0 }
      } else {
        const center = centerDay()
        const todayVisible = Math.abs(center - today) < (ppd ? trackViewport / ppd / 2 : 0)
        setPpd(trackViewport / PRESET_DAYS[preset])
        pendingScroll.current = todayVisible ? { day: today, frac: 0.3 } : { day: center, frac: 0.5 }
      }
      onPresetChange(preset)
    },
    [viewportW, season, fit, trackViewport, centerDay, today, ppd, onPresetChange],
  )

  const scrollToToday = useCallback(() => {
    pendingScroll.current = { day: today, frac: 0.3 }
    // Re-run the scroll layout effect without touching the scale (no re-layout).
    setScrollSeq((n) => n + 1)
  }, [today])

  useImperativeHandle(ref, () => ({ zoom, scrollToToday }), [zoom, scrollToToday])

  // First measurement: open on the quarter view with today near the left.
  useEffect(() => {
    if (ppd === null && viewportW > 0) {
      setPpd(trackViewport / PRESET_DAYS.quarter)
      pendingScroll.current = { day: today - 7, frac: 0 }
      onPresetChange('quarter')
    }
  }, [ppd, viewportW, trackViewport, today, onPresetChange])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    const target = pendingScroll.current
    if (!el || !ppd || !target) return
    pendingScroll.current = null
    el.scrollLeft = Math.max(0, (target.day - domain.start) * ppd - target.frac * trackViewport)
  }, [ppd, domain.start, trackViewport, scrollSeq])

  // If the domain grows to the left (a ticket was dragged far back), keep the view still.
  const prevDomainStart = useRef(domain.start)
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (el && ppd && prevDomainStart.current !== domain.start) {
      el.scrollLeft += (prevDomainStart.current - domain.start) * ppd
    }
    prevDomainStart.current = domain.start
  }, [domain.start, ppd])

  const scale = ppd ?? 1
  const trackW = Math.max(days * scale, trackViewport)

  /* --- row stacking: memoised on lanes + scale only ------------------------- */
  const stacked = useMemo(() => {
    const out = new Map<string, { placements: Map<string, Placement>; rows: number }>()
    if (!ppd) return out
    for (const lane of lanes) out.set(lane.id, stackLane(lane.items, ppd, domain.start))
    return out
  }, [lanes, ppd, domain.start])

  /* --- vertical geometry (depends on collapse state, never on scroll) ------- */
  const geometry = useMemo(() => {
    let y = 0
    const laneTop = new Map<string, number>()
    const laneHeight = new Map<string, number>()
    for (const lane of lanes) {
      laneTop.set(lane.id, y)
      const rows = stacked.get(lane.id)?.rows ?? 1
      const h = collapsed.has(lane.id) ? LANE_HEAD_H : Math.max(LANE_HEAD_H + 8, ROW_TOP_PAD * 2 + rows * ROW_H)
      laneHeight.set(lane.id, h)
      y += h + 1 // 1px border
      if (openTrays.has(lane.id) && lane.unscheduled.length) y += TRAY_H + 1
    }
    return { laneTop, laneHeight, height: y }
  }, [lanes, stacked, collapsed, openTrays])

  /* --- drag ------------------------------------------------------------------ */
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag

  const dayAt = useCallback(
    (clientX: number, clientY: number): number | null => {
      const el = scrollerRef.current
      if (!el || !ppd) return null
      const r = el.getBoundingClientRect()
      if (clientX < r.left + labelW || clientX > r.right || clientY < r.top + HEADER_H || clientY > r.bottom) return null
      const day = domain.start + Math.floor((clientX - r.left - labelW + el.scrollLeft) / ppd)
      return Math.min(domain.end, Math.max(domain.start, day))
    },
    [ppd, labelW, domain.start, domain.end],
  )

  const autoScroll = (clientX: number) => {
    const el = scrollerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (clientX > r.right - 40) el.scrollLeft += 14
    else if (clientX < r.left + labelW + 30 && clientX > r.left + labelW - 10) el.scrollLeft -= 14
  }

  const beginPointer = useCallback(
    (e: React.PointerEvent, id: string, mode: 'move' | 'schedule', label: string) => {
      if (e.button !== 0 || !ppd) return
      const el = scrollerRef.current
      if (!el) return
      const startX = e.clientX
      const startY = e.clientY
      const startScroll = el.scrollLeft
      let started = false
      e.preventDefault()

      const onMoveEv = (ev: PointerEvent) => {
        if (!started) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return
          started = true
        }
        autoScroll(ev.clientX)
        if (mode === 'move') {
          const delta = Math.round((ev.clientX - startX + (el.scrollLeft - startScroll)) / ppd)
          setDrag({ mode, id, delta, day: null, x: ev.clientX, y: ev.clientY, label })
        } else {
          setDrag({ mode, id, delta: 0, day: dayAt(ev.clientX, ev.clientY), x: ev.clientX, y: ev.clientY, label })
        }
      }
      const finish = (ev: PointerEvent, cancelled: boolean) => {
        window.removeEventListener('pointermove', onMoveEv)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('keydown', onKey)
        const state = dragRef.current
        setDrag(null)
        if (!started) {
          if (!cancelled) onSelect(id)
          return
        }
        if (cancelled || !state) return
        if (mode === 'move') {
          const delta = Math.round((ev.clientX - startX + (el.scrollLeft - startScroll)) / ppd)
          if (delta !== 0) onMove(id, delta)
        } else {
          const day = dayAt(ev.clientX, ev.clientY)
          if (day !== null) onSchedule(id, day)
        }
      }
      const onUp = (ev: PointerEvent) => finish(ev, false)
      const onCancel = (ev: PointerEvent) => finish(ev, true)
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') finish(new PointerEvent('pointercancel'), true)
      }
      window.addEventListener('pointermove', onMoveEv)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey)
    },
    [ppd, dayAt, onMove, onSchedule, onSelect],
  )

  const onItemPointerDown = useCallback(
    (e: React.PointerEvent, item: TimelineItem) => beginPointer(e, item.id, 'move', item.info.ref),
    [beginPointer],
  )
  const onTrayPointerDown = useCallback(
    (e: React.PointerEvent, info: TicketInfo) => beginPointer(e, info.id, 'schedule', `${info.ref} ${info.title}`),
    [beginPointer],
  )
  const onItemKey = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(id)
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const step = e.shiftKey ? 7 : 1
        onMove(id, e.key === 'ArrowLeft' ? -step : step)
      }
    },
    [onSelect, onMove],
  )

  // Bring a selection made elsewhere (detail panel links) into view.
  useEffect(() => {
    const el = scrollerRef.current
    const item = selectedId ? items.get(selectedId) : null
    if (!el || !ppd || !item) return
    const x0 = (item.start - domain.start) * ppd
    const x1 = (item.end + 1 - domain.start) * ppd
    if (x1 < el.scrollLeft || x0 > el.scrollLeft + trackViewport) {
      el.scrollTo({ left: Math.max(0, x0 - trackViewport * 0.3), behavior: 'smooth' })
    }
    // Only on selection change: re-running on every zoom/scroll would fight the user.
  }, [selectedId])

  /* --- axis ------------------------------------------------------------------ */
  const axis = useMemo(() => {
    if (!ppd) return { months: [], ticks: [] as { x: number; text: string; strong: boolean }[], weekOffset: 0 }
    const months: { x: number; w: number; text: string }[] = []
    let n = domain.start
    while (n <= domain.end) {
      const { y, m, d } = dayParts(n)
      const monthStart = n - (d - 1)
      const nextMonth = Math.round(Date.UTC(y, m + 1, 1) / 86_400_000)
      const x = Math.max(0, (monthStart - domain.start) * ppd)
      const w = (Math.min(nextMonth, domain.end + 1) - domain.start) * ppd - x
      months.push({ x, w, text: m === 0 || months.length === 0 ? `${MONTHS[m]} ${y}` : MONTHS[m] })
      n = nextMonth
    }
    const ticks: { x: number; text: string; strong: boolean }[] = []
    if (ppd >= 16) {
      for (let k = domain.start; k <= domain.end; k++) {
        const { d, dow } = dayParts(k)
        ticks.push({ x: (k - domain.start) * ppd, text: String(d), strong: dow === 1 })
      }
    } else if (ppd >= 2.5) {
      for (let k = domain.start; k <= domain.end; k++) {
        const { d, dow } = dayParts(k)
        if (dow === 1) ticks.push({ x: (k - domain.start) * ppd, text: ppd >= 5 ? String(d) : '', strong: true })
      }
    }
    // First Monday in the domain, for the week grid background.
    let first = domain.start
    while (dayParts(first).dow !== 1) first++
    return { months, ticks, weekOffset: (first - domain.start) * ppd }
  }, [ppd, domain.start, domain.end])

  const gridStyle = useMemo<React.CSSProperties>(
    () =>
      ppd
        ? {
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px)',
            backgroundSize: `${7 * ppd}px 100%`,
            backgroundPosition: `${axis.weekOffset}px 0`,
          }
        : {},
    [ppd, axis.weekOffset],
  )

  /* --- milestone flags: each label may use the room up to the next one ------- */
  const flags = useMemo(() => {
    const sorted = [...milestones].sort((a, b) => a.day - b.day)
    return sorted.map((m, i) => {
      const x = (m.day - domain.start + 0.5) * scale
      const nextX = i + 1 < sorted.length ? (sorted[i + 1].day - domain.start + 0.5) * scale : Infinity
      return { ...m, x, room: Math.min(220, nextX - x - 6) }
    })
  }, [milestones, domain.start, scale])

  /* --- dependency arrows ----------------------------------------------------- */
  const arrows = useMemo(() => {
    if (!showDeps || !ppd) return []
    const conflictKey = new Set(conflicts.map((c) => `${c.blockerId}>${c.blockedId}`))
    const laneOf = new Map<string, Lane>()
    for (const lane of lanes) for (const it of lane.items) laneOf.set(it.id, lane)
    const yOf = (id: string): number | null => {
      const lane = laneOf.get(id)
      if (!lane || collapsed.has(lane.id)) return null
      const p = stacked.get(lane.id)?.placements.get(id)
      if (!p) return null
      return geometry.laneTop.get(lane.id)! + ROW_TOP_PAD + p.row * ROW_H + ROW_H / 2 - 1
    }
    const out: { key: string; d: string; conflict: boolean; done: boolean }[] = []
    for (const item of items.values()) {
      for (const b of item.info.blockers) {
        const blocker = items.get(b.id)
        if (!blocker) continue
        const y1 = yOf(blocker.id)
        const y2 = yOf(item.id)
        if (y1 === null || y2 === null) continue
        const x1 =
          blocker.kind === 'bar' ? (blocker.end + 1 - domain.start) * ppd : (blocker.end - domain.start + 0.5) * ppd + POINT_W / 2
        const x2 = item.kind === 'bar' ? (item.start - domain.start) * ppd : (item.start - domain.start + 0.5) * ppd - POINT_W / 2
        const bend = Math.max(24, Math.abs(x2 - x1) / 2)
        out.push({
          key: `${blocker.id}>${item.id}`,
          d: `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`,
          conflict: conflictKey.has(`${blocker.id}>${item.id}`),
          done: blocker.info.done,
        })
      }
    }
    return out
  }, [showDeps, ppd, conflicts, lanes, items, collapsed, stacked, geometry, domain.start])

  const todayX = (today - domain.start + 0.5) * scale
  const dropX = drag?.mode === 'schedule' && drag.day !== null ? (drag.day - domain.start) * scale : null

  return (
    <div
      ref={scrollerRef}
      className={`${styles.scroller} relative min-h-0 flex-1 overflow-auto`}
      data-dragging={drag ? 'true' : undefined}
    >
      {ppd && (
        <div className="relative" style={{ width: labelW + trackW, minHeight: '100%' }}>
          {/* ---------- sticky axis ---------- */}
          <div className="sticky top-0 z-30 flex border-b border-border/70 bg-card/95 backdrop-blur" style={{ height: HEADER_H }}>
            <div
              className="sticky left-0 z-40 flex shrink-0 flex-col justify-end border-r border-border/70 bg-card px-3 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              style={{ width: labelW }}
            >
              <span>{lanes.length} lanes</span>
            </div>
            <div className="relative shrink-0 overflow-hidden" style={{ width: trackW }}>
              {axis.months.map((m) => (
                <div
                  key={m.x}
                  className="absolute top-0 h-5 truncate border-l border-border/60 px-1.5 text-[11px] font-semibold leading-5 text-foreground/90"
                  style={{ left: m.x, width: m.w }}
                >
                  {m.w > 26 ? m.text : ''}
                </div>
              ))}
              {axis.ticks.map((t) => (
                <div
                  key={t.x}
                  className={`absolute top-5 h-[18px] border-l pl-0.5 text-[10px] leading-[18px] tabular-nums ${
                    t.strong ? 'border-border/70 text-muted-foreground' : 'border-border/30 text-muted-foreground/60'
                  }`}
                  style={{ left: t.x }}
                >
                  {t.text}
                </div>
              ))}
              {flags.map((f) => (
                <div
                  key={f.id}
                  className="absolute bottom-1 flex h-[20px] items-center"
                  style={{ left: f.x - 1 }}
                  title={`${f.name} · ${shortDay(f.day, true)}`}
                >
                  <span className="h-full w-[3px] rounded-sm" style={{ backgroundColor: f.color }} />
                  {f.room > 18 && (
                    <span
                      className="ml-0.5 truncate rounded-r px-1.5 text-[11px] font-semibold leading-[20px] text-white"
                      style={{ backgroundColor: `${f.color}cc`, maxWidth: f.room }}
                    >
                      {f.name}
                      <span className="ml-1 font-normal opacity-80">{shortDay(f.day)}</span>
                    </span>
                  )}
                </div>
              ))}
              {today >= domain.start && today <= domain.end && (
                <div className="absolute top-5 -translate-x-1/2 rounded bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground" style={{ left: todayX }}>
                  Today
                </div>
              )}
              {dropX !== null && drag && (
                <div
                  className="absolute top-5 z-10 rounded bg-foreground px-1.5 text-[10px] font-semibold leading-4 text-background"
                  style={{ left: dropX }}
                >
                  {shortDay(drag.day!)}
                </div>
              )}
            </div>
          </div>

          {/* ---------- lanes ---------- */}
          <div className="relative" style={{ height: geometry.height }}>
            {/* milestone + today lines (behind items, under the sticky label column) */}
            <div className="pointer-events-none absolute inset-y-0 z-0" style={{ left: labelW, width: trackW }}>
              {flags.map((f) => (
                <div key={f.id} className="absolute inset-y-0" style={{ left: f.x - 1 }}>
                  <div className="absolute inset-y-0 -left-[3px] w-[8px] opacity-20" style={{ backgroundColor: f.color }} />
                  <div className="absolute inset-y-0 w-[2px]" style={{ backgroundColor: f.color }} />
                </div>
              ))}
              {today >= domain.start && today <= domain.end && (
                <div className={`absolute inset-y-0 w-0 ${styles.todayLine}`} style={{ left: todayX }} />
              )}
              {dropX !== null && (
                <div className="absolute inset-y-0 border-l-2 border-dashed border-foreground/70" style={{ left: dropX }} />
              )}
            </div>

            {lanes.map((lane) => {
              const isClosed = collapsed.has(lane.id)
              const trayOpen = openTrays.has(lane.id) && lane.unscheduled.length > 0
              const h = geometry.laneHeight.get(lane.id)!
              const st = stacked.get(lane.id)
              return (
                <div key={lane.id}>
                  <div className="flex border-b border-border/50" style={{ height: h }}>
                    <LaneLabel
                      lane={lane}
                      width={labelW}
                      closed={isClosed}
                      trayOpen={trayOpen}
                      onToggle={onToggleLane}
                      onToggleTray={onToggleTray}
                    />
                    <div className="relative shrink-0" style={{ width: trackW, ...gridStyle }}>
                      {isClosed ? (
                        <CollapsedDots items={lane.items} scale={scale} domainStart={domain.start} />
                      ) : (
                        st &&
                        lane.items.map((item) => (
                          <ItemView
                            key={item.id}
                            item={item}
                            placement={st.placements.get(item.id)!}
                            scale={scale}
                            domainStart={domain.start}
                            selected={item.id === selectedId}
                            delta={drag?.mode === 'move' && drag.id === item.id ? drag.delta : 0}
                            onPointerDown={onItemPointerDown}
                            onKey={onItemKey}
                          />
                        ))
                      )}
                    </div>
                  </div>
                  {trayOpen && (
                    <div className="border-b border-border/50 bg-secondary/20" style={{ height: TRAY_H }}>
                      <div
                        className="sticky left-0 flex h-full items-center gap-1.5 overflow-x-auto px-3"
                        style={{ width: Math.max(200, viewportW) }}
                      >
                        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                          Drag onto the chart to set a due date:
                        </span>
                        {lane.unscheduled.map((info) => (
                          <TrayChip
                            key={info.id}
                            info={info}
                            selected={info.id === selectedId}
                            dragging={drag?.mode === 'schedule' && drag.id === info.id}
                            onPointerDown={onTrayPointerDown}
                            onKey={onItemKey}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {arrows.length > 0 && (
              <svg
                className="pointer-events-none absolute top-0 z-[5]"
                style={{ left: labelW }}
                width={trackW}
                height={geometry.height}
              >
                <defs>
                  <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="#a1a1aa" />
                  </marker>
                  <marker id="tl-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="#f87171" />
                  </marker>
                </defs>
                {arrows.map((a) => (
                  <path
                    key={a.key}
                    d={a.d}
                    fill="none"
                    stroke={a.conflict ? '#f87171' : '#a1a1aa'}
                    strokeWidth={a.conflict ? 2 : 1.4}
                    strokeDasharray={a.conflict ? '5 4' : undefined}
                    opacity={a.done ? 0.3 : 0.85}
                    markerEnd={a.conflict ? 'url(#tl-arrow-bad)' : 'url(#tl-arrow)'}
                  />
                ))}
              </svg>
            )}
          </div>
        </div>
      )}

      {drag?.mode === 'schedule' && (
        <div
          className="pointer-events-none fixed z-50 max-w-[260px] truncate rounded-md border border-primary/60 bg-card px-2 py-1 text-xs text-foreground shadow-xl"
          style={{ left: drag.x + 12, top: drag.y + 10 }}
        >
          {drag.label}
          <span className="ml-2 text-muted-foreground">{drag.day !== null ? `due ${shortDay(drag.day, true)}` : 'drop on the chart'}</span>
        </div>
      )}
    </div>
  )
})

/* ------------------------------------------------------------------ pieces -- */

const LaneLabel = memo(function LaneLabel({
  lane,
  width,
  closed,
  trayOpen,
  onToggle,
  onToggleTray,
}: {
  lane: Lane
  width: number
  closed: boolean
  trayOpen: boolean
  onToggle: (id: string) => void
  onToggleTray: (id: string) => void
}) {
  return (
    <div
      className="sticky left-0 z-20 flex shrink-0 flex-col justify-start gap-0.5 border-r border-border/70 bg-card px-2 py-1.5"
      style={{ width }}
    >
      <button
        type="button"
        onClick={() => onToggle(lane.id)}
        aria-expanded={!closed}
        className="flex min-w-0 items-center gap-1.5 rounded text-left text-sm font-medium text-foreground hover:text-primary"
        title={lane.label}
      >
        {closed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: lane.color ?? '#52525b' }} />
        <span className="truncate">{lane.label}</span>
      </button>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 text-[11px] text-muted-foreground">
        <span className="tabular-nums">{lane.total}</span>
        {lane.overdue > 0 && <span className="rounded bg-red-500/15 px-1 font-semibold tabular-nums text-red-300">{lane.overdue} overdue</span>}
        {lane.unscheduled.length > 0 && (
          <button
            type="button"
            onClick={() => onToggleTray(lane.id)}
            aria-expanded={trayOpen}
            className={`flex items-center gap-1 rounded px-1 transition-colors ${
              trayOpen ? 'bg-primary/20 text-primary' : 'bg-secondary/60 hover:text-foreground'
            }`}
            title="Undated tickets in this lane"
          >
            <Inbox className="h-3 w-3" />
            <span className="tabular-nums">{lane.unscheduled.length}</span>
            <span className="hidden sm:inline">undated</span>
          </button>
        )}
      </div>
    </div>
  )
})

const STATE_CLASS: Record<string, string> = {
  done: styles.done,
  crit: styles.crit,
  soon: styles.soon,
  prog: styles.prog,
  todo: styles.todo,
}

const ItemView = memo(function ItemView({
  item,
  placement,
  scale,
  domainStart,
  selected,
  delta,
  onPointerDown,
  onKey,
}: {
  item: TimelineItem
  placement: Placement
  scale: number
  domainStart: number
  selected: boolean
  delta: number
  onPointerDown: (e: React.PointerEvent, item: TimelineItem) => void
  onKey: (e: React.KeyboardEvent, id: string) => void
}) {
  const info = item.info
  const top = ROW_TOP_PAD + placement.row * ROW_H
  const blocked = info.warnings.blocked
  const cls = `${styles.item} ${STATE_CLASS[info.state]} ${blocked ? styles.blocked : ''} ${item.conflict ? styles.conflict : ''} ${
    selected ? styles.selected : ''
  } ${delta ? styles.moving : ''}`
  const shift = delta * scale
  const dueText = shortDay(item.end + delta, true)
  const tooltip = `${info.ref} ${info.title}\n${
    item.kind === 'bar' ? `${shortDay(item.start + delta, true)} to ${dueText}` : `Due ${dueText}`
  } · ${info.statusLabel}${blocked ? ' · blocked' : ''}${item.conflict ? ' · date conflict: a blocker is due after this' : ''}`

  if (item.kind === 'bar') {
    const left = (item.start - domainStart) * scale + shift
    const width = Math.max(6, (item.end - item.start + 1) * scale)
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={tooltip}
        title={tooltip}
        className={`${cls} ${styles.bar}`}
        style={{ left, top: top + 3, width }}
        onPointerDown={(e) => onPointerDown(e, item)}
        onKeyDown={(e) => onKey(e, item.id)}
      >
        {placement.label && placement.labelInside && <span className={styles.barLabel}>{placement.label}</span>}
        {item.conflict && <span className={styles.conflictFlag}>!</span>}
        {placement.label && !placement.labelInside && (
          <span className={styles.sideLabel} style={{ left: width + 4 }}>
            {placement.label}
          </span>
        )}
        {delta !== 0 && <span className={styles.dragTip}>{dueText}</span>}
      </div>
    )
  }

  const cx = (item.start - domainStart + 0.5) * scale + shift
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={tooltip}
      title={tooltip}
      className={`${cls} ${styles.point}`}
      style={{ left: cx - POINT_W / 2, top }}
      onPointerDown={(e) => onPointerDown(e, item)}
      onKeyDown={(e) => onKey(e, item.id)}
    >
      <span className={styles.diamond} />
      {item.conflict && <span className={styles.conflictFlag}>!</span>}
      {placement.label && <span className={styles.pointLabel}>{placement.label}</span>}
      {delta !== 0 && <span className={styles.dragTip}>{dueText}</span>}
    </div>
  )
})

const CollapsedDots = memo(function CollapsedDots({
  items,
  scale,
  domainStart,
}: {
  items: TimelineItem[]
  scale: number
  domainStart: number
}) {
  return (
    <>
      {items.map((item) => (
        <span
          key={item.id}
          className={`${styles.dot} ${STATE_CLASS[item.info.state]}`}
          style={{ left: (item.end - domainStart + 0.5) * scale - 3 }}
        />
      ))}
    </>
  )
})

const TrayChip = memo(function TrayChip({
  info,
  selected,
  dragging,
  onPointerDown,
  onKey,
}: {
  info: TicketInfo
  selected: boolean
  dragging: boolean
  onPointerDown: (e: React.PointerEvent, info: TicketInfo) => void
  onKey: (e: React.KeyboardEvent, id: string) => void
}) {
  const title = info.title.length > 28 ? `${info.title.slice(0, 27)}…` : info.title
  return (
    <div
      role="button"
      tabIndex={0}
      title={`${info.ref} ${info.title} · drag onto the chart to set a due date`}
      className={`${styles.chip} ${STATE_CLASS[info.state]} ${selected ? styles.selected : ''} ${dragging ? 'opacity-40' : ''}`}
      onPointerDown={(e) => onPointerDown(e, info)}
      onKeyDown={(e) => onKey(e, info.id)}
    >
      <span className="font-mono text-[10px] text-muted-foreground">{info.ref}</span>
      <span className="truncate">{title}</span>
    </div>
  )
})
