/**
 * Pure data layer for the Network view. Ticket state, warnings and the global critical
 * path come from the Tree view's model (buildTreeModel / longestOpenChain); this file adds
 * what is specific to a dependency network: Ready / Blocked derivation, a layered
 * left-to-right layout, focus sets, the "path to a milestone" chain, date conflicts and
 * cycle explanations. Nothing here touches the DOM, so it is memoised on the ticket list
 * and never re-runs while the user pans or zooms.
 */
import type { BoardStatus } from '@/components/kanban/status-utils'
import type { TicketInfo, TreeModel } from '@/components/tree/tree-model'

export type NetState = 'ready' | 'blocked' | 'prog' | 'done'

export const NET_STATE_LABEL: Record<NetState, string> = {
  ready: 'Ready',
  blocked: 'Blocked',
  prog: 'In progress',
  done: 'Done',
}

export interface NetNode {
  id: string
  info: TicketInfo
  state: NetState
  /** In-scope blockers that are not done. */
  openBlockers: number
  /** The status row says "blocked" but no open blocker is recorded: a missing edge. */
  statusSaysBlocked: boolean
}

export interface NetEdge {
  key: string
  /** Blocker. */
  from: string
  /** Blocked ticket. */
  to: string
  /** Blocker is done, so this edge no longer holds anything up. */
  done: boolean
}

export interface Graph {
  nodes: Map<string, NetNode>
  edges: NetEdge[]
  edgeByKey: Map<string, NetEdge>
  /** id → in-scope blocker ids */
  blockersOf: Map<string, string[]>
  /** id → in-scope ids it blocks */
  blocksOf: Map<string, string[]>
  /** Tickets in at least one in-scope edge. */
  connected: Set<string>
}

export const edgeKey = (from: string, to: string) => `${from}>${to}`

/* ------------------------------------------------------------------ states -- */

/**
 * Statuses are data, so "in progress" is derived rather than hard-coded: an open status
 * ordered after the workspace's default (new-ticket) status that is not flagged blocked.
 */
function inProgressKeys(statuses: BoardStatus[]): Set<string> {
  const real = statuses.filter((s) => !s.isUnknown)
  const def = real.find((s) => s.isDefault) ?? real[0]
  const keys = new Set<string>()
  if (!def) return keys
  for (const s of real) if (!s.isDone && !s.isBlocked && s.order > def.order) keys.add(s.key)
  return keys
}

export function buildGraph(model: TreeModel, statuses: BoardStatus[]): Graph {
  const prog = inProgressKeys(statuses)
  const blockedStatus = new Set(statuses.filter((s) => s.isBlocked).map((s) => s.key))
  const nodes = new Map<string, NetNode>()
  const edges: NetEdge[] = []
  const edgeByKey = new Map<string, NetEdge>()
  const blockersOf = new Map<string, string[]>()
  const blocksOf = new Map<string, string[]>()
  const connected = new Set<string>()

  for (const info of model.tickets.values()) {
    const inScope = info.blockers.filter((b) => model.tickets.has(b.id))
    const openBlockers = inScope.filter((b) => !model.tickets.get(b.id)!.done).length
    let state: NetState
    if (info.done) state = 'done'
    else if (openBlockers > 0) state = 'blocked'
    else if (prog.has(info.statusKey)) state = 'prog'
    else state = 'ready'
    nodes.set(info.id, {
      id: info.id,
      info,
      state,
      openBlockers,
      statusSaysBlocked: !info.done && openBlockers === 0 && blockedStatus.has(info.statusKey),
    })
    blockersOf.set(
      info.id,
      inScope.map((b) => b.id),
    )
    if (!blocksOf.has(info.id)) blocksOf.set(info.id, [])
  }

  for (const [to, list] of blockersOf) {
    for (const from of list) {
      const e: NetEdge = { key: edgeKey(from, to), from, to, done: model.tickets.get(from)!.done }
      if (edgeByKey.has(e.key)) continue
      edges.push(e)
      edgeByKey.set(e.key, e)
      blocksOf.get(from)!.push(to)
      connected.add(from)
      connected.add(to)
    }
  }

  return { nodes, edges, edgeByKey, blockersOf, blocksOf, connected }
}

