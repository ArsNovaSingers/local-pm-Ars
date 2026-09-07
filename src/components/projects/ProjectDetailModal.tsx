'use client'

import { useState, useEffect } from 'react'
import {
  X,
  Pencil,
  Save,
  Trash2,
  Calendar,
  Hash,
  FolderKanban,
  FileText,
  Loader2,
  ChevronDown,
  Maximize2,
  Minimize2,
  ExternalLink,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { ProjectStatus, PROJECT_STATUS_OPTIONS, PROJECT_COLORS, PROJECT_ICONS } from '@/types/enums'
import {
  type BoardStatus,
  fallbackStatuses,
  findStatus,
  toBoardStatuses,
  isDoneStatus,
  statusColor,
  statusLabel,
} from '@/components/kanban/status-utils'
import { RichTextEditor, RichTextDisplay } from '@/components/ui/RichTextEditor'
import type { Project, Ticket } from '@/payload-types'
import * as Icons from 'lucide-react'

interface ProjectDetailModalProps {
  isOpen: boolean
  onClose: () => void
  project: Project
  onUpdate: (project: Project) => void
  onDelete: (projectId: string) => void
  onTicketClick?: (ticket: Ticket) => void
}

const iconMap: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  folder: Icons.Folder,
  rocket: Icons.Rocket,
  zap: Icons.Zap,
  star: Icons.Star,
  heart: Icons.Heart,
  flag: Icons.Flag,
  target: Icons.Target,
  briefcase: Icons.Briefcase,
  code: Icons.Code,
  box: Icons.Box,
  layers: Icons.Layers,
  database: Icons.Database,
}

