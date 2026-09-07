'use client'

import { useState, useEffect } from 'react'
import { X, Plus, Trash2, CheckSquare, Square, Ban, Calendar, CalendarClock, Flag, Tag, Users, FolderKanban, Minimize2 } from 'lucide-react'
import { TicketPriority, TICKET_PRIORITY_OPTIONS } from '@/types/enums'
import { defaultStatusKey, fallbackStatuses, type BoardStatus } from './status-utils'
import { RichTextEditor } from '@/components/ui/RichTextEditor'
import type { Milestone, Project, Team, Ticket } from '@/payload-types'

interface TicketModalProps {
  isOpen: boolean
  onClose: () => void
  ticket: Ticket | null
  projects: Project[]
  /** Team Members — people. The Payload slug stays `teams` on purpose. */
  teams: Team[]
  /** Workflow states from the `statuses` collection. Never a fixed list. */
  statuses?: BoardStatus[]
  milestones?: Milestone[]
  allTickets: Ticket[]
  onSave: (ticket: Ticket) => void
  defaultProjectId?: string | null
}

interface Label {
  name: string
  color: string
}

/** Payload stores dates as ISO strings; <input type="date"> wants YYYY-MM-DD. */
function toDateInput(value: string | null | undefined): string {
  if (!value) return ''
  return String(value).slice(0, 10)
}

interface Subtask {
  title: string
  completed: boolean
}

