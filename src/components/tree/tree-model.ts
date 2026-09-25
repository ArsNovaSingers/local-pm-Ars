/**
 * Pure data layer for the Tree view: ticket → node state, warnings, hierarchy, critical
 * path and layout. Nothing in here touches the DOM, so it can be memoised on the ticket
 * list and never re-run while the user pans or zooms.
 */
import { isDoneStatus, statusColor, statusLabel, type BoardStatus } from '@/components/kanban/status-utils'
import type { Ticket } from '@/payload-types'

export type NodeState = 'done' | 'crit' | 'soon' | 'prog' | 'todo'

export const STATE_LABEL: Record<NodeState, string> = {
  done: 'Done',
  crit: 'Critical',
  soon: 'Due soon',
  prog: 'In progress',
  todo: 'To do',
}

export interface Person {
  id: string
  name: string
  initials: string
  color: string | null
}

export interface Warnings {
  overdue: boolean
  blocked: boolean
  unassigned: boolean
  noDue: boolean
}

export interface BlockerRef {
  id: string
  ref: string
  title: string
  done: boolean
  /** False when the blocker exists but is outside the current filter scope. */
  inScope: boolean
}

export interface TicketInfo {
  id: string
  ref: string
  title: string
  statusKey: string
  statusLabel: string
  statusColor: string
  priority: string
  /** YYYY-MM-DD or null. */
  due: string | null
  done: boolean
  state: NodeState
  warnings: Warnings
  assignee: Person | null
  projectId: string
  groupId: string
  groupLabel: string
  blockers: BlockerRef[]
  /** Ids of in-scope tickets this one blocks. */
  blocks: string[]
  labels: { name: string; color: string }[]
  raw: Ticket
}

export type TreeNodeKind = 'project' | 'group' | 'ticket'

export interface TreeNode {
  id: string
  kind: TreeNodeKind
  label: string
  sublabel?: string
  color?: string | null
  children: TreeNode[]
  /** For ticket nodes. */
  ticketId?: string
  /** Number of ticket leaves underneath (tickets count themselves). */
  ticketCount: number
  /** Tickets underneath that are not done. */
  openCount: number
  /** Tickets underneath that carry any strong warning (overdue or blocked). */
  alertCount: number
}

export interface TreeModel {
  tickets: Map<string, TicketInfo>
  roots: TreeNode[]
  /** node id → parent node id */
  parentOf: Map<string, string>
  /** In-order ticket ids on the critical path (blocker first). Empty when no chain ≥ 2. */
  criticalPath: string[]
  summary: {
    total: number
    open: number
    overdue: number
    blocked: number
    unassigned: number
    noDue: number
    edges: number
  }
}

/* ----------------------------------------------------------------- helpers -- */