export function ProjectDetailModal({
  isOpen,
  onClose,
  project: initialProject,
  onUpdate,
  onDelete,
  onTicketClick,
}: ProjectDetailModalProps) {
  const router = useRouter()
  const [project, setProject] = useState(initialProject)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [isLoadingTickets, setIsLoadingTickets] = useState(false)
  // This modal loads its own tickets, so it loads its own workflow states too rather
  // than having them threaded through every list that can open it.
  const [statuses, setStatuses] = useState<BoardStatus[]>([])
  const [ticketPagination, setTicketPagination] = useState({
    page: 1,
    hasNextPage: false,
    totalDocs: 0,
  })
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // Form state
  const [name, setName] = useState(project.name)
  const [status, setStatus] = useState(project.status)
  const [icon, setIcon] = useState<string>(project.icon as string || 'folder')
  const [color, setColor] = useState<string>(project.color as string || '#6366f1')
  const [description, setDescription] = useState(project.description as unknown as string || '')

  const IconComponent = iconMap[project.icon as string] || Icons.Folder

  useEffect(() => {
    if (isOpen) {
      setProject(initialProject)
      setName(initialProject.name)
      setStatus(initialProject.status)
      setIcon(initialProject.icon || 'folder')
      setColor(initialProject.color || '#6366f1')
      setDescription(initialProject.description as unknown as string || '')
      loadTickets()
      loadStatuses()
    }
  }, [isOpen, initialProject])

  const loadStatuses = async () => {
    try {
      const response = await fetch('/api/statuses?limit=200&depth=0&sort=order')
      const data = await response.json()
      setStatuses(toBoardStatuses(data.docs || []))
    } catch (error) {
      console.error('Failed to load statuses:', error)
    }
  }

  const loadTickets = async () => {
    setIsLoadingTickets(true)
    try {
      const response = await fetch(`/api/tickets?where[project][equals]=${initialProject.id}&limit=20&page=1&depth=1`)
      const data = await response.json()
      setTickets(data.docs || [])
      setTicketPagination({
        page: data.page || 1,
        hasNextPage: data.hasNextPage || false,
        totalDocs: data.totalDocs || 0,
      })
    } catch (error) {
      console.error('Failed to load tickets:', error)
    } finally {
      setIsLoadingTickets(false)
    }
  }

  const loadMoreTickets = async () => {
    if (!ticketPagination.hasNextPage || isLoadingMore) return

    setIsLoadingMore(true)
    try {
      const nextPage = ticketPagination.page + 1
      const response = await fetch(`/api/tickets?where[project][equals]=${initialProject.id}&limit=20&page=${nextPage}&depth=1`)
      const data = await response.json()

      if (data.docs && data.docs.length > 0) {
        setTickets((prev) => [...prev, ...data.docs])
        setTicketPagination({
          page: data.page || nextPage,
          hasNextPage: data.hasNextPage || false,
          totalDocs: data.totalDocs || 0,
        })
      }
    } catch (error) {
      console.error('Failed to load more tickets:', error)
    } finally {
      setIsLoadingMore(false)
    }
  }

  // Workflow states are configurable, so the breakdown is built from whatever states
  // this workspace actually defines rather than a hardcoded Todo/In Progress/Done.
  // A project using custom states used to report every one of them as "Done".
  const statusList = statuses?.length ? statuses : fallbackStatuses()
  const ticketStats = {
    total: tickets.length,
    done: tickets.filter(t => isDoneStatus(statusList, t.status)).length,
    byStatus: statusList
      .map(s => ({ ...s, count: tickets.filter(t => String(t.status) === s.key).length }))
      .filter(s => s.count > 0),
    unknown: tickets.filter(t => !findStatus(statusList, t.status)).length,
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, status, icon, color, description: description || null }),
      })

      if (!response.ok) throw new Error('Failed to update project')

      const updated = await response.json()
      const updatedProject = updated.doc || updated
      setProject(updatedProject)
      onUpdate(updatedProject)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to save project:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = () => {
    onDelete(project.id)
    onClose()
  }

  const handleCancel = () => {
    setName(project.name)
    setStatus(project.status)
    setIcon(project.icon || 'folder')
    setColor(project.color || '#6366f1')
    setDescription(project.description as unknown as string || '')
    setIsEditing(false)
  }

  const handleViewOnBoard = () => {
    onClose()
    router.push(`/board?project=${project.id}`)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const getStatusBadgeClass = (statusValue: string) => {
    const classes: Record<string, string> = {
      [ProjectStatus.ACTIVE]: 'bg-green-500/20 text-green-400',
      [ProjectStatus.ON_HOLD]: 'bg-yellow-500/20 text-yellow-400',
      [ProjectStatus.COMPLETED]: 'bg-blue-500/20 text-blue-400',
      [ProjectStatus.CANCELLED]: 'bg-red-500/20 text-red-400',
    }
    return classes[statusValue] || 'bg-gray-500/20 text-gray-400'
  }

  if (!isOpen) return null

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm ${isFullScreen ? '' : 'p-4'}`}>
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className={`relative bg-card border border-border/50 overflow-hidden transition-all duration-200 ${
          isFullScreen
            ? 'w-full h-full max-w-none rounded-none border-none'
            : 'w-full max-w-2xl mx-4 max-h-[90vh] rounded-xl'
        }`}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#18181b] border-b border-[#27272a] px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${project.color}20` }}
            >
              <IconComponent
                className="w-5 h-5"
                style={{ color: project.color as string }}
              />
            </div>
            {isEditing ? (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-lg font-semibold bg-[#1f1f23] border border-[#27272a] rounded-md px-3 py-1 text-white focus:outline-none focus:border-indigo-500"
              />
            ) : (
              <div>
                <h2 className="text-lg font-semibold text-white">{project.name}</h2>
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Hash className="w-3 h-3" />
                  {project.prefix}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleCancel}
                  className="p-2 text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setIsFullScreen(!isFullScreen)}
                  className="p-2 text-gray-400 hover:text-white transition-colors"
                  title={isFullScreen ? 'Exit full screen' : 'Full screen'}
                >
                  {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 text-gray-400 hover:text-white transition-colors"
                  title="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={handleDelete}
                  className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <div className={`overflow-y-auto ${isFullScreen ? 'h-[calc(100vh-73px)]' : 'max-h-[calc(90vh-73px)]'}`}>
          <div className={`p-6 ${isFullScreen ? 'max-w-7xl mx-auto' : ''}`}>
            {isFullScreen ? (
              /* Fullscreen: Two-column layout */
              <div className="flex gap-8">
                {/* Left Column - Main Content */}
                <div className="flex-1 min-w-0 space-y-6 overflow-hidden">
                  {/* Description */}
                  <div className="bg-[#1f1f23] rounded-lg p-4 overflow-hidden">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                      <FileText className="w-3 h-3" />
                      Description
                    </div>
                    <div className="overflow-hidden break-words">
                      {isEditing ? (
                        <RichTextEditor
                          value={description}
                          onChange={setDescription}
                          placeholder="Describe the project goals, scope, and any important details..."
                        />
                      ) : (
                        <RichTextDisplay content={project.description as unknown as string || ''} />
                      )}
                    </div>
                  </div>

                  {/* Statistics */}
                  <div className="bg-[#1f1f23] rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-400 mb-4">Statistics</h3>
                    {isLoadingTickets ? (
                      <div className="text-sm text-gray-500">Loading...</div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-400">Total Tickets</span>
                          <span className="text-sm font-medium text-white">{ticketStats.total}</span>
                        </div>
                        {ticketStats.byStatus.map((s) => (
                          <div key={s.key} className="flex items-center justify-between">
                            <span className="text-sm text-gray-400">{s.label}</span>
                            <span className="text-sm font-medium" style={{ color: s.color }}>{s.count}</span>
                          </div>
                        ))}
                        {ticketStats.unknown > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-amber-400">Unknown status</span>
                            <span className="text-sm font-medium text-amber-400">{ticketStats.unknown}</span>
                          </div>
                        )}

                        {ticketStats.total > 0 && (
                          <div className="pt-2">
                            <div className="h-2 bg-[#27272a] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-green-500 transition-all"
                                style={{ width: `${(ticketStats.done / ticketStats.total) * 100}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              {Math.round((ticketStats.done / ticketStats.total) * 100)}% complete
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Tickets */}
                  <div className="bg-[#1f1f23] rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-medium text-gray-400">
                        Tickets {ticketPagination.totalDocs > 0 && `(${ticketPagination.totalDocs})`}
                      </h3>
                      <button
                        onClick={handleViewOnBoard}
                        className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View on Board
                      </button>
                    </div>
                    {isLoadingTickets ? (
                      <div className="text-sm text-gray-500">Loading...</div>
                    ) : tickets.length === 0 ? (
                      <p className="text-sm text-gray-500">No tickets yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {tickets.map((ticket) => (
                          <div
                            key={ticket.id}
                            onClick={() => onTicketClick?.(ticket)}
                            className={`flex items-center gap-3 p-2 bg-[#27272a] rounded-md ${
                              onTicketClick ? 'cursor-pointer hover:bg-[#3f3f46] transition-colors' : ''
                            }`}
                          >
                            <span
                              className="text-xs font-medium px-2 py-0.5 rounded"
                              style={{
                                backgroundColor: `${project.color}20`,
                                color: project.color as string,
                              }}
                            >
                              {ticket.ticketId}
                            </span>
                            <span className="flex-1 text-sm text-white truncate">
                              {ticket.title}
                            </span>
                            <span
                          className="text-xs px-2 py-0.5 rounded"
                          style={{
                            backgroundColor: `${statusColor(statusList, ticket.status)}20`,
                            color: statusColor(statusList, ticket.status),
                          }}
                        >
                          {statusLabel(statusList, ticket.status)}
                        </span>
                          </div>
                        ))}

                        {ticketPagination.hasNextPage && (
                          <button
                            onClick={loadMoreTickets}
                            disabled={isLoadingMore}
                            className="w-full flex items-center justify-center gap-2 py-2 text-xs text-gray-400 hover:text-white bg-[#27272a] hover:bg-[#3f3f46] rounded-md transition-colors disabled:opacity-50"
                          >
                            {isLoadingMore ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Loading...
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3 h-3" />
                                Load more ({ticketPagination.totalDocs - tickets.length} remaining)
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column - Metadata */}
                <div className="w-80 shrink-0 space-y-6">
                  {/* Status */}
                  <div className="bg-[#1f1f23] rounded-lg p-4">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                      <FolderKanban className="w-3 h-3" />
                      Status
                    </div>
                    {isEditing ? (
                      <select
                        value={status as string}
                        onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                        className="w-full bg-[#27272a] border border-[#3f3f46] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                      >
                        {PROJECT_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`inline-block text-xs px-2 py-1 rounded ${getStatusBadgeClass(project.status as string)}`}>
                        {PROJECT_STATUS_OPTIONS.find((o) => o.value === project.status)?.label}
                      </span>
                    )}
                  </div>

                  {/* Icon & Color (Edit mode only) */}
                  {isEditing && (
                    <>
                      <div className="bg-[#1f1f23] rounded-lg p-4">
                        <label className="block text-xs text-gray-500 mb-2">Icon</label>
                        <div className="grid grid-cols-6 gap-2">
                          {PROJECT_ICONS.map((iconName) => {
                            const Icon = iconMap[iconName] || Icons.Folder
                            return (
                              <button
                                key={iconName}
                                type="button"
                                onClick={() => setIcon(iconName)}
                                className={`p-2 rounded border transition-colors flex items-center justify-center ${
                                  icon === iconName
                                    ? 'border-indigo-500 bg-indigo-500/20'
                                    : 'border-[#27272a] hover:border-[#3f3f46]'
                                }`}
                              >
                                <Icon className="w-4 h-4 text-gray-300" />
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div className="bg-[#1f1f23] rounded-lg p-4">
                        <label className="block text-xs text-gray-500 mb-2">Color</label>
                        <div className="grid grid-cols-6 gap-2">
                          {PROJECT_COLORS.map((colorOption) => (
                            <button
                              key={colorOption}
                              type="button"
                              onClick={() => setColor(colorOption)}
                              className={`w-6 h-6 rounded-full border-2 transition-all ${
                                color === colorOption ? 'border-white scale-110' : 'border-transparent'
                              }`}
                              style={{ backgroundColor: colorOption }}
                            />
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Timestamps */}
                  <div className="bg-[#1f1f23] rounded-lg p-4">
                    <div className="space-y-3 text-xs text-gray-500">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-3 h-3" />
                        <span>Created {formatDate(project.createdAt)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-3 h-3" />
                        <span>Updated {formatDate(project.updatedAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Normal: Single-column layout */
              <>
                {/* Status */}
                <div className="bg-[#1f1f23] rounded-lg p-4 mb-6">
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                    <FolderKanban className="w-3 h-3" />
                    Status
                  </div>
                  {isEditing ? (
                    <select
                      value={status as string}
                      onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                      className="w-full bg-[#27272a] border border-[#3f3f46] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                    >
                      {PROJECT_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={`inline-block text-xs px-2 py-1 rounded ${getStatusBadgeClass(project.status as string)}`}>
                      {PROJECT_STATUS_OPTIONS.find((o) => o.value === project.status)?.label}
                    </span>
                  )}
                </div>

                {/* Description */}
                <div className="bg-[#1f1f23] rounded-lg p-4 mb-6">
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                    <FileText className="w-3 h-3" />
                    Description
                  </div>
                  {isEditing ? (
                    <RichTextEditor
                      value={description}
                      onChange={setDescription}
                      placeholder="Describe the project goals, scope, and any important details..."
                    />
                  ) : (
                    <RichTextDisplay content={project.description as unknown as string || ''} />
                  )}
                </div>

                {/* Icon & Color (Edit mode only) */}
                {isEditing && (
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-[#1f1f23] rounded-lg p-4">
                      <label className="block text-xs text-gray-500 mb-2">Icon</label>
                      <div className="grid grid-cols-6 gap-2">
                        {PROJECT_ICONS.map((iconName) => {
                          const Icon = iconMap[iconName] || Icons.Folder
                          return (
                            <button
                              key={iconName}
                              type="button"
                              onClick={() => setIcon(iconName)}
                              className={`p-2 rounded border transition-colors flex items-center justify-center ${
                                icon === iconName
                                  ? 'border-indigo-500 bg-indigo-500/20'
                                  : 'border-[#27272a] hover:border-[#3f3f46]'
                              }`}
                            >
                              <Icon className="w-4 h-4 text-gray-300" />
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="bg-[#1f1f23] rounded-lg p-4">
                      <label className="block text-xs text-gray-500 mb-2">Color</label>
                      <div className="grid grid-cols-6 gap-2">
                        {PROJECT_COLORS.map((colorOption) => (
                          <button
                            key={colorOption}
                            type="button"
                            onClick={() => setColor(colorOption)}
                            className={`w-6 h-6 rounded-full border-2 transition-all ${
                              color === colorOption ? 'border-white scale-110' : 'border-transparent'
                            }`}
                            style={{ backgroundColor: colorOption }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Statistics */}
                <div className="bg-[#1f1f23] rounded-lg p-4 mb-6">
                  <h3 className="text-sm font-medium text-gray-400 mb-4">Statistics</h3>
                  {isLoadingTickets ? (
                    <div className="text-sm text-gray-500">Loading...</div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-400">Total Tickets</span>
                        <span className="text-sm font-medium text-white">{ticketStats.total}</span>
                      </div>
                      {ticketStats.byStatus.map((s) => (
                        <div key={s.key} className="flex items-center justify-between">
                          <span className="text-sm text-gray-400">{s.label}</span>
                          <span className="text-sm font-medium" style={{ color: s.color }}>{s.count}</span>
                        </div>
                      ))}
                      {ticketStats.unknown > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-amber-400">Unknown status</span>
                          <span className="text-sm font-medium text-amber-400">{ticketStats.unknown}</span>
                        </div>
                      )}

                      {ticketStats.total > 0 && (
                        <div className="pt-2">
                          <div className="h-2 bg-[#27272a] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500 transition-all"
                              style={{ width: `${(ticketStats.done / ticketStats.total) * 100}%` }}
                            />
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {Math.round((ticketStats.done / ticketStats.total) * 100)}% complete
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Tickets */}
                <div className="bg-[#1f1f23] rounded-lg p-4 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-gray-400">
                      Tickets {ticketPagination.totalDocs > 0 && `(${ticketPagination.totalDocs})`}
                    </h3>
                    <button
                      onClick={handleViewOnBoard}
                      className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View on Board
                    </button>
                  </div>
                  {isLoadingTickets ? (
                    <div className="text-sm text-gray-500">Loading...</div>
                  ) : tickets.length === 0 ? (
                    <p className="text-sm text-gray-500">No tickets yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {tickets.map((ticket) => (
                        <div
                          key={ticket.id}
                          onClick={() => onTicketClick?.(ticket)}
                          className={`flex items-center gap-3 p-2 bg-[#27272a] rounded-md ${
                            onTicketClick ? 'cursor-pointer hover:bg-[#3f3f46] transition-colors' : ''
                          }`}
                        >
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded"
                            style={{
                              backgroundColor: `${project.color}20`,
                              color: project.color as string,
                            }}
                          >
                            {ticket.ticketId}
                          </span>
                          <span className="flex-1 text-sm text-white truncate">
                            {ticket.title}
                          </span>
                          <span
                          className="text-xs px-2 py-0.5 rounded"
                          style={{
                            backgroundColor: `${statusColor(statusList, ticket.status)}20`,
                            color: statusColor(statusList, ticket.status),
                          }}
                        >
                          {statusLabel(statusList, ticket.status)}
                        </span>
                        </div>
                      ))}

                      {ticketPagination.hasNextPage && (
                        <button
                          onClick={loadMoreTickets}
                          disabled={isLoadingMore}
                          className="w-full flex items-center justify-center gap-2 py-2 text-xs text-gray-400 hover:text-white bg-[#27272a] hover:bg-[#3f3f46] rounded-md transition-colors disabled:opacity-50"
                        >
                          {isLoadingMore ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Loading...
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3 h-3" />
                              Load more ({ticketPagination.totalDocs - tickets.length} remaining)
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Timestamps */}
                <div className="border-t border-[#27272a] pt-4 text-xs text-gray-500">
                  <div className="flex justify-between">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Created {formatDate(project.createdAt)}
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Updated {formatDate(project.updatedAt)}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
