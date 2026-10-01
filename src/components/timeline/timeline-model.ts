/**
 * Pure data layer for the Timeline view. Nothing here touches the DOM.
 *
 * Positions are kept in DAYS (integer day numbers), never pixels, except for the row
 * stacking pass which needs to know how wide a label is at the current zoom. That pass is
 * memoised on (lanes, pixels-per-day): scrolling never re-runs it, and zoom only re-runs
 * it when a preset changes the scale.
 */
import type { TicketInfo, TreeModel } from '@/components/tree/tree-model'

export type GroupBy = 'project' | 'assignee' | 'milestone'

const MS_PER_DAY = 86_400_000

/** "YYYY-MM-DD" → integer day number (days since 1970-01-01, calendar-based, no TZ drift). */
export function dayNum(day: string): number {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY)
}

/** Integer day number → "YYYY-MM-DD". */
export function dayStr(n: number): string {
  const dt = new Date(n * MS_PER_DAY)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Calendar parts of a day number (UTC so the calendar never shifts). */
export function dayParts(n: number): { y: number; m: number; d: number; dow: number } {
  const dt = new Date(n * MS_PER_DAY)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate(), dow: dt.getUTCDay() }
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function shortDay(n: number, withYear = false): string {
  const { y, m, d } = dayParts(n)
  return withYear ? `${MONTHS[m]} ${d} ${y}` : `${MONTHS[m]} ${d}`
}

/** The choir season containing `today`: Sep 1 → Jun 30. */
export function seasonRange(today: number): { start: number; end: number } {
  const { y, m } = dayParts(today)
  const startYear = m >= 7 ? y : y - 1 // Aug onward belongs to the season starting that Sep
  return { start: dayNum(`${startYear}-09-01`), end: dayNum(`${startYear + 1}-06-30`) }
}

/* ------------------------------------------------------------------- items -- */

export type ItemKind = 'bar' | 'point'

export interface TimelineItem {
  id: string
  info: TicketInfo
  kind: ItemKind
  /** Day numbers. For a point, start === end === due. */
  start: number
  end: number
  /** True when a blocker (in scope) is due after this ticket. */
  conflict: boolean
}

export interface Lane {
  id: string
  label: string
  sublabel?: string
  color: string | null
  items: TimelineItem[]
  unscheduled: TicketInfo[]
  total: number
  overdue: number
}

export interface Summary {
  bars: number
  points: number
  unscheduled: number
  overdue: number
  conflicts: number
}

export interface DateConflict {
  blockerId: string
  blockedId: string
}

export interface BuildLanesInput {
  model: TreeModel
  groupBy: GroupBy
  projects: Array<{ id: string; name: string; prefix?: string; color?: string | null }>
  milestones: Array<{ id: string; name: string; date?: string | null; color?: string | null }>
  people: Array<{ id: string; name: string; color: string | null }>
}

function idOf(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) return String((value as { id: unknown }).id)
  return null
}

