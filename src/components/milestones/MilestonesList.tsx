'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, Flag, Loader2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { Milestone, Project } from '@/payload-types'

/**
 * Milestones are deliberately domain-free: a concert, a product launch, a grant deadline
 * and a trade show are all just rows here. Nothing on this screen knows what kind of
 * organization is using it.
 */
interface MilestonesListProps {
  initialMilestones: Milestone[]
  projects: Project[]
  ticketCounts: Record<string, number>
}

const BLANK = { name: '', date: '', color: '#ef4444', description: '', project: '' }

function toDateInput(value: unknown): string {
  if (!value) return ''
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

function formatDate(value: unknown): string {
  if (!value) return 'No date'
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return 'No date'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function daysUntil(value: unknown): number | null {
  if (!value) return null
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

export function MilestonesList({ initialMilestones, projects, ticketCounts }: MilestonesListProps) {
  const [milestones, setMilestones] = useState<Milestone[]>(initialMilestones)
  const [isOpen, setIsOpen] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [form, setForm] = useState(BLANK)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Milestone | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const openCreate = () => {
    setEditing(null)
    setForm(BLANK)
    setError(null)
    setIsOpen(true)
  }

  const openEdit = (m: Milestone) => {
    setEditing(m)
    setForm({
      name: m.name,
      date: toDateInput(m.date),
      color: (m.color as string) || '#ef4444',
      description: (m.description as string) || '',
      project: m.project ? String(typeof m.project === 'object' ? m.project.id : m.project) : '',
    })
    setError(null)
    setIsOpen(true)
  }

  const save = async () => {
    if (!form.name.trim() || !form.date) {
      setError('A milestone needs a name and a date.')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const body = {
        name: form.name.trim(),
        date: form.date,
        color: form.color,
        description: form.description || null,
        project: form.project || null,
      }
      const response = await fetch(
        editing ? `/api/milestones/${editing.id}` : '/api/milestones',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data?.errors?.[0]?.message || 'Save failed')

      const saved: Milestone = data.doc || data
      setMilestones((prev) => {
        const next = editing ? prev.map((m) => (m.id === saved.id ? saved : m)) : [...prev, saved]
        return next.sort((a, b) => String(a.date).localeCompare(String(b.date)))
      })
      setIsOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await fetch(`/api/milestones/${deleteTarget.id}`, { method: 'DELETE' })
      setMilestones((prev) => prev.filter((m) => m.id !== deleteTarget.id))
      setDeleteTarget(null)
    } finally {
      setIsDeleting(false)
    }
  }

  const projectName = (m: Milestone) => {
    if (!m.project) return 'All projects'
    const id = String(typeof m.project === 'object' ? m.project.id : m.project)
    return projects.find((p) => String(p.id) === id)?.name || 'Unknown project'
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-8 py-5 border-b border-border/50 bg-background/50 backdrop-blur-sm">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Milestones</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Dated markers work is planned against. They appear as vertical lines on the timeline.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-primary-foreground text-sm font-semibold px-4 py-2 rounded-md shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="w-4 h-4 text-white" />
          New Milestone
        </button>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {milestones.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Flag className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm font-medium">No milestones yet</p>
            <p className="text-xs mt-1">Add the dates this work is aimed at.</p>
          </div>
        ) : (
          <ul className="space-y-2 max-w-3xl">
            {milestones.map((m) => {
              const days = daysUntil(m.date)
              const count = ticketCounts[String(m.id)] || 0
              return (
                <li
                  key={m.id}
                  className="group flex items-center gap-4 rounded-xl border border-border/40 bg-secondary/10 px-4 py-3"
                >
                  <div className="w-1.5 h-10 rounded-full shrink-0" style={{ backgroundColor: (m.color as string) || '#ef4444' }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">{m.name}</span>
                      {days !== null && days < 0 && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">past</span>
                      )}
                      {days !== null && days >= 0 && days <= 14 && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                          {days === 0 ? 'today' : `in ${days}d`}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(m.date)} · {projectName(m)} · {count} ticket{count === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEdit(m)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(m)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-secondary transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-border/50 bg-card p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              {editing ? 'Edit Milestone' : 'New Milestone'}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-secondary/50 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Spring launch"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Date</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full bg-secondary/50 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Color</label>
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    className="h-[38px] w-14 bg-secondary/50 border border-border/50 rounded-md cursor-pointer"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Project</label>
                <select
                  value={form.project}
                  onChange={(e) => setForm({ ...form, project: e.target.value })}
                  className="w-full bg-secondary/50 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">All projects</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full bg-secondary/50 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>
            </div>

            {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setIsOpen(false)}
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={isSaving}
                className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-primary-foreground text-sm font-semibold px-4 py-2 rounded-md disabled:opacity-50 transition-all"
              >
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {editing ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete milestone"
        message={
          deleteTarget
            ? `Delete "${deleteTarget.name}"? ${ticketCounts[String(deleteTarget.id)] || 0} ticket(s) point at it; they will keep their dates but lose the marker.`
            : ''
        }
        confirmText="Delete"
        isDestructive
        isLoading={isDeleting}
      />
    </div>
  )
}