/* ------------------------------------------------------------ graph walks -- */

function walk(start: string, next: Map<string, string[]>, allowed?: Set<string>): Set<string> {
  const seen = new Set<string>()
  const stack = [...(next.get(start) ?? [])]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id) || id === start || (allowed && !allowed.has(id))) continue
    seen.add(id)
    for (const n of next.get(id) ?? []) if (!seen.has(n)) stack.push(n)
  }
  return seen
}

/** Everything that must finish before `id` (transitive blockers). */
export const upstreamOf = (g: Graph, id: string) => walk(id, g.blockersOf)
/** Everything waiting on `id` (transitive dependants). */
export const downstreamOf = (g: Graph, id: string) => walk(id, g.blocksOf)

/**
 * If making `blocked` wait on `blocker` would close a loop, return the existing chain
 * that proves it, written blocked-ticket first: [blocker, ..., blocked] where each item is
 * blocked by the next. Null when the new edge is safe (as far as the loaded scope shows).
 */
export function cyclePath(g: Graph, blocked: string, blocker: string): string[] | null {
  if (blocked === blocker) return [blocked]
  // A loop exists if `blocked` is already upstream of `blocker`.
  const prev = new Map<string, string>()
  const queue = [blocker]
  const seen = new Set([blocker])
  while (queue.length) {
    const id = queue.shift()!
    for (const b of g.blockersOf.get(id) ?? []) {
      if (seen.has(b)) continue
      seen.add(b)
      prev.set(b, id)
      if (b === blocked) {
        const chain = [b]
        let cur = b
        while (prev.has(cur)) {
          cur = prev.get(cur)!
          chain.push(cur)
        }
        return chain.reverse()
      }
      queue.push(b)
    }
  }
  return null
}

/**
 * Longest chain of unfinished tickets that ends in one of `targets`, walking only through
 * `allowed`. Same cycle-safe memoised DFS as the Tree view's longestOpenChain, but anchored
 * at a milestone's tickets instead of anywhere in the graph.
 */
export function longestChainInto(g: Graph, targets: Iterable<string>, allowed: Set<string>): string[] {
  const memo = new Map<string, string[]>()
  const onStack = new Set<string>()
  const go = (id: string): string[] => {
    const cached = memo.get(id)
    if (cached) return cached
    onStack.add(id)
    let best: string[] = []
    for (const b of g.blockersOf.get(id) ?? []) {
      const n = g.nodes.get(b)
      if (!n || n.state === 'done' || onStack.has(b) || !allowed.has(b)) continue
      const chain = go(b)
      if (chain.length > best.length) best = chain
    }
    onStack.delete(id)
    const result = [...best, id]
    memo.set(id, result)
    return result
  }
  let longest: string[] = []
  for (const t of targets) {
    const n = g.nodes.get(t)
    if (!n || n.state === 'done') continue
    const chain = go(t)
    if (chain.length > longest.length) longest = chain
  }
  return longest.length >= 2 ? longest : []
}

/* ---------------------------------------------------------- date conflicts -- */

export interface Conflicts {
  /** edge key → reason */
  edges: Map<string, string>
  /** ticket id → reasons */
  nodes: Map<string, string[]>
}

const push = (m: Map<string, string[]>, id: string, why: string) => {
  const list = m.get(id)
  if (list) list.push(why)
  else m.set(id, [why])
}

/**
 * A blocker due after the ticket it blocks (the plan cannot be met as written), or, when
 * a milestone is in focus, an open ticket on the way to it due after the concert itself.
 */