function idOf(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

export function dayString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return dayString(new Date(y, m - 1, d + n))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sep 30" — or "Sep 30 2027" when not in the current year. */
export function formatDay(day: string | null, today?: string): string {
  if (!day) return ''
  const [y, m, d] = day.split('-').map(Number)
  const base = `${MONTHS[m - 1]} ${d}`
  return today && today.slice(0, 4) === String(y) ? base : `${base} ${y}`
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function ticketNumber(ref: string): number {
  const match = /(\d+)\s*$/.exec(ref)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

const GROUP_LABEL_PREFIXES = ['phase:', 'area:']

/* ------------------------------------------------------------------- build -- */

export interface BuildInput {
  tickets: Ticket[]
  projects: Array<{ id: string; name: string; prefix?: string; color?: string | null }>
  people: Person[]
  milestones: Array<{ id: string; name: string; date?: string | null; color?: string | null }>
  statuses: BoardStatus[]
  /** Local YYYY-MM-DD. */
  today: string
}

export function buildTreeModel({ tickets, projects, people, milestones, statuses, today }: BuildInput): TreeModel {
  const soonLimit = addDays(today, 3)
  const peopleById = new Map(people.map((p) => [p.id, p]))
  const milestonesById = new Map(milestones.map((m) => [m.id, m]))
  const projectsById = new Map(projects.map((p) => [p.id, p]))
  const inScope = new Set(tickets.map((t) => t.id))
  const rawById = new Map(tickets.map((t) => [t.id, t]))

  const isDone = (status: unknown) => isDoneStatus(statuses, status)

  const infos = new Map<string, TicketInfo>()

  for (const t of tickets) {
    const done = isDone(t.status)
    const due = t.dueDate ? String(t.dueDate).slice(0, 10) : null

    const assigneeId = idOf(t.team)
    let assignee: Person | null = null
    if (assigneeId) {
      assignee = peopleById.get(assigneeId) ?? null
      if (!assignee && typeof t.team === 'object' && t.team) {
        const name = String(t.team.name ?? 'Unknown')
        assignee = { id: assigneeId, name, initials: t.team.initials || initialsFor(name), color: t.team.color ?? null }
      }
    }

    const blockers: BlockerRef[] = []
    for (const b of t.blockedBy ?? []) {
      const bid = idOf(b)
      if (!bid || bid === t.id) continue
      const local = rawById.get(bid)
      const source = local ?? (typeof b === 'object' ? (b as Ticket) : null)
      blockers.push({
        id: bid,
        ref: source?.ticketId || '?',
        title: source?.title || 'Unknown ticket',
        done: source ? isDone(source.status) : false,
        inScope: inScope.has(bid),
      })
    }

    // Group: milestone first, then a phase:/area: label, else Ungrouped.
    const projectId = idOf(t.project) ?? 'none'
    const milestoneId = idOf(t.milestone)
    const labels = (t.labels ?? []).map((l) => ({ name: String(l.name), color: l.color || '#6366f1' }))
    let groupId: string
    let groupLabel: string
    if (milestoneId) {
      const m = milestonesById.get(milestoneId) ?? (typeof t.milestone === 'object' ? t.milestone : null)
      groupId = `m:${milestoneId}`
      groupLabel = m?.name ? String(m.name) : 'Milestone'
    } else {
      const label = labels.find((l) => GROUP_LABEL_PREFIXES.some((p) => l.name.toLowerCase().startsWith(p)))
      if (label) {
        groupId = `l:${label.name.toLowerCase()}`
        groupLabel = label.name
      } else {
        groupId = 'none'
        groupLabel = 'Ungrouped'
      }
    }

    const overdue = !done && !!due && due < today
    const blocked = !done && blockers.some((b) => !b.done)
    const warnings: Warnings = {
      overdue,
      blocked,
      unassigned: !done && !assignee,
      noDue: !done && !due,
    }

    let state: NodeState
    if (done) state = 'done'
    else if (t.priority === 'URGENT' || overdue) state = 'crit'
    else if (due && due <= soonLimit) state = 'soon'
    else if (String(t.status) === 'IN_PROGRESS') state = 'prog'
    else state = 'todo'

    infos.set(t.id, {
      id: t.id,
      ref: t.ticketId || t.id.slice(-6),
      title: t.title || 'Untitled',
      statusKey: String(t.status),
      statusLabel: statusLabel(statuses, t.status),
      statusColor: statusColor(statuses, t.status),
      priority: String(t.priority ?? 'NO_PRIORITY'),
      due,
      done,
      state,
      warnings,
      assignee,
      projectId,
      groupId,
      groupLabel,
      blockers,
      blocks: [],
      labels,
      raw: t,
    })
  }

  let edges = 0
  for (const info of infos.values()) {
    for (const b of info.blockers) {
      const blocker = infos.get(b.id)
      if (blocker) {
        blocker.blocks.push(info.id)
        edges += 1
      }
    }
  }

  /* --- hierarchy --------------------------------------------------------- */
  const byProject = new Map<string, Map<string, TicketInfo[]>>()
  for (const info of infos.values()) {
    let groups = byProject.get(info.projectId)
    if (!groups) byProject.set(info.projectId, (groups = new Map()))
    const list = groups.get(info.groupId)
    if (list) list.push(info)
    else groups.set(info.groupId, [info])
  }

  const parentOf = new Map<string, string>()
  const roots: TreeNode[] = []

  const groupSortKey = (groupId: string, label: string): string => {
    if (groupId.startsWith('m:')) {
      const m = milestonesById.get(groupId.slice(2))
      return `0|${m?.date ?? '9999'}|${label.toLowerCase()}`
    }
    if (groupId.startsWith('l:')) return `1|${label.toLowerCase()}`
    return '2|'
  }

  const projectOrder = [...byProject.keys()].sort((a, b) => {
    const pa = projectsById.get(a)?.name ?? ''
    const pb = projectsById.get(b)?.name ?? ''
    return pa.localeCompare(pb)
  })

  for (const projectId of projectOrder) {
    const groups = byProject.get(projectId)!
    const project = projectsById.get(projectId)
    const projectNodeId = `p:${projectId}`
    const projectNode: TreeNode = {
      id: projectNodeId,
      kind: 'project',
      label: project?.name ?? 'Unknown project',
      sublabel: project?.prefix,
      color: project?.color ?? null,
      children: [],
      ticketCount: 0,
      openCount: 0,
      alertCount: 0,
    }

    const groupIds = [...groups.keys()].sort((a, b) =>
      groupSortKey(a, groups.get(a)![0].groupLabel).localeCompare(groupSortKey(b, groups.get(b)![0].groupLabel)),
    )

    for (const groupId of groupIds) {
      const list = groups.get(groupId)!
      list.sort((a, b) => ticketNumber(a.ref) - ticketNumber(b.ref) || a.ref.localeCompare(b.ref))
      const groupNodeId = `${projectNodeId}|g:${groupId}`
      const milestone = groupId.startsWith('m:') ? milestonesById.get(groupId.slice(2)) : undefined
      const groupNode: TreeNode = {
        id: groupNodeId,
        kind: 'group',
        label: list[0].groupLabel,
        sublabel: groupId.startsWith('m:') ? 'Milestone' : groupId.startsWith('l:') ? 'Label' : undefined,
        color: milestone?.color ?? list[0].labels.find((l) => l.name === list[0].groupLabel)?.color ?? null,
        children: [],
        ticketCount: 0,
        openCount: 0,
        alertCount: 0,
      }
      for (const info of list) {
        const alert = info.warnings.overdue || info.warnings.blocked ? 1 : 0
        groupNode.children.push({
          id: info.id,
          kind: 'ticket',
          label: info.title,
          ticketId: info.id,
          children: [],
          ticketCount: 1,
          openCount: info.done ? 0 : 1,
          alertCount: alert,
        })
        parentOf.set(info.id, groupNodeId)
        groupNode.ticketCount += 1
        groupNode.openCount += info.done ? 0 : 1
        groupNode.alertCount += alert
      }
      parentOf.set(groupNodeId, projectNodeId)
      projectNode.children.push(groupNode)
      projectNode.ticketCount += groupNode.ticketCount
      projectNode.openCount += groupNode.openCount
      projectNode.alertCount += groupNode.alertCount
    }
    roots.push(projectNode)
  }

  /* --- critical path ----------------------------------------------------- */
  const criticalPath = longestOpenChain(infos)

  let overdue = 0
  let blocked = 0
  let unassigned = 0
  let noDue = 0
  let open = 0
  for (const info of infos.values()) {
    if (!info.done) open += 1
    if (info.warnings.overdue) overdue += 1
    if (info.warnings.blocked) blocked += 1
    if (info.warnings.unassigned) unassigned += 1
    if (info.warnings.noDue) noDue += 1
  }

  return {
    tickets: infos,
    roots,
    parentOf,
    criticalPath,
    summary: { total: infos.size, open, overdue, blocked, unassigned, noDue, edges },
  }
}

/**
 * Longest chain of unfinished tickets linked by blockedBy (within scope). Memoised DFS;
 * a ticket currently on the stack is skipped, so a cycle (older data can contain one)
 * shortens the chain instead of hanging the page.
 */
export function longestOpenChain(infos: Map<string, TicketInfo>): string[] {
  const memo = new Map<string, string[]>()
  const onStack = new Set<string>()

  const walk = (id: string): string[] => {
    const cached = memo.get(id)
    if (cached) return cached
    onStack.add(id)
    let best: string[] = []
    const info = infos.get(id)!
    for (const b of info.blockers) {
      const blocker = infos.get(b.id)
      if (!blocker || blocker.done || onStack.has(b.id)) continue
      const chain = walk(b.id)
      if (chain.length > best.length) best = chain
    }
    onStack.delete(id)
    const result = [...best, id]
    memo.set(id, result)
    return result
  }

  let longest: string[] = []
  for (const info of infos.values()) {
    if (info.done) continue
    const chain = walk(info.id)
    if (chain.length > longest.length) longest = chain
  }
  return longest.length >= 2 ? longest : []
}

/* ------------------------------------------------------------------ layout -- */

export const LAYOUT = {
  colGap: 56,
  rowGap: 12,
  width: { project: 220, group: 220, ticket: 264 } as Record<TreeNodeKind, number>,
  /** Fixed node heights (nodes are rendered at exactly these; widths are measured). */
  height: { project: 66, group: 62, ticket: 70 } as Record<TreeNodeKind, number>,
}

export interface PlacedNode {
  node: TreeNode
  depth: number
  x: number
  /** Vertical centre. */
  y: number
  collapsed: boolean
  hidden: number
}

export interface Layout {
  placed: PlacedNode[]
  byId: Map<string, PlacedNode>
  width: number
  height: number
  /** node id of the visible representative of every ticket id (itself, or a collapsed ancestor). */
  visibleFor: Map<string, string>
}

/**
 * depth → x, in-order leaf walk → y; a parent is centred on the midpoint of its first and
 * last visible child. Collapsed nodes are leaves.
 */
export function layoutTree(roots: TreeNode[], closed: ReadonlySet<string>): Layout {
  const placed: PlacedNode[] = []
  const byId = new Map<string, PlacedNode>()
  const visibleFor = new Map<string, string>()
  const colX = [0]
  const colWidth = (depth: number) => (depth === 0 ? LAYOUT.width.project : depth === 1 ? LAYOUT.width.group : LAYOUT.width.ticket)
  for (let d = 1; d < 4; d++) colX[d] = colX[d - 1] + colWidth(d - 1) + LAYOUT.colGap

  let cursor = 0
  let maxRight = 0

  const markHidden = (node: TreeNode, rep: string) => {
    for (const child of node.children) {
      if (child.kind === 'ticket') visibleFor.set(child.id, rep)
      markHidden(child, rep)
    }
  }

  const visit = (node: TreeNode, depth: number, roundGap: boolean): number => {
    const isClosed = node.kind !== 'ticket' && closed.has(node.id)
    const x = colX[depth]
    let y: number
    if (node.kind === 'ticket') visibleFor.set(node.id, node.id)
    if (!node.children.length || isClosed) {
      const h = LAYOUT.height[node.kind]
      if (roundGap && cursor > 0) cursor += LAYOUT.rowGap
      y = cursor + h / 2
      cursor += h + LAYOUT.rowGap
      if (isClosed) markHidden(node, node.id)
    } else {
      const ys: number[] = []
      node.children.forEach((child, i) => ys.push(visit(child, depth + 1, i === 0 && child.kind !== 'ticket')))
      y = (ys[0] + ys[ys.length - 1]) / 2
      // Separate sibling groups a little more than sibling tickets.
      cursor += LAYOUT.rowGap
    }
    const p: PlacedNode = { node, depth, x, y, collapsed: isClosed, hidden: isClosed ? node.ticketCount : 0 }
    placed.push(p)
    byId.set(node.id, p)
    maxRight = Math.max(maxRight, x + LAYOUT.width[node.kind])
    return y
  }

  roots.forEach((root, i) => {
    if (i > 0) cursor += LAYOUT.rowGap * 3
    visit(root, 0, false)
  })

  return { placed, byId, width: maxRight, height: cursor, visibleFor }
}
