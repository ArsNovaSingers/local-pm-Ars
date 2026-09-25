'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, MessageSquare, Send } from 'lucide-react'

/**
 * Comments and change history for one ticket (LPM-7, LPM-3).
 *
 * Comments are credited server-side to the signed-in Team Member, so this component never
 * sends an author. History is read-only: it is written by the server on every change.
 */

interface Person { id: string; name?: string }
interface Comment { id: string; body: string; createdAt: string; author?: Person | string | null }
interface Change { field?: string; from?: string; to?: string }
interface ActivityRow {
  id: string
  action: 'created' | 'updated' | 'trashed' | 'restored'
  summary?: string
  createdAt: string
  actor?: Person | string | null
  changes?: Change[]
}

const nameOf = (p: Person | string | null | undefined) =>
  p && typeof p === 'object' ? p.name ?? 'Someone' : 'Someone'

function when(iso: string) {
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const FIELD_LABELS: Record<string, string> = {
  team: 'Assignee',
  dueDate: 'Due date',
  startDate: 'Start date',
  blockedBy: 'Blocked by',
}

export function TicketActivity({ ticketId }: { ticketId: string }) {
  const [tab, setTab] = useState<'comments' | 'history'>('comments')
  const [comments, setComments] = useState<Comment[]>([])
  const [history, setHistory] = useState<ActivityRow[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([
        fetch(`/api/comments?where[ticket][equals]=${ticketId}&depth=1&sort=createdAt&limit=200`).then((r) => r.json()),
        fetch(`/api/activity?where[ticket][equals]=${ticketId}&depth=1&sort=-createdAt&limit=100`).then((r) => r.json()),
      ])
      setComments(c.docs ?? [])
      setHistory(h.docs ?? [])
    } catch {
      setError('Could not load comments and history.')
    }
  }, [ticketId])

  useEffect(() => {
    load()
  }, [load])

  const send = async () => {
    const body = draft.trim()
    if (!body) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/comments?depth=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: ticketId, body }),
      })
      if (!res.ok) throw new Error(await res.text())
      setDraft('')
      await load()
    } catch {
      setError('Comment was not saved. Try again.')
    } finally {
      setSending(false)
    }
  }

  const tabClass = (t: typeof tab) =>
    `flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
      tab === t ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className="bg-card border border-border/40 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider mb-4">
        <button type="button" className={tabClass('comments')} onClick={() => setTab('comments')}>
          <MessageSquare className="w-3.5 h-3.5" />
          Comments{comments.length ? ` (${comments.length})` : ''}
        </button>
        <button type="button" className={tabClass('history')} onClick={() => setTab('history')}>
          <History className="w-3.5 h-3.5" />
          History
        </button>
      </div>

      {error && <p className="text-xs text-destructive mb-3">{error}</p>}

      {tab === 'comments' ? (
        <div className="space-y-3">
          {comments.length === 0 && (
            <p className="text-sm text-muted-foreground">No comments yet. Updates and questions go here, so the description stays the description.</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="bg-secondary/20 border border-border/30 rounded-lg p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span className="font-medium text-foreground">{nameOf(c.author)}</span>
                <span title={new Date(c.createdAt).toLocaleString()}>{when(c.createdAt)}</span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
          <div className="flex items-end gap-2 pt-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
              }}
              rows={2}
              placeholder="Add a comment (Ctrl+Enter to send)"
              className="flex-1 bg-secondary/20 border border-border/40 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={send}
              disabled={sending || !draft.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </div>
        </div>
      ) : (
        <ol className="space-y-3">
          {history.length === 0 && <li className="text-sm text-muted-foreground">No recorded changes yet. History starts from 2026-09-25.</li>}
          {history.map((a) => (
            <li key={a.id} className="text-sm border-l-2 border-border/50 pl-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">{nameOf(a.actor)}</span>{' '}
                  {a.action === 'created' ? 'created this ticket'
                    : a.action === 'trashed' ? 'moved it to the Trash'
                    : a.action === 'restored' ? 'restored it from the Trash'
                    : 'changed'}
                </span>
                <span title={new Date(a.createdAt).toLocaleString()}>{when(a.createdAt)}</span>
              </div>
              {(a.changes ?? []).length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {(a.changes ?? []).map((ch, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      <span className="text-foreground">{FIELD_LABELS[ch.field ?? ''] ?? ch.field}</span>
                      {ch.field === 'description' ? ' edited'
                        : ch.field === 'subtask' ? `: ${[ch.from, ch.to].filter(Boolean).join(' - ')}`
                        : <>: {ch.from || 'None'} <span aria-hidden>→</span> {ch.to || 'None'}</>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