export function findConflicts(
  g: Graph,
  drawn: Set<string>,
  milestone: { name: string; date: string | null } | null,
  formatDay: (d: string) => string,
): Conflicts {
  const edges = new Map<string, string>()
  const nodes = new Map<string, string[]>()
  for (const e of g.edges) {
    if (e.done || !drawn.has(e.from) || !drawn.has(e.to)) continue
    const a = g.nodes.get(e.from)!.info
    const b = g.nodes.get(e.to)!.info
    if (a.due && b.due && a.due > b.due && !b.done) {
      const why = `${a.ref} is due ${formatDay(a.due)}, after ${b.ref} which it blocks (${formatDay(b.due)})`
      edges.set(e.key, why)
      push(nodes, a.id, why)
      push(nodes, b.id, why)
    }
  }
  if (milestone?.date) {
    for (const id of drawn) {
      const n = g.nodes.get(id)
      if (!n || n.state === 'done' || !n.info.due) continue
      if (n.info.due > milestone.date) {
        push(nodes, id, `Due ${formatDay(n.info.due)}, after ${milestone.name} (${formatDay(milestone.date)})`)
      }
    }
  }
  return { edges, nodes }
}

/* ------------------------------------------------------------------ layout -- */

export const CARD = { w: 236, h: 86, colGap: 88, rowGap: 18, compGap: 72, gridGap: 16 }

export interface Pos {
  x: number
  y: number
}

export interface NetLayout {
  pos: Map<string, Pos>
  /** Bottom of the DAG area (0 when nothing is connected). */
  graphHeight: number
  /** Where the unconnected grid starts, if any. */
  gridTop: number | null
  gridCount: number
  width: number
  height: number
}

function refNumber(ref: string): number {
  const m = /(\d+)\s*$/.exec(ref)
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

function byRef(g: Graph) {
  return (a: string, b: string) => {
    const ia = g.nodes.get(a)!.info
    const ib = g.nodes.get(b)!.info
    const pa = ia.ref.replace(/-?\d+\s*$/, '')
    const pb = ib.ref.replace(/-?\d+\s*$/, '')
    return pa.localeCompare(pb) || refNumber(ia.ref) - refNumber(ib.ref)
  }
}

interface CompLayout {
  ids: string[]
  local: Map<string, Pos>
  w: number
  h: number
}

/** Layer = longest path from a root (cycle-safe); order within a layer by barycentre. */
function layoutComponent(g: Graph, ids: string[], inSet: Set<string>): CompLayout {
  const layer = new Map<string, number>()
  const onStack = new Set<string>()
  const depth = (id: string): number => {
    const known = layer.get(id)
    if (known !== undefined) return known
    onStack.add(id)
    let d = 0
    for (const b of g.blockersOf.get(id) ?? []) {
      if (!inSet.has(b) || onStack.has(b)) continue
      d = Math.max(d, depth(b) + 1)
    }
    onStack.delete(id)
    layer.set(id, d)
    return d
  }
  ids.forEach(depth)

  const cols: string[][] = []
  const sorted = [...ids].sort(byRef(g))
  for (const id of sorted) {
    const l = layer.get(id)!
    ;(cols[l] ??= []).push(id)
  }
  for (let i = 0; i < cols.length; i++) cols[i] ??= []

  const index = new Map<string, number>()
  const reindex = () => cols.forEach((col) => col.forEach((id, i) => index.set(id, i)))
  reindex()
  const bary = (id: string, nbrs: string[] | undefined, fallback: number) => {
    const list = (nbrs ?? []).filter((n) => inSet.has(n) && index.has(n))
    if (!list.length) return fallback
    return list.reduce((s, n) => s + index.get(n)!, 0) / list.length
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let l = 1; l < cols.length; l++) {
      const col = cols[l]
      const key = new Map(col.map((id, i) => [id, bary(id, g.blockersOf.get(id), i)]))
      col.sort((a, b) => key.get(a)! - key.get(b)!)
      reindex()
    }
    for (let l = cols.length - 2; l >= 0; l--) {
      const col = cols[l]
      const key = new Map(col.map((id, i) => [id, bary(id, g.blocksOf.get(id), i)]))
      col.sort((a, b) => key.get(a)! - key.get(b)!)
      reindex()
    }
  }

  const rows = Math.max(...cols.map((c) => c.length))
  const h = rows * (CARD.h + CARD.rowGap) - CARD.rowGap
  const w = cols.length * (CARD.w + CARD.colGap) - CARD.colGap
  const local = new Map<string, Pos>()
  cols.forEach((col, l) => {
    const colH = col.length * (CARD.h + CARD.rowGap) - CARD.rowGap
    const top = (h - colH) / 2
    col.forEach((id, i) => local.set(id, { x: l * (CARD.w + CARD.colGap), y: top + i * (CARD.h + CARD.rowGap) }))
  })
  return { ids, local, w, h }
}

