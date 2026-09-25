'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Ban, ChevronDown, ChevronRight } from 'lucide-react'
import styles from './tree.module.css'
import { STATE_LABEL, formatDay, type NodeState, type TicketInfo, type TreeModel, type TreeNode } from './tree-model'

type SortKey = 'ref' | 'state' | 'title' | 'assignee' | 'due' | 'blockers'

const STATE_RANK: Record<NodeState, number> = { crit: 0, soon: 1, prog: 2, todo: 3, done: 4 }

function refNumber(ref: string): number {
  const m = /(\d+)\s*$/.exec(ref)
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

function compare(a: TicketInfo, b: TicketInfo, key: SortKey): number {
  switch (key) {
    case 'ref':
      return a.ref.replace(/\d+$/, '').localeCompare(b.ref.replace(/\d+$/, '')) || refNumber(a.ref) - refNumber(b.ref)
    case 'state':
      return STATE_RANK[a.state] - STATE_RANK[b.state]
    case 'title':
      return a.title.localeCompare(b.title)
    case 'assignee':
      // Unassigned sorts last.
      if (!a.assignee || !b.assignee) return Number(!a.assignee) - Number(!b.assignee)
      return a.assignee.name.localeCompare(b.assignee.name)
    case 'due':
      return (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99')
    case 'blockers':
      return b.blockers.filter((x) => !x.done).length - a.blockers.filter((x) => !x.done).length
  }
}

interface TreeOutlineProps {
  model: TreeModel
  today: string
  selectedId: string | null
  closed: ReadonlySet<string>
  onToggle: (id: string) => void
  onSelect: (id: string) => void
}

const GRID =
  'grid grid-cols-[80px_60px_minmax(0,1fr)_60px] sm:grid-cols-[92px_72px_minmax(0,1fr)_120px_72px] xl:grid-cols-[96px_76px_minmax(0,1fr)_150px_80px_150px] items-center gap-x-3'

export function TreeOutline({ model, today, selectedId, closed, onToggle, onSelect }: TreeOutlineProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'ref', dir: 1 })

  const sorted = useMemo(() => {
    const map = new Map<string, TicketInfo[]>()
    for (const project of model.roots) {
      for (const group of project.children) {
        const rows = group.children.map((c) => model.tickets.get(c.id)!)
        rows.sort((a, b) => compare(a, b, sort.key) * sort.dir || compare(a, b, 'ref'))
        map.set(group.id, rows)
      }
    }
    return map
  }, [model, sort])

  const header = (key: SortKey, label: string, cls = '') => (
    <button
      type="button"
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}
      className={`flex items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wide transition-colors hover:text-foreground ${
        sort.key === key ? 'text-foreground' : 'text-muted-foreground'
      } ${cls}`}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      {sort.key === key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  )

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="min-w-0 px-4 pb-10 sm:px-8">
        <div className={`${GRID} sticky top-0 z-10 border-b border-border/60 bg-background/95 py-2.5 backdrop-blur`}>
          {header('state', 'State')}
          {header('ref', 'Ticket')}
          {header('title', 'Title')}
          {header('assignee', 'Assignee', 'hidden sm:flex')}
          {header('due', 'Due')}
          {header('blockers', 'Blocked by', 'hidden xl:flex')}
        </div>

        {model.roots.map((project) => (
          <section key={project.id} className="mt-5">
            <GroupHeading node={project} closed={closed.has(project.id)} onToggle={onToggle} level={0} />
            {!closed.has(project.id) &&
              project.children.map((group) => (
                <div key={group.id} className="mt-1">
                  <GroupHeading node={group} closed={closed.has(group.id)} onToggle={onToggle} level={1} />
                  {!closed.has(group.id) &&
                    sorted.get(group.id)!.map((info) => (
                      <Row
                        key={info.id}
                        info={info}
                        today={today}
                        selected={selectedId === info.id}
                        onPath={model.criticalPath.includes(info.id)}
                        onSelect={onSelect}
                      />
                    ))}
                </div>
              ))}
          </section>
        ))}
      </div>
    </div>
  )
}

function GroupHeading({ node, closed, onToggle, level }: { node: TreeNode; closed: boolean; onToggle: (id: string) => void; level: number }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(node.id)}
      aria-expanded={!closed}
      className={`flex w-full items-center gap-2 rounded-md py-1.5 text-left transition-colors hover:bg-secondary/40 ${
        level === 0 ? 'px-1 text-sm font-semibold text-foreground' : 'pl-5 pr-1 text-[13px] font-medium text-foreground/90'
      }`}
    >
      {closed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      {node.color && <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: node.color }} />}
      {level === 0 && node.sublabel && <span className="font-mono text-xs text-muted-foreground">{node.sublabel}</span>}
      <span className="truncate">{node.label}</span>
      <span className="ml-1 text-xs font-normal tabular-nums text-muted-foreground">
        {node.openCount} open / {node.ticketCount}
      </span>
      {node.alertCount > 0 && (
        <span className="rounded bg-red-500/15 px-1 text-[11px] font-semibold tabular-nums text-red-300">{node.alertCount} alerts</span>
      )}
    </button>
  )
}

function Row({
  info,
  today,
  selected,
  onPath,
  onSelect,
}: {
  info: TicketInfo
  today: string
  selected: boolean
  onPath: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(info.id)}
      className={`${GRID} w-full rounded-md border-l-2 py-2 pl-2 pr-1 text-left text-[13px] transition-colors hover:bg-secondary/40 ${
        selected ? 'bg-secondary/60' : ''
      } ${onPath ? 'border-l-red-400' : 'border-l-transparent'}`}
    >
      <span className={`w-fit rounded px-1.5 py-0.5 text-[11px] font-medium ${styles[`chip-${info.state}`]}`}>{STATE_LABEL[info.state]}</span>
      <span className="font-mono text-xs text-muted-foreground">{info.ref}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`truncate ${info.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{info.title}</span>
        {info.warnings.overdue && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" aria-label="Overdue" />}
        {info.warnings.blocked && <Ban className="h-3.5 w-3.5 shrink-0 text-orange-400" aria-label="Blocked" />}
      </span>
      <span className="hidden truncate text-xs text-muted-foreground sm:block">
        {info.assignee ? info.assignee.name : <span className={info.warnings.unassigned ? 'italic opacity-70' : ''}>No assignee</span>}
      </span>
      <span
        className={`text-xs tabular-nums ${
          info.warnings.overdue ? 'text-red-300' : info.state === 'soon' ? 'text-amber-300' : 'text-muted-foreground'
        }`}
      >
        {info.due ? formatDay(info.due, today) : <span className="italic opacity-60">None</span>}
      </span>
      <span className="hidden truncate font-mono text-xs xl:block">
        {info.blockers.map((b, i) => (
          <span key={b.id} className={b.done ? 'text-muted-foreground/60 line-through' : 'text-orange-300'}>
            {i > 0 ? ', ' : ''}
            {b.ref}
          </span>
        ))}
      </span>
    </button>
  )
}
