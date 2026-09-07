'use client'

import { useState } from 'react'
import {
  X,
  Pencil,
  Save,
  Trash2,
  Calendar,
  Flag,
  Users,
  FolderKanban,
  Clock,
  Tag,
  Plus,
  FileText,
  CheckSquare,
  Square,
  Ban,
  GitBranch,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import {
  TicketPriority,
  TICKET_PRIORITY_OPTIONS,
  PRIORITY_COLORS,
} from '@/types/enums'
import {
  fallbackStatuses,
  isDoneStatus,
  statusColor,
  statusLabel,
  type BoardStatus,
} from './status-utils'
import { RichTextEditor, RichTextDisplay } from '@/components/ui/RichTextEditor'
import { DependencyGraph } from './DependencyGraph'
import type { Milestone, Project, Team, Ticket } from '@/payload-types'

interface Subtask {
  title: string
  completed: boolean
}

/** Payload stores dates as ISO strings; <input type="date"> wants YYYY-MM-DD. */
function toDateInput(value: string | null | undefined): string {
  if (!value) return ''
  return String(value).slice(0, 10)
}

interface TicketDetailModalProps {
  isOpen: boolean
  onClose: () => void
  ticket: Ticket
  projects: Project[]
  /** Team Members — people. The Payload slug stays `teams` on purpose. */
  teams: Team[]
  /** Workflow states from the `statuses` collection. Never a fixed list. */
  statuses?: BoardStatus[]
  milestones?: Milestone[]
  allTickets: Ticket[]
  onUpdate: (ticket: Ticket) => void
  onDelete: (ticketId: string) => void
}

export function TicketDetailModal({
  isOpen,
  onClose,
  ticket,
  projects,
  teams,
  statuses,
  milestones = [],
  allTickets,
  onUpdate,
  onDelete,
}: TicketDetailModalProps) {
  // A workspace whose statuses are not seeded yet still needs a usable Status picker.
  const statusOptions = statuses?.length ? statuses : fallbackStatuses()
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)

  // Form state
  const [title, setTitle] = useState(ticket.title)
  const [description, setDescription] = useState(ticket.description as unknown as string || '')
  const [status, setStatus] = useState<string>(String(ticket.status))
  const [priority, setPriority] = useState(ticket.priority || TicketPriority.NO_PRIORITY)
  const [teamId, setTeamId] = useState(typeof ticket.team === 'string' ? ticket.team : ticket.team?.id || '')
  const [milestoneId, setMilestoneId] = useState(
    typeof ticket.milestone === 'string' ? ticket.milestone : ticket.milestone?.id || ''
  )
  const [startDate, setStartDate] = useState(toDateInput(ticket.startDate))
  const [dueDate, setDueDate] = useState(toDateInput(ticket.dueDate))
  const [labels, setLabels] = useState(ticket.labels || [])
  const [subtasks, setSubtasks] = useState<Subtask[]>(
    (ticket.subtasks || []).map(st => ({ title: st.title, completed: st.completed ?? false }))
  )
  const [blockedByIds, setBlockedByIds] = useState<string[]>(
    (ticket.blockedBy || []).map(t => typeof t === 'string' ? t : t.id)
  )
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelColor, setNewLabelColor] = useState('#6366f1')
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [showDependencyGraph, setShowDependencyGraph] = useState(true)

  const project = typeof ticket.project === 'object' ? ticket.project : null
  const assignee = typeof ticket.team === 'object' ? ticket.team : null
  const milestone = typeof ticket.milestone === 'object' ? ticket.milestone : null

  /**
   * Inactive people keep their history but must not be assignable. Whoever is on this
   * ticket stays listed, or saving any other change would silently unassign them.
   */
  const assignableMembers = (teams || []).filter(
    (member) => member.active !== false || member.id === teamId
  )

  // Get blocking tickets (resolved objects) - tickets that block this ticket
  const blockingTickets = (ticket.blockedBy || [])
    .map(t => typeof t === 'object' ? t : (allTickets || []).find(at => at.id === t))
    .filter((t): t is Ticket => t !== undefined)

  // Get blocked tickets - tickets that are blocked by this ticket
  const blockedTickets = (allTickets || []).filter(t => {
    const tBlockedByIds = (t.blockedBy || []).map(b => typeof b === 'string' ? b : b.id)
    return tBlockedByIds.includes(ticket.id)
  })

  // Available tickets for blocking (exclude self and already selected)
  const availableTickets = (allTickets || []).filter(t => t.id !== ticket.id && !blockedByIds.includes(t.id))

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description || null,
          status,
          priority,
          team: teamId || null,
          milestone: milestoneId || null,
          startDate: startDate || null,
          dueDate: dueDate || null,
          labels,
          subtasks,
          blockedBy: blockedByIds,
        }),
      })

      if (!response.ok) throw new Error('Failed to update ticket')

      const updated = await response.json()
      onUpdate(updated.doc || updated)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to save ticket:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this ticket?')) return
    onDelete(ticket.id)
    onClose()
  }

  const handleCancel = () => {
    setTitle(ticket.title)
    setDescription(ticket.description as unknown as string || '')
    setStatus(String(ticket.status))
    setPriority(ticket.priority || TicketPriority.NO_PRIORITY)
    setTeamId(typeof ticket.team === 'string' ? ticket.team : ticket.team?.id || '')
    setMilestoneId(typeof ticket.milestone === 'string' ? ticket.milestone : ticket.milestone?.id || '')
    setStartDate(toDateInput(ticket.startDate))
    setDueDate(toDateInput(ticket.dueDate))
    setLabels(ticket.labels || [])
    setSubtasks((ticket.subtasks || []).map(st => ({ title: st.title, completed: st.completed ?? false })))
    setBlockedByIds((ticket.blockedBy || []).map(t => typeof t === 'string' ? t : t.id))
    setNewSubtaskTitle('')
    setIsEditing(false)
  }

  const addBlocker = (ticketId: string) => {
    if (!blockedByIds.includes(ticketId)) {
      setBlockedByIds([...blockedByIds, ticketId])
    }
  }

  const removeBlocker = (ticketId: string) => {
    setBlockedByIds(blockedByIds.filter(id => id !== ticketId))
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const formatRelativeDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  if (!isOpen) return null

  // Reusable Components
  const TitleSection = () => (
    <div className="mb-6">
      {isEditing ? (
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-2xl font-bold bg-transparent border-none px-0 py-2 w-full text-foreground placeholder:text-muted-foreground focus:ring-0 focus:outline-none"
          placeholder="Ticket title"
        />
      ) : (
        <h2 className="text-2xl font-bold text-foreground tracking-tight">{ticket.title}</h2>
      )}
    </div>
  )

  const DescriptionSection = ({ minHeight = '120px' }: { minHeight?: string }) => (
    <div className="bg-card border border-border/40 rounded-xl p-5 mb-6 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        <FileText className="w-3.5 h-3.5" />
        Description
      </div>
      {isEditing ? (
        <RichTextEditor
          value={description}
          onChange={setDescription}
          placeholder="Describe the task in detail..."
        />
      ) : (
        <div style={{ minHeight }} className="text-foreground/90">
          <RichTextDisplay content={ticket.description as unknown as string || ''} />
        </div>
      )}
    </div>
  )

  const SubtasksSection = () => (
    <div className="bg-card border border-border/40 rounded-xl p-5 mb-6 shadow-sm">
      <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-3.5 h-3.5" />
          Subtasks
        </div>
        {subtasks.length > 0 && (
          <span className="bg-secondary/50 px-2 py-0.5 rounded-full text-[10px]">
            {subtasks.filter(s => s.completed).length}/{subtasks.length} completed
          </span>
        )}
      </div>

      <div className="space-y-2 mb-3">
        {subtasks.map((subtask, index) => (
          <div key={index} className="group flex items-center gap-3 p-2.5 bg-secondary/20 hover:bg-secondary/40 border border-transparent hover:border-border/40 rounded-lg transition-all">
            <button
              type="button"
              onClick={() => toggleSubtask(index)}
              className={`flex-none transition-colors ${subtask.completed ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {subtask.completed ? (
                <CheckSquare className="w-5 h-5" />
              ) : (
                <Square className="w-5 h-5" />
              )}
            </button>
            <span className={`flex-1 text-sm ${subtask.completed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
              {subtask.title}
            </span>
            {isEditing && (
              <button
                type="button"
                onClick={() => removeSubtask(index)}
                className="opacity-0 group-hover:opacity-100 p-1.5 text-muted-foreground hover:text-destructive transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        {subtasks.length === 0 && !isEditing && (
          <span className="text-sm text-muted-foreground italic pl-1">No subtasks</span>
        )}
      </div>

      {isEditing && (
        <div className="flex gap-2 items-center group focus-within:ring-1 ring-primary rounded-md">
          <Plus className="w-4 h-4 text-muted-foreground ml-2.5" />
          <input
            type="text"
            value={newSubtaskTitle}
            onChange={(e) => setNewSubtaskTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSubtask())}
            placeholder="Add a subtask..."
            className="flex-1 bg-transparent border-none py-2 text-sm text-foreground placeholder-muted-foreground focus:ring-0"
          />
          <button
            type="button"
            onClick={addSubtask}
            disabled={!newSubtaskTitle.trim()}
            className="px-3 py-1 mr-1 text-xs font-medium bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 disabled:opacity-50 transition-colors"
          >
            Add
          </button>
        </div>
      )}
    </div>
  )

  const StatusSection = () => (
    <div className="bg-card border border-border/40 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        <Clock className="w-3.5 h-3.5" />
        Status
      </div>
      {isEditing ? (
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full bg-secondary/30 hover:bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
        >
          {statusOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
          {/* Surface an orphaned status rather than silently rewriting it on save. */}
          {status && !statusOptions.some((o) => o.key === status) && (
            <option value={status}>{status} (unknown status)</option>
          )}
        </select>
      ) : (
        <div className="flex items-center gap-2.5">
          <span
            className="w-2.5 h-2.5 rounded-full ring-2 ring-background"
            style={{ backgroundColor: statusColor(statusOptions, ticket.status) }}
          />
          <span className="text-sm font-medium text-foreground">
            {statusLabel(statusOptions, ticket.status)}
          </span>
        </div>
      )}
    </div>
  )

  const PrioritySection = () => (
    <div className="bg-card border border-border/40 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        <Flag className="w-3.5 h-3.5" />
        Priority
      </div>
      {isEditing ? (
        <select
          value={priority as string}
          onChange={(e) => setPriority(e.target.value as TicketPriority)}
          className="w-full bg-secondary/30 hover:bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
        >
          {TICKET_PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex items-center gap-2.5">
          <span
            className="w-2.5 h-2.5 rounded-full ring-2 ring-background"
            style={{ backgroundColor: PRIORITY_COLORS[ticket.priority as TicketPriority] || PRIORITY_COLORS[TicketPriority.NO_PRIORITY] }}
          />
          <span className="text-sm font-medium text-foreground">
            {TICKET_PRIORITY_OPTIONS.find((o) => o.value === ticket.priority)?.label || 'No Priority'}
          </span>
        </div>
      )}
    </div>
  )

  const ProjectSection = () => (
    <div className="bg-card border border-border/40 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        <FolderKanban className="w-3.5 h-3.5" />
        Project
      </div>
      {project && (
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: project.color as string }}
          />
          <span className="text-sm font-medium text-foreground">{project.name}</span>
        </div>
      )}
    </div>
  )

  const AssigneeSection = () => (
    <div className="bg-card border border-border/40 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        <Users className="w-3.5 h-3.5" />
        Assignee
      </div>
      {isEditing ? (
        <select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          className="w-full bg-secondary/30 hover:bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
        >
          <option value="">Unassigned</option>
          {assignableMembers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      ) : assignee ? (
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: assignee.color as string }}
          />
          <span
            className={`text-sm font-medium ${
              assignee.active === false ? 'text-muted-foreground' : 'text-foreground'
            }`}
          >
            {assignee.name}
            {assignee.active === false ? ' (inactive)' : ''}
          </span>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground italic">Unassigned</span>
      )}
    </div>
  )

  const MilestoneSection = () => (
    <div className="bg-card border border-border/40 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        <Flag className="w-3.5 h-3.5" />
        Milestone
      </div>
      {isEditing ? (
        <select
          value={milestoneId}
          onChange={(e) => setMilestoneId(e.target.value)}
          className="w-full bg-secondary/30 hover:bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
        >
          <option value="">No milestone</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      ) : milestone ? (
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: (milestone.color as string) || '#ef4444' }}
          />
          <span className="text-sm font-medium text-foreground">{milestone.name}</span>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground italic">No milestone</span>
      )}
    </div>
  )

  const StartDateSection = () => (
    <div className="bg-card border border-border/40 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        <Clock className="w-3.5 h-3.5" />
        Start Date
      </div>
      {isEditing ? (
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full bg-secondary/30 hover:bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
        />
      ) : ticket.startDate ? (
        <span className="text-sm font-medium text-foreground">{formatRelativeDate(ticket.startDate)}</span>
      ) : (
        <span className="text-sm text-muted-foreground italic">No start date</span>
      )}
    </div>
  )

  const DueDateSection = () => (
    <div className="bg-card border border-border/40 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        <Calendar className="w-3.5 h-3.5" />
        Due Date
      </div>
      {isEditing ? (
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="w-full bg-secondary/30 hover:bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
        />
      ) : ticket.dueDate ? (
        <span className="text-sm font-medium text-foreground">{formatRelativeDate(ticket.dueDate)}</span>
      ) : (
        <span className="text-sm text-muted-foreground italic">No due date</span>
      )}
    </div>
  )

  const LabelsSection = () => (
    <div className="bg-card border border-border/40 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        <Tag className="w-3.5 h-3.5" />
        Labels
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        {labels.map((label, index) => (
          <span
            key={index}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border shadow-sm transition-all"
            style={{
              backgroundColor: `${label.color}15`,
              color: label.color as string,
              borderColor: `${label.color}30`,
            }}
          >
            {label.name}
            {isEditing && (
              <button onClick={() => removeLabel(index)} className="hover:opacity-70 ml-1">
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        {labels.length === 0 && !isEditing && (
          <span className="text-sm text-muted-foreground italic">No labels</span>
        )}
      </div>
      {isEditing && (
        <div className="flex gap-2 mt-3">
          <input
            type="text"
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            placeholder="Label name"
            className="flex-1 bg-secondary/30 hover:bg-secondary/50 border border-border/50 rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
          <input
            type="color"
            value={newLabelColor}
            onChange={(e) => setNewLabelColor(e.target.value)}
            className="w-10 h-[38px] p-0.5 bg-secondary/30 border border-border/50 rounded-lg cursor-pointer"
          />
          <button
            type="button"
            onClick={addLabel}
            className="p-2.5 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )

  const BlockedBySection = () => (
    <div className="bg-card border border-border/40 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        <Ban className="w-3.5 h-3.5" />
        Blocked By
      </div>
      <div className="space-y-2 mb-3">
        {isEditing ? (
          blockedByIds.map((blockerId) => {
            const blocker = (allTickets || []).find(t => t.id === blockerId)
            if (!blocker) return null
            const blockerProject = typeof blocker.project === 'object' ? blocker.project : null
            return (
              <div key={blockerId} className="flex items-center gap-2 p-2 bg-secondary/20 border border-border/40 rounded-lg">
                <Ban className="w-4 h-4 text-amber-500" />
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: blockerProject ? `${blockerProject.color}20` : 'var(--secondary)',
                    color: blockerProject?.color as string || 'var(--muted-foreground)',
                  }}
                >
                  {blocker.ticketId}
                </span>
                <span className={`flex-1 text-sm truncate ${isDoneStatus(statusOptions, blocker.status) ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {blocker.title}
                </span>
                <button
                  type="button"
                  onClick={() => removeBlocker(blockerId)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })
        ) : blockingTickets.length > 0 ? (
          blockingTickets.map((blocker) => {
            const blockerProject = typeof blocker.project === 'object' ? blocker.project : null
            return (
              <div key={blocker.id} className="flex items-center gap-2 p-2 bg-secondary/10 border border-border/40 rounded-lg">
                <Ban className={`w-4 h-4 ${isDoneStatus(statusOptions, blocker.status) ? 'text-emerald-500' : 'text-amber-500'}`} />
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: blockerProject ? `${blockerProject.color}20` : 'var(--secondary)',
                    color: blockerProject?.color as string || 'var(--muted-foreground)',
                  }}
                >
                  {blocker.ticketId}
                </span>
                <span className={`flex-1 text-sm truncate ${isDoneStatus(statusOptions, blocker.status) ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {blocker.title}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${isDoneStatus(statusOptions, blocker.status) ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                  {isDoneStatus(statusOptions, blocker.status) ? 'Done' : 'Pending'}
                </span>
              </div>
            )
          })
        ) : (
          <span className="text-sm text-muted-foreground italic">No blockers</span>
        )}
      </div>
      {isEditing && availableTickets.length > 0 && (
        <select
          onChange={(e) => {
            if (e.target.value) {
              addBlocker(e.target.value)
              e.target.value = ''
            }
          }}
          className="w-full bg-secondary/30 hover:bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
          defaultValue=""
        >
          <option value="">Add a blocking ticket...</option>
          {availableTickets.map((t) => {
            const tProject = typeof t.project === 'object' ? t.project : null
            return (
              <option key={t.id} value={t.id}>
                {t.ticketId} - {t.title} {tProject ? `(${tProject.name})` : ''}
              </option>
            )
          })}
        </select>
      )}
    </div>
  )

  const BlocksSection = () => (
    <div className="bg-card border border-border/40 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        <Ban className="w-3.5 h-3.5 rotate-180" />
        Blocks
      </div>
      <div className="space-y-2">
        {blockedTickets.length > 0 ? (
          blockedTickets.map((blocked) => {
            const blockedProject = typeof blocked.project === 'object' ? blocked.project : null
            return (
              <div key={blocked.id} className="flex items-center gap-2 p-2 bg-secondary/10 border border-border/40 rounded-lg">
                <Ban className={`w-4 h-4 ${isDoneStatus(statusOptions, blocked.status) ? 'text-emerald-500' : 'text-rose-500'}`} />
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: blockedProject ? `${blockedProject.color}20` : 'var(--secondary)',
                    color: blockedProject?.color as string || 'var(--muted-foreground)',
                  }}
                >
                  {blocked.ticketId}
                </span>
                <span className={`flex-1 text-sm truncate ${isDoneStatus(statusOptions, blocked.status) ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {blocked.title}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${isDoneStatus(statusOptions, blocked.status) ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                  {isDoneStatus(statusOptions, blocked.status) ? 'Done' : 'Waiting'}
                </span>
              </div>
            )
          })
        ) : (
          <span className="text-sm text-muted-foreground italic">This ticket doesn&apos;t block any other tickets</span>
        )}
      </div>
    </div>
  )

  const DependencyGraphSection = () => (
    !isEditing && (blockingTickets.length > 0 || blockedTickets.length > 0) ? (
      <div className="bg-card border border-border/40 rounded-xl p-5 shadow-sm">
        <button
          onClick={() => setShowDependencyGraph(!showDependencyGraph)}
          className="flex items-center justify-between w-full text-left group"
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-foreground transition-colors">
            <GitBranch className="w-3.5 h-3.5" />
            Dependency Graph
          </div>
          {showDependencyGraph ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          )}
        </button>
        {showDependencyGraph && (
          <div className="mt-4 pt-4 border-t border-border/40">
            <DependencyGraph ticket={ticket} allTickets={allTickets} statuses={statusOptions} />
          </div>
        )}
      </div>
    ) : null
  )

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 ${isFullScreen ? '' : 'p-4 sm:p-6'}`}>
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className={`relative bg-card border border-border/50 shadow-2xl overflow-hidden transition-all duration-300 ease-in-out ${isFullScreen
            ? 'w-full h-full max-w-none rounded-none border-none'
            : 'w-full max-w-4xl mx-auto max-h-[90vh] rounded-xl animate-in zoom-in-95'
          }`}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b border-border/50 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {project && (
              <span
                className="text-xs font-bold px-2 py-1 rounded-md border shadow-sm"
                style={{
                  backgroundColor: `${project.color}15`,
                  color: project.color as string,
                  borderColor: `${project.color}30`,
                }}
              >
                {ticket.ticketId}
              </span>
            )}
            <div className="h-4 w-px bg-border/50 mx-1" />
            <span className="text-sm text-muted-foreground font-medium flex items-center gap-2">
              <FolderKanban className="w-4 h-4" />
              {project?.name || 'No project'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleCancel}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/80 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-primary hover:bg-primary-hover shadow-md shadow-primary/20 rounded-lg transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setIsFullScreen(!isFullScreen)}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-all"
                  title={isFullScreen ? 'Exit full screen' : 'Full screen'}
                >
                  {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                  title="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={handleDelete}
                  className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-all ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <div className={`overflow-y-auto ${isFullScreen ? 'h-[calc(100vh-73px)]' : 'max-h-[calc(90vh-73px)]'}`}>
          <div className={`p-8 ${isFullScreen ? 'max-w-7xl mx-auto' : ''}`}>
            {isFullScreen ? (
              /* Fullscreen: Two-column layout */
              <div className="flex gap-10">
                {/* Left Column - Main Content */}
                <div className="flex-1 min-w-0 space-y-8">
                  <TitleSection />
                  <DescriptionSection minHeight="300px" />
                  <SubtasksSection />
                  <div className="grid grid-cols-2 gap-6">
                    <BlockedBySection />
                    <BlocksSection />
                  </div>
                  <DependencyGraphSection />
                </div>

                {/* Right Column - Metadata Sidebar */}
                <div className="w-80 flex-shrink-0 space-y-6">
                  <StatusSection />
                  <PrioritySection />
                  <ProjectSection />
                  <AssigneeSection />
                  <MilestoneSection />
                  <StartDateSection />
                  <DueDateSection />
                  <LabelsSection />

                  {/* Timestamps */}
                  <div className="bg-secondary/20 rounded-xl p-4 text-xs font-medium text-muted-foreground border border-border/30">
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Created</span>
                        <span className="text-foreground">{formatDate(ticket.createdAt)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Updated</span>
                        <span className="text-foreground">{formatDate(ticket.updatedAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Normal: Single-column layout */
              <div className="space-y-8">
                <div>
                  <TitleSection />

                  <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-8 mt-6">
                    {/* Main */}
                    <div className="space-y-8">
                      <DescriptionSection />
                      <SubtasksSection />
                      <BlockedBySection />
                      <BlocksSection />
                      <DependencyGraphSection />
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-5">
                      <StatusSection />
                      <PrioritySection />
                      <div className="grid grid-cols-2 gap-4">
                        <ProjectSection />
                        <AssigneeSection />
                      </div>
                      <MilestoneSection />
                      <StartDateSection />
                      <DueDateSection />
                      <LabelsSection />

                      {/* Timestamps */}
                      <div className="pt-4 mt-4 border-t border-border/50 text-xs text-muted-foreground flex justify-between">
                        <span>Updated {formatDate(ticket.updatedAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