function ticketNumber(ref: string): number {
  const match = /(\d+)\s*$/.exec(ref)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

/** Turns one ticket into an item, or null when it has no due date. */
export function toItem(info: TicketInfo): TimelineItem | null {
  const due = info.due
  if (!due) return null
  const end = dayNum(due)
  const startRaw = info.raw.startDate ? String(info.raw.startDate).slice(0, 10) : null
  if (startRaw) {
    let start = dayNum(startRaw)
    if (start > end) start = end // bad data: never draw a negative bar
    return { id: info.id, info, kind: 'bar', start, end, conflict: false }
  }
  return { id: info.id, info, kind: 'point', start: end, end, conflict: false }
}

export function findConflicts(items: Map<string, TimelineItem>): DateConflict[] {
  const out: DateConflict[] = []
  for (const item of items.values()) {
    if (item.info.done) continue
    for (const b of item.info.blockers) {
      const blocker = items.get(b.id)
      if (!blocker || blocker.info.done) continue
      if (blocker.end > item.end) out.push({ blockerId: blocker.id, blockedId: item.id })
    }
  }
  return out
}

export function buildLanes({ model, groupBy, projects, milestones, people }: BuildLanesInput): {
  lanes: Lane[]
  items: Map<string, TimelineItem>
  conflicts: DateConflict[]
  summary: Summary
  /** Earliest/latest day number of anything dated (tickets only). */
  span: { min: number; max: number } | null
} {
  const items = new Map<string, TimelineItem>()
  for (const info of model.tickets.values()) {
    const item = toItem(info)
    if (item) items.set(info.id, item)
  }
  const conflicts = findConflicts(items)
  for (const c of conflicts) items.get(c.blockedId)!.conflict = true

  const lanesById = new Map<string, Lane>()
  const laneFor = (id: string, label: string, color: string | null, sublabel?: string): Lane => {
    let lane = lanesById.get(id)
    if (!lane) {
      lane = { id, label, sublabel, color, items: [], unscheduled: [], total: 0, overdue: 0 }
      lanesById.set(id, lane)
    }
    return lane
  }

  const projectsById = new Map(projects.map((p) => [p.id, p]))
  const milestonesById = new Map(milestones.map((m) => [m.id, m]))
  const peopleById = new Map(people.map((p) => [p.id, p]))

  for (const info of model.tickets.values()) {
    let lane: Lane
    if (groupBy === 'project') {
      const p = projectsById.get(info.projectId)
      lane = p ? laneFor(`p:${p.id}`, p.name, p.color ?? null, p.prefix) : laneFor('p:none', 'No project', null)
    } else if (groupBy === 'assignee') {
      const a = info.assignee
      lane = a
        ? laneFor(`a:${a.id}`, peopleById.get(a.id)?.name ?? a.name, a.color ?? null, a.initials)
        : laneFor('a:none', 'Unassigned', null)
    } else {
      const mid = idOf(info.raw.milestone)
      const m = mid ? milestonesById.get(mid) : undefined
      lane = m
        ? laneFor(`m:${m.id}`, m.name, m.color ?? null, m.date ? shortDay(dayNum(String(m.date))) : undefined)
        : laneFor('m:none', 'No milestone', null)
    }
    lane.total += 1
    if (info.warnings.overdue) lane.overdue += 1
    const item = items.get(info.id)
    if (item) lane.items.push(item)
    else lane.unscheduled.push(info)
  }

  const lanes = [...lanesById.values()]
  const isNone = (l: Lane) => l.id.endsWith(':none')
  lanes.sort((a, b) => {
    if (isNone(a) !== isNone(b)) return isNone(a) ? 1 : -1
    if (groupBy === 'milestone') {
      const da = milestonesById.get(a.id.slice(2))?.date ?? '9999'
      const db = milestonesById.get(b.id.slice(2))?.date ?? '9999'
      if (da !== db) return String(da).localeCompare(String(db))
    }
    return a.label.localeCompare(b.label)
  })
  for (const lane of lanes) {
    lane.items.sort((a, b) => a.start - b.start || a.end - b.end || ticketNumber(a.info.ref) - ticketNumber(b.info.ref))
    lane.unscheduled.sort((a, b) => ticketNumber(a.ref) - ticketNumber(b.ref) || a.ref.localeCompare(b.ref))
  }

  let bars = 0
  let points = 0
  let min = Infinity
  let max = -Infinity
  for (const item of items.values()) {
    if (item.kind === 'bar') bars += 1
    else points += 1
    if (item.start < min) min = item.start
    if (item.end > max) max = item.end
  }

  return {
    lanes,
    items,
    conflicts,
    summary: {
      bars,
      points,
      unscheduled: model.tickets.size - items.size,
      overdue: model.summary.overdue,
      conflicts: conflicts.length,
    },
    span: items.size ? { min, max } : null,
  }
}

/* ----------------------------------------------------------- row stacking -- */

export const ROW_H = 26
export const POINT_W = 14
export const LABEL_CHAR_PX = 6.4
export const LABEL_MAX_CHARS = 30
export const GAP_PX = 6

export interface Placement {
  row: number
  /** Whether the inline label is drawn (false when it would not fit anywhere). */
  label: string | null
  /** Label sits inside the bar (true) or to its right (false). */
  labelInside: boolean
}

export function itemLabel(item: TimelineItem, maxChars = LABEL_MAX_CHARS): string {
  const title = item.info.title.length > maxChars ? `${item.info.title.slice(0, maxChars - 1)}…` : item.info.title
  return `${item.info.ref} ${title}`
}

/**
 * Greedy interval packing in pixel space. Each item wants its marker (or bar) plus a label;
 * if the label does not fit within the first MAX_LABEL_ROWS rows it is dropped (the title
 * is still in the tooltip and the detail panel) and only the marker is packed. Markers
 * never overlap: a crowded day simply gets more rows.
 */
export function stackLane(items: TimelineItem[], pxPerDay: number, domainStart: number): {
  placements: Map<string, Placement>
  rows: number
} {
  const MAX_LABEL_ROWS = 6
  const rowEnds: number[] = []
  const placements = new Map<string, Placement>()

  for (const item of items) {
    const x0 = (item.start - domainStart) * pxPerDay
    let markerStart: number
    let markerEnd: number
    if (item.kind === 'bar') {
      markerStart = x0
      markerEnd = (item.end + 1 - domainStart) * pxPerDay
    } else {
      const cx = x0 + pxPerDay / 2
      markerStart = cx - POINT_W / 2
      markerEnd = cx + POINT_W / 2
    }
    const label = itemLabel(item)
    const labelPx = label.length * LABEL_CHAR_PX + 8
    const fitsInside = item.kind === 'bar' && markerEnd - markerStart >= labelPx + 6
    const withLabelEnd = fitsInside ? markerEnd : markerEnd + labelPx

    let row = -1
    let showLabel = false
    for (let r = 0; r < Math.min(rowEnds.length, MAX_LABEL_ROWS); r++) {
      if (rowEnds[r] + GAP_PX <= markerStart) {
        row = r
        showLabel = true
        break
      }
    }
    if (row === -1 && rowEnds.length < MAX_LABEL_ROWS) {
      row = rowEnds.length
      showLabel = true
    }
    if (row === -1) {
      for (let r = 0; r < rowEnds.length; r++) {
        if (rowEnds[r] + 2 <= markerStart) {
          row = r
          break
        }
      }
      if (row === -1) row = rowEnds.length
    }
    const end = showLabel ? withLabelEnd : markerEnd
    rowEnds[row] = end
    placements.set(item.id, { row, label: showLabel ? label : null, labelInside: showLabel && fitsInside })
  }
  return { placements, rows: Math.max(1, rowEnds.length) }
}
