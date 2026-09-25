'use client'

import { AlertTriangle, Ban, CheckSquare, ExternalLink, Square, X } from 'lucide-react'
import { RichTextDisplay } from '@/components/ui/RichTextEditor'
import styles from './tree.module.css'
import { STATE_LABEL, formatDay, type TicketInfo, type TreeModel } from './tree-model'

interface TreeDetailPanelProps {
  info: TicketInfo
  model: TreeModel
  today: string
  onClose: () => void
  onSelect: (id: string) => void
  onOpenFull: () => void
}

const PRIORITY_LABEL: Record<string, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  NO_PRIORITY: 'No priority',
}

/** Lexical JSON (older records) or an HTML string (the editor this app ships). */
function Description({ value }: { value: unknown }) {
  if (!value) return <p className="text-sm italic text-muted-foreground">No description.</p>
  if (typeof value === 'string')
    return (
      <div className="text-sm leading-relaxed text-foreground/90 [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:list-disc">
        <RichTextDisplay content={value} />
      </div>
    )
  const texts: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as { text?: unknown; children?: unknown[]; type?: string }
    if (typeof node.text === 'string') texts.push(node.text)
    if (Array.isArray(node.children)) {
      node.children.forEach(walk)
      if (node.type === 'paragraph') texts.push('\n')
    }
  }
  walk((value as { root?: unknown }).root)
  const text = texts.join('').trim()
  return text ? (
    <p className="whitespace-pre-wrap text-sm text-foreground/90">{text}</p>
  ) : (
    <p className="text-sm italic text-muted-foreground">No description.</p>
  )
}

export function TreeDetailPanel({ info, model, today, onClose, onSelect, onOpenFull }: TreeDetailPanelProps) {
  const subtasks = info.raw.subtasks ?? []
  const doneSubtasks = subtasks.filter((s) => s.completed).length
  const onPath = model.criticalPath.indexOf(info.id)
  const w = info.warnings

  return (
    <aside
      role="dialog"
      aria-label={`${info.ref} details`}
      data-no-pan
      className={`${styles.panel} fixed inset-x-0 bottom-0 z-40 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-border bg-card shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-0 sm:max-h-none sm:w-[400px] sm:rounded-none sm:border-l sm:border-t-0`}
    >
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border sm:hidden" />
      <header className="flex items-start gap-3 border-b border-border/60 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{info.ref}</span>
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${styles[`chip-${info.state}`]}`}>{STATE_LABEL[info.state]}</span>
          </div>
          <h2 className={`mt-1 text-base font-semibold leading-snug ${info.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
            {info.title}
          </h2>
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
        {(w.overdue || w.blocked || w.unassigned || w.noDue || onPath >= 0) && (
          <div className="flex flex-wrap gap-1.5">
            {w.overdue && (
              <Badge tone="red">
                <AlertTriangle className="h-3 w-3" /> Overdue
              </Badge>
            )}
            {w.blocked && (
              <Badge tone="orange">
                <Ban className="h-3 w-3" /> Blocked
              </Badge>
            )}
            {onPath >= 0 && (
              <Badge tone="red">
                Critical path, step {onPath + 1} of {model.criticalPath.length}
              </Badge>
            )}
            {w.unassigned && <Badge tone="muted">No assignee</Badge>}
            {w.noDue && <Badge tone="muted">No due date</Badge>}
          </div>
        )}

        <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="flex items-center gap-1.5 text-foreground">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: info.statusColor }} />
            {info.statusLabel}
          </dd>
          <dt className="text-muted-foreground">Priority</dt>
          <dd className="text-foreground">{PRIORITY_LABEL[info.priority] ?? info.priority}</dd>
          <dt className="text-muted-foreground">Assignee</dt>
          <dd className="text-foreground">{info.assignee?.name ?? <span className="text-muted-foreground">None</span>}</dd>
          <dt className="text-muted-foreground">Due</dt>
          <dd className={w.overdue ? 'text-red-300' : info.state === 'soon' ? 'text-amber-300' : 'text-foreground'}>
            {info.due ? formatDay(info.due, today) : <span className="text-muted-foreground">None</span>}
          </dd>
          <dt className="text-muted-foreground">Group</dt>
          <dd className="truncate text-foreground">{info.groupLabel}</dd>
          {info.labels.length > 0 && (
            <>
              <dt className="text-muted-foreground">Labels</dt>
              <dd className="flex flex-wrap gap-1">
                {info.labels.map((l) => (
                  <span
                    key={l.name}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: `${l.color}26`, color: l.color }}
                  >
                    {l.name}
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>

        <Section title={`Blocked by (${info.blockers.length})`}>
          {info.blockers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing. This ticket can start.</p>
          ) : (
            <TicketLinks
              items={info.blockers.map((b) => ({ id: b.id, ref: b.ref, title: b.title, done: b.done, inScope: b.inScope }))}
              onSelect={onSelect}
            />
          )}
        </Section>

        {info.blocks.length > 0 && (
          <Section title={`Blocks (${info.blocks.length})`}>
            <TicketLinks
              items={info.blocks.map((id) => {
                const t = model.tickets.get(id)!
                return { id, ref: t.ref, title: t.title, done: t.done, inScope: true }
              })}
              onSelect={onSelect}
            />
          </Section>
        )}

        {subtasks.length > 0 && (
          <Section title={`Subtasks (${doneSubtasks}/${subtasks.length})`}>
            <ul className="space-y-1">
              {subtasks.map((s, i) => (
                <li key={s.id ?? i} className="flex items-start gap-2 text-sm">
                  {s.completed ? (
                    <CheckSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-400" />
                  ) : (
                    <Square className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className={s.completed ? 'text-muted-foreground line-through' : 'text-foreground'}>{s.title}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Description">
          <Description value={info.raw.description} />
        </Section>
      </div>

      <footer className="border-t border-border/60 px-5 py-3">
        <button
          type="button"
          onClick={onOpenFull}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-[var(--primary-hover)]"
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

function Badge({ tone, children }: { tone: 'red' | 'orange' | 'muted'; children: React.ReactNode }) {
  const cls =
    tone === 'red'
      ? 'bg-red-500/15 text-red-300'
      : tone === 'orange'
        ? 'bg-orange-500/15 text-orange-300'
        : 'bg-secondary text-muted-foreground'
  return <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>
}

function TicketLinks({
  items,
  onSelect,
}: {
  items: { id: string; ref: string; title: string; done: boolean; inScope: boolean }[]
  onSelect: (id: string) => void
}) {
  return (
    <ul className="space-y-1">
      {items.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            disabled={!t.inScope}
            onClick={() => onSelect(t.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary/60 disabled:cursor-default disabled:hover:bg-transparent"
          >
            <span className="font-mono text-xs text-muted-foreground">{t.ref}</span>
            <span className={`min-w-0 flex-1 truncate ${t.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{t.title}</span>
            {t.done ? (
              <span className="text-[11px] text-muted-foreground">done</span>
            ) : !t.inScope ? (
              <span className="text-[11px] text-muted-foreground">outside filter</span>
            ) : (
              <span className="text-[11px] text-orange-300">open</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
