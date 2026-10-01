'use client'

import { useMemo, useState } from 'react'
import { CalendarClock, Crosshair, ExternalLink, Route, X } from 'lucide-react'
import { formatDay } from '@/components/tree/tree-model'
import styles from './network.module.css'
import { TicketPicker } from './TicketPicker'
import { NET_STATE_LABEL, cyclePath, edgeKey, type Graph, type NetEdge, type NetNode } from './network-model'

interface NetworkDetailPanelProps {
  node: NetNode
  graph: Graph
  today: string
  /** Every in-scope ticket, for the add-dependency search. */
  candidates: NetNode[]
  pathIndex: number
  pathLength: number
  conflicts: string[] | null
  busy: boolean
  onClose: () => void
  onSelect: (id: string) => void
  onFocus: (id: string) => void
  onOpenFull: () => void
  /** blocker → blocked */
  onLink: (blockerId: string, blockedId: string) => void
  onRemove: (edge: NetEdge) => void
}

type AddMode = 'blockedBy' | 'blocks'

export function NetworkDetailPanel({
  node,
  graph,
  today,
  candidates,
  pathIndex,
  pathLength,
  conflicts,
  busy,
  onClose,
  onSelect,
  onFocus,
  onOpenFull,
  onLink,
  onRemove,
}: NetworkDetailPanelProps) {
  const { info } = node
  const [mode, setMode] = useState<AddMode>('blockedBy')
  const blockers = graph.blockersOf.get(node.id) ?? []
  const blocks = graph.blocksOf.get(node.id) ?? []
  const outOfScope = info.blockers.filter((b) => !graph.nodes.has(b.id))

  const pickable = useMemo(() => {
    const existing = new Set(mode === 'blockedBy' ? blockers : blocks)
    return candidates.filter((c) => c.id !== node.id && !existing.has(c.id))
  }, [candidates, mode, blockers, blocks, node.id])

  const annotate = (id: string) => {
    const loop = mode === 'blockedBy' ? cyclePath(graph, node.id, id) : cyclePath(graph, id, node.id)
    return loop ? 'would loop' : null
  }

  return (
    <aside
      role="dialog"
      aria-label={`${info.ref} dependencies`}
      data-no-pan
      className={`${styles.panel} fixed inset-x-0 bottom-0 z-40 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-border bg-card shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-0 sm:max-h-none sm:w-[400px] sm:rounded-none sm:border-l sm:border-t-0`}
    >
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border sm:hidden" />
      <header className="flex items-start gap-3 border-b border-border/60 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{info.ref}</span>
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${styles[`chip-${node.state}`]}`}>
              {node.state === 'blocked' ? `Blocked by ${node.openBlockers}` : NET_STATE_LABEL[node.state]}
            </span>
            {pathIndex >= 0 && (
              <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">
                <Route className="h-3 w-3" /> Critical path {pathIndex + 1}/{pathLength}
              </span>
            )}
          </div>
          <h2 className={`mt-1 text-base font-semibold leading-snug ${info.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{info.title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="flex items-center gap-1.5 text-foreground">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: info.statusColor }} />
            {info.statusLabel}
          </dd>
          <dt className="text-muted-foreground">Assignee</dt>
          <dd className="text-foreground">{info.assignee?.name ?? <span className="text-muted-foreground">None</span>}</dd>
          <dt className="text-muted-foreground">Due</dt>
          <dd className="text-foreground">{info.due ? formatDay(info.due, today) : <span className="text-muted-foreground">None</span>}</dd>
          <dt className="text-muted-foreground">Group</dt>
          <dd className="truncate text-foreground">{info.groupLabel}</dd>
        </dl>

        {node.statusSaysBlocked && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            The status says Blocked, but no open blocker is recorded. Add it below so the network can show what this waits on.
          </p>
        )}

        {conflicts && conflicts.length > 0 && (
          <div className="space-y-1 rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-200">
            <div className="flex items-center gap-1 font-semibold">
              <CalendarClock className="h-3.5 w-3.5" /> Date conflict
            </div>
            {conflicts.map((c) => (
              <p key={c}>{c}</p>
            ))}
          </div>
        )}

        <Section title={`Blocked by (${blockers.length + outOfScope.length})`}>
          {blockers.length + outOfScope.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded. {info.done ? '' : 'This ticket can start.'}</p>
          ) : (
            <ul className="space-y-0.5">
              {blockers.map((id) => (
                <DepRow
                  key={id}
                  node={graph.nodes.get(id)!}
                  onSelect={onSelect}
                  onRemove={() => onRemove(graph.edgeByKey.get(edgeKey(id, node.id))!)}
                  busy={busy}
                />
              ))}
              {outOfScope.map((b) => (
                <li key={b.id} className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                  <span className="font-mono text-xs">{b.ref}</span>
                  <span className="min-w-0 flex-1 truncate">{b.title}</span>
                  <span className="text-[11px]">outside filter</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`Blocks (${blocks.length})`}>
          {blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waits on this ticket.</p>
          ) : (
            <ul className="space-y-0.5">
              {blocks.map((id) => (
                <DepRow
                  key={id}
                  node={graph.nodes.get(id)!}
                  onSelect={onSelect}
                  onRemove={() => onRemove(graph.edgeByKey.get(edgeKey(node.id, id))!)}
                  busy={busy}
                />
              ))}
            </ul>
          )}
        </Section>

        <Section title="Add dependency">
          <div className="mb-2 inline-flex rounded-md border border-border/60 bg-secondary/40 p-0.5 text-xs" role="tablist">
            {(
              [
                ['blockedBy', `${info.ref} is blocked by`],
                ['blocks', `${info.ref} blocks`],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`rounded px-2 py-1 font-medium ${mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <TicketPicker
            key={mode}
            candidates={pickable}
            ariaLabel={mode === 'blockedBy' ? 'Add blocker' : 'Add ticket this blocks'}
            placeholder={mode === 'blockedBy' ? 'Add blocker: type a key or title, Enter' : 'Add blocked ticket: key or title, Enter'}
            annotate={annotate}
            onPick={(id) => (mode === 'blockedBy' ? onLink(id, node.id) : onLink(node.id, id))}
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {mode === 'blockedBy'
              ? `The ticket you pick must finish before ${info.ref} can start.`
              : `${info.ref} must finish before the ticket you pick can start.`}
          </p>
        </Section>
      </div>

      <footer className="flex gap-2 border-t border-border/60 px-5 py-3">
        <button
          type="button"
          onClick={() => onFocus(node.id)}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <Crosshair className="h-4 w-4" />
          Focus
        </button>
        <button
          type="button"
          onClick={onOpenFull}
          className="flex flex-[2] items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-[var(--primary-hover)]"
        >
          <ExternalLink className="h-4 w-4" />
          Open full ticket
        </button>
      </footer>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function DepRow({ node, onSelect, onRemove, busy }: { node: NetNode; onSelect: (id: string) => void; onRemove: () => void; busy: boolean }) {
  return (
    <li className="group flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary/60"
      >
        <span className="font-mono text-xs text-muted-foreground">{node.info.ref}</span>
        <span className={`min-w-0 flex-1 truncate ${node.state === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{node.info.title}</span>
        <span className={`shrink-0 rounded px-1 text-[10px] font-medium ${styles[`chip-${node.state}`]}`}>{NET_STATE_LABEL[node.state]}</span>
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onRemove}
        aria-label={`Remove dependency on ${node.info.ref}`}
        title="Remove this dependency"
        className="rounded p-1 text-muted-foreground opacity-60 transition-colors hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100 disabled:opacity-30"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}