/**
 * Connected tickets: each weakly-connected component is laid out on its own and the
 * components are shelf-packed (biggest first), so twenty small chains read as twenty
 * small chains rather than one tangle. Unconnected tickets go in a grid underneath.
 */
export function layoutNetwork(g: Graph, graphIds: string[], gridIds: string[]): NetLayout {
  const inSet = new Set(graphIds)
  // Components via union-find over in-set edges.
  const parent = new Map(graphIds.map((id) => [id, id]))
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    let c = x
    while (parent.get(c) !== r) {
      const n = parent.get(c)!
      parent.set(c, r)
      c = n
    }
    return r
  }
  for (const e of g.edges) {
    if (inSet.has(e.from) && inSet.has(e.to)) parent.set(find(e.from), find(e.to))
  }
  const groups = new Map<string, string[]>()
  for (const id of graphIds) {
    const r = find(id)
    const list = groups.get(r)
    if (list) list.push(id)
    else groups.set(r, [id])
  }

  const order = byRef(g)
  const comps = [...groups.values()]
    .map((ids) => layoutComponent(g, ids, inSet))
    .sort((a, b) => b.ids.length - a.ids.length || order([...a.ids].sort(order)[0], [...b.ids].sort(order)[0]))

  const pos = new Map<string, Pos>()
  const maxCompW = comps.reduce((m, c) => Math.max(m, c.w), 0)
  const shelfW = Math.max(maxCompW, 1700)
  let x = 0
  let y = 0
  let rowH = 0
  let width = 0
  for (const c of comps) {
    if (x > 0 && x + c.w > shelfW) {
      x = 0
      y += rowH + CARD.compGap
      rowH = 0
    }
    for (const [id, p] of c.local) pos.set(id, { x: x + p.x, y: y + p.y })
    x += c.w + CARD.compGap
    rowH = Math.max(rowH, c.h)
    width = Math.max(width, x - CARD.compGap)
  }
  const graphHeight = comps.length ? y + rowH : 0

  let gridTop: number | null = null
  let height = graphHeight
  if (gridIds.length) {
    gridTop = graphHeight ? graphHeight + 110 : 40
    const cols = Math.max(4, Math.min(8, Math.floor(Math.max(width, 1200) / (CARD.w + CARD.gridGap))))
    const sortedGrid = [...gridIds].sort(order)
    sortedGrid.forEach((id, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      pos.set(id, { x: c * (CARD.w + CARD.gridGap), y: gridTop! + r * (CARD.h + CARD.gridGap) })
    })
    const rows = Math.ceil(sortedGrid.length / cols)
    height = gridTop + rows * (CARD.h + CARD.gridGap)
    width = Math.max(width, cols * (CARD.w + CARD.gridGap) - CARD.gridGap)
  }

  return { pos, graphHeight, gridTop, gridCount: gridIds.length, width, height }
}
