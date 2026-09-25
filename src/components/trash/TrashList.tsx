'use client'

import { useCallback, useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { restoreFromTrash } from '@/lib/client-trash'

/**
 * Everything moved to the Trash in the last 30 days, with who moved it and a Restore button.
 * Restoring a project also restores the tickets that were trashed together with it (they
 * share its timestamp).
 */

type Kind = 'tickets' | 'projects' | 'milestones'
interface Row {
  id: string
  kind: Kind
  label: string
  sub?: string
  deletedAt: string
  deletedBy?: string
}

type ApiDoc = {
  id: string
  ticketId?: string
  title?: string
  name?: string
  prefix?: string
  deletedAt: string
  project?: { name?: string } | string | null
  updatedBy?: { name?: string } | string | null
}

const KIND_LABEL: Record<Kind, string> = { tickets: 'Ticket', projects: 'Project', milestones: 'Milestone' }
const nameOf = (v: ApiDoc['project']) => (v && typeof v === 'object' ? v.name : undefined)
const withinAMinute = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= 60_000

async function fetchTrash(kind: Kind): Promise<Row[]> {
  const r = await fetch(`/api/${kind}?trash=true&where[deletedAt][exists]=true&sort=-deletedAt&limit=500&depth=1`)
  const data = (await r.json()) as { docs?: ApiDoc[] }
  return (data.docs ?? []).map((d) => ({
    id: d.id,
    kind,
    label: kind === 'tickets' ? `${d.ticketId ?? ''} ${d.title ?? ''}`.trim() : d.name ?? d.id,
    sub: kind === 'tickets' ? nameOf(d.project) : kind === 'projects' ? d.prefix : undefined,
    deletedAt: d.deletedAt,
    deletedBy: nameOf(d.updatedBy),
  }))
}

export function TrashList() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const all = (await Promise.all((['tickets', 'projects', 'milestones'] as Kind[]).map(fetchTrash))).flat()
    all.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
    setRows(all)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const restore = async (row: Row) => {
    setBusy(row.id)
    setMessage(null)
    try {
      await restoreFromTrash(row.kind, row.id)
      let extra = ''
      if (row.kind === 'projects') {
        const r = await fetch(
          `/api/tickets?trash=true&where[deletedAt][exists]=true&where[project][equals]=${row.id}&limit=1000&depth=0`,
        )
        const docs = ((await r.json()) as { docs?: ApiDoc[] }).docs ?? []
        const together = docs.filter((d) => withinAMinute(d.deletedAt, row.deletedAt))
        await Promise.all(together.map((d) => restoreFromTrash('tickets', d.id)))
        extra = together.length ? ` and ${together.length} ticket${together.length === 1 ? '' : 's'}` : ''
      }
      setMessage(`Restored ${KIND_LABEL[row.kind].toLowerCase()} "${row.label}"${extra}.`)
      await load()
    } catch {
      setMessage('Restore failed. Try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-2 mb-1">
        <Trash2 className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold text-foreground">Trash</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Deleted tickets, projects and milestones stay here for 30 days and can be restored. Nothing is removed for good before then.
      </p>

      {message && (
        <div className="mb-4 text-sm text-foreground bg-secondary/40 border border-border/40 rounded-lg px-3 py-2">{message}</div>
      )}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">The Trash is empty.</p>
      ) : (
        <div className="border border-border/40 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2">Item</th>
                <th className="text-left font-medium px-4 py-2 hidden sm:table-cell">Deleted by</th>
                <th className="text-left font-medium px-4 py-2 hidden sm:table-cell">When</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.kind}:${row.id}`} className="border-t border-border/30">
                  <td className="px-4 py-2.5">
                    <div className="text-foreground">{row.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {KIND_LABEL[row.kind]}
                      {row.sub ? ` · ${row.sub}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">{row.deletedBy ?? 'Unknown'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                    {new Date(row.deletedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => restore(row)}
                      disabled={busy === row.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary hover:bg-secondary/70 text-foreground text-xs font-medium disabled:opacity-40"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