export function TicketModal({
  isOpen,
  onClose,
  ticket,
  projects,
  teams,
  statuses,
  milestones = [],
  allTickets,
  onSave,
  defaultProjectId,
}: TicketModalProps) {
  // An un-seeded workspace still needs a usable Status picker.
  const statusOptions = statuses?.length ? statuses : fallbackStatuses()
  const initialStatus = defaultStatusKey(statusOptions)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<string>(initialStatus)
  const [priority, setPriority] = useState<TicketPriority>(TicketPriority.NO_PRIORITY)
  const [projectId, setProjectId] = useState('')
  const [teamId, setTeamId] = useState('')
  const [milestoneId, setMilestoneId] = useState('')
  const [labels, setLabels] = useState<Label[]>([])
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [blockedByIds, setBlockedByIds] = useState<string[]>([])
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelColor, setNewLabelColor] = useState('#6366f1')
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [isFullScreen, setIsFullScreen] = useState(true)

  useEffect(() => {
    if (ticket) {
      setTitle(ticket.title)
      setDescription(ticket.description as unknown as string || '')
      setStatus(String(ticket.status))
      setPriority(ticket.priority as TicketPriority || TicketPriority.NO_PRIORITY)
      setProjectId(typeof ticket.project === 'string' ? ticket.project : ticket.project?.id || '')
      setTeamId(typeof ticket.team === 'string' ? ticket.team : ticket.team?.id || '')
      setMilestoneId(
        typeof ticket.milestone === 'string' ? ticket.milestone : ticket.milestone?.id || ''
      )
      setLabels((ticket.labels || []).map(l => ({ name: l.name, color: l.color ?? '#6366f1' })))
      setSubtasks((ticket.subtasks || []).map(st => ({ title: st.title, completed: st.completed ?? false })))
      setBlockedByIds((ticket.blockedBy || []).map(t => typeof t === 'string' ? t : t.id))
      setStartDate(toDateInput(ticket.startDate))
      setDueDate(toDateInput(ticket.dueDate))
    } else {
      setTitle('')
      setDescription('')
      setStatus(initialStatus)
      setPriority(TicketPriority.NO_PRIORITY)
      setProjectId(defaultProjectId || '')
      setTeamId('')
      setMilestoneId('')
      setLabels([])
      setSubtasks([])
      setBlockedByIds([])
      setStartDate('')
      setDueDate('')
    }
    setIsFullScreen(true)
  }, [ticket, defaultProjectId, isOpen, initialStatus])

  /**
   * Inactive people keep their history but must not be assignable. The person already on
   * this ticket stays in the list, or editing anything else would silently unassign them.
   */
  const assignableMembers = (teams || []).filter(
    (member) => member.active !== false || member.id === teamId
  )

  const availableTickets = (allTickets || []).filter(t =>
    (!ticket || t.id !== ticket.id) && !blockedByIds.includes(t.id)
  )

  const addBlocker = (ticketId: string) => {
    if (!blockedByIds.includes(ticketId)) {
      setBlockedByIds([...blockedByIds, ticketId])
    }
  }

  const removeBlocker = (ticketId: string) => {
    setBlockedByIds(blockedByIds.filter(id => id !== ticketId))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !projectId) return

    setIsSubmitting(true)

    try {
      const payload = {
        title: title.trim(),
        description: description || null,
        status,
        priority,
        project: projectId,
        team: teamId || null,
        milestone: milestoneId || null,
        labels,
        subtasks,
        blockedBy: blockedByIds,
        startDate: startDate || null,
        dueDate: dueDate || null,
      }

      const url = ticket ? `/api/tickets/${ticket.id}` : '/api/tickets'
      const method = ticket ? 'PATCH' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error('Failed to save ticket')
      }

      const savedTicket = await response.json()
      onSave(savedTicket.doc || savedTicket)
    } catch (error) {
      console.error('Failed to save ticket:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const addLabel = () => {
    if (newLabelName.trim()) {
      setLabels([...labels, { name: newLabelName.trim(), color: newLabelColor }])
      setNewLabelName('')
      setNewLabelColor('#6366f1')
    }
  }

  const removeLabel = (index: number) => {
    setLabels(labels.filter((_, i) => i !== index))
  }

  const addSubtask = () => {
    if (newSubtaskTitle.trim()) {
      setSubtasks([...subtasks, { title: newSubtaskTitle.trim(), completed: false }])
      setNewSubtaskTitle('')
    }
  }

  const toggleSubtask = (index: number) => {
    setSubtasks(subtasks.map((st, i) =>
      i === index ? { ...st, completed: !st.completed } : st
    ))
  }

  const removeSubtask = (index: number) => {
    setSubtasks(subtasks.filter((_, i) => i !== index))
  }

  if (!isOpen) return null

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 ${isFullScreen ? '' : 'p-4 sm:p-6'}`}>
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className={`relative flex flex-col bg-card shadow-2xl overflow-hidden transition-all duration-300 ${
          isFullScreen
            ? 'w-full h-full max-w-none rounded-none'
            : 'w-full max-w-4xl mx-auto max-h-[90vh] rounded-xl border border-border/50'
        }`}
      >
        {/* Header */}
        <div className="flex-none flex items-center justify-between px-6 py-3 border-b border-border/30">
          <span className="text-sm text-muted-foreground">
            {ticket ? 'Edit Ticket' : 'New Ticket'}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-md transition-colors"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <form id="ticket-form" onSubmit={handleSubmit} className={`${isFullScreen ? 'max-w-5xl mx-auto' : ''}`}>
            <div className={`flex ${isFullScreen ? 'gap-0' : 'flex-col'}`}>
              {/* Main Content */}
              <div className={`flex-1 p-8 ${isFullScreen ? 'pr-0' : ''}`}>
                {/* Title */}
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Untitled"
                  className="w-full bg-transparent text-3xl font-bold text-foreground placeholder:text-muted-foreground/40 border-none px-0 py-2 focus:ring-0 focus:outline-none"
                  autoFocus
                  required
                />

                {/* Description */}
                <div className="mt-6">
                  <RichTextEditor
                    value={description}
                    onChange={setDescription}
                    placeholder="Add a description..."
                  />
                </div>

                {/* Subtasks */}
                <div className="mt-8">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-muted-foreground">Subtasks</span>
                    {subtasks.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {subtasks.filter(t => t.completed).length}/{subtasks.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {subtasks.map((subtask, index) => (
                      <div
                        key={index}
                        className="group flex items-center gap-3 py-1.5 hover:bg-secondary/30 rounded-md px-2 -mx-2 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => toggleSubtask(index)}
                          className={`flex-none transition-colors ${subtask.completed ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                          {subtask.completed ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                        </button>
                        <span className={`flex-1 text-sm ${subtask.completed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                          {subtask.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeSubtask(index)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 mt-2">
                    <Plus className="w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={newSubtaskTitle}
                      onChange={(e) => setNewSubtaskTitle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSubtask())}
                      placeholder="Add a subtask..."
                      className="flex-1 bg-transparent border-none py-1 text-sm text-foreground placeholder-muted-foreground/50 focus:ring-0 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Sidebar */}
              <div className={`${isFullScreen ? 'w-80 border-l border-border/30 p-6 bg-secondary/10' : 'p-8 pt-0'}`}>
                <div className="space-y-5">
                  {/* Project */}
                  <div>
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                      <FolderKanban className="w-3.5 h-3.5" />
                      Project
                    </label>
                    <select
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      className="w-full bg-transparent border-none text-sm text-foreground focus:ring-0 p-0 cursor-pointer hover:text-primary transition-colors"
                      required
                    >
                      <option value="" className="bg-card">Select project</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id} className="bg-card">
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Status */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">Status</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="w-full bg-transparent border-none text-sm text-foreground focus:ring-0 p-0 cursor-pointer hover:text-primary transition-colors"
                    >
                      {statusOptions.map((option) => (
                        <option key={option.key} value={option.key} className="bg-card">
                          {option.label}
                        </option>
                      ))}
                      {/* Keep an orphaned status visible rather than silently rewriting it. */}
                      {status && !statusOptions.some((o) => o.key === status) && (
                        <option value={status} className="bg-card">
                          {status} (unknown status)
                        </option>
                      )}
                    </select>
                  </div>

                  {/* Priority */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">Priority</label>
                    <select
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as TicketPriority)}
                      className="w-full bg-transparent border-none text-sm text-foreground focus:ring-0 p-0 cursor-pointer hover:text-primary transition-colors"
                    >
                      {TICKET_PRIORITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value} className="bg-card">
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Assignee */}
                  <div>
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                      <Users className="w-3.5 h-3.5" />
                      Assignee
                    </label>
                    <select
                      value={teamId}
                      onChange={(e) => setTeamId(e.target.value)}
                      className="w-full bg-transparent border-none text-sm text-foreground focus:ring-0 p-0 cursor-pointer hover:text-primary transition-colors"
                    >
                      <option value="" className="bg-card">Unassigned</option>
                      {assignableMembers.map((member) => (
                        <option key={member.id} value={member.id} className="bg-card">
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Milestone */}
                  <div>
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                      <Flag className="w-3.5 h-3.5" />
                      Milestone
                    </label>
                    <select
                      value={milestoneId}
                      onChange={(e) => setMilestoneId(e.target.value)}
                      className="w-full bg-transparent border-none text-sm text-foreground focus:ring-0 p-0 cursor-pointer hover:text-primary transition-colors"
                    >
                      <option value="" className="bg-card">No milestone</option>
                      {milestones.map((milestone) => (
                        <option key={milestone.id} value={milestone.id} className="bg-card">
                          {milestone.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Start Date */}
                  <div>
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                      <CalendarClock className="w-3.5 h-3.5" />
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full bg-transparent border-none text-sm text-foreground focus:ring-0 p-0 cursor-pointer"
                    />
                  </div>

                  {/* Due Date */}
                  <div>
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                      <Calendar className="w-3.5 h-3.5" />
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full bg-transparent border-none text-sm text-foreground focus:ring-0 p-0 cursor-pointer"
                    />
                  </div>

                  {/* Labels */}
                  <div>
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                      <Tag className="w-3.5 h-3.5" />
                      Labels
                    </label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {labels.map((label, index) => (
                        <span
                          key={index}
                          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: `${label.color}20`,
                            color: label.color,
                          }}
                        >
                          {label.name}
                          <button type="button" onClick={() => removeLabel(index)} className="hover:opacity-70">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={newLabelName}
                        onChange={(e) => setNewLabelName(e.target.value)}
                        placeholder="New label"
                        className="flex-1 bg-secondary/50 border-none rounded px-2 py-1 text-xs text-foreground focus:ring-1 focus:ring-primary/30"
                      />
                      <input
                        type="color"
                        value={newLabelColor}
                        onChange={(e) => setNewLabelColor(e.target.value)}
                        className="w-7 h-7 p-0.5 bg-secondary/50 rounded cursor-pointer"
                      />
                      <button
                        type="button"
                        onClick={addLabel}
                        disabled={!newLabelName.trim()}
                        className="p-1.5 bg-secondary/50 text-muted-foreground hover:text-foreground rounded disabled:opacity-50 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Blocked By */}
                  <div>
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                      <Ban className="w-3.5 h-3.5" />
                      Blocked By
                    </label>
                    <div className="space-y-1.5 mb-2">
                      {blockedByIds.map((blockerId) => {
                        const blocker = (allTickets || []).find(t => t.id === blockerId)
                        if (!blocker) return null
                        return (
                          <div key={blockerId} className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">{blocker.ticketId}</span>
                            <span className="flex-1 truncate text-foreground">{blocker.title}</span>
                            <button type="button" onClick={() => removeBlocker(blockerId)} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                    {availableTickets.length > 0 && (
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            addBlocker(e.target.value)
                            e.target.value = ''
                          }
                        }}
                        className="w-full bg-secondary/50 border-none rounded px-2 py-1.5 text-xs text-muted-foreground focus:ring-1 focus:ring-primary/30 cursor-pointer"
                        defaultValue=""
                      >
                        <option value="">Add blocker...</option>
                        {availableTickets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.ticketId} - {t.title}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex-none flex justify-end gap-3 px-6 py-4 border-t border-border/30">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="ticket-form"
            disabled={isSubmitting || !title.trim() || !projectId}
            className="px-5 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-md transition-all disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : ticket ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
