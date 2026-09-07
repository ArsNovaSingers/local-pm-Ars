'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Pencil,
  Save,
  X,
  Calendar,
  Hash,
  FolderKanban,
} from 'lucide-react'
import { RichTextEditor } from '@/components/ui/RichTextEditor'
import { ProjectStatus, PROJECT_STATUS_OPTIONS, PROJECT_COLORS, PROJECT_ICONS } from '@/types/enums'
import {
  type BoardStatus,
  fallbackStatuses,
  findStatus,
  isDoneStatus,
  statusColor,
  statusLabel,
} from '@/components/kanban/status-utils'
import type { Project, Ticket, Team } from '@/payload-types'
import * as Icons from 'lucide-react'

interface ProjectDetailProps {
  project: Project
  tickets: Ticket[]
  /**
   * Team Members — people. The Payload slug and the generated `Team` type stay as they
   * are on purpose; see collections/TeamMembers.ts.
   */
  teams: Team[]
  /** Workflow states from the `statuses` collection. Never a fixed list. */
  statuses?: BoardStatus[]
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

export function ProjectDetail({ project: initialProject, tickets, teams, statuses }: ProjectDetailProps) {
  const router = useRouter()
  const [project, setProject] = useState(initialProject)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Edit form state
  const [name, setName] = useState(project.name)
  const [status, setStatus] = useState(project.status)
  const [icon, setIcon] = useState<string>(project.icon as string || 'folder')
  const [color, setColor] = useState<string>(project.color as string || '#6366f1')
  const [description, setDescription] = useState(project.description as unknown as string || '')

  const IconComponent = iconMap[project.icon as string] || Icons.Folder

  // Calculate ticket stats
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
        body: JSON.stringify({
          name,
          status,
          icon,
          color,
          description,
        }),
      })

      if (!response.ok) throw new Error('Failed to update project')

      const updated = await response.json()
      setProject(updated.doc || updated)
      setIsEditing(false)
      router.refresh()
    } catch (error) {
      console.error('Failed to save project:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setName(project.name)
    setStatus(project.status)
    setIcon(project.icon || 'folder')
    setColor(project.color || '#6366f1')
    setDescription(project.description as unknown as string || '')
    setIsEditing(false)
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

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-[#27272a] bg-[#0f0f0f]">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4 mb-4">
            <Link
              href="/projects"
              className="p-2 text-gray-400 hover:text-white hover:bg-[#1f1f23] rounded-md transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>

            {isEditing ? (
              <div className="flex items-center gap-3 flex-1">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="text-2xl font-bold bg-[#1f1f23] border border-[#27272a] rounded-md px-3 py-1 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-1">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${project.color}20` }}
                >
                  <IconComponent
                    className="w-5 h-5"
                    style={{ color: project.color as string }}
                  />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-white">{project.name}</h1>
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Hash className="w-3 h-3" />
                    <span>{project.prefix}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              {isEditing ? (
                <>
                  <button
                    onClick={handleCancel}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#27272a] hover:bg-[#3f3f46] rounded-md transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                  Edit
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="grid grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="col-span-2 space-y-6">
            {/* Description */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Description</h2>
              {isEditing ? (
                <RichTextEditor
                  value={description}
                  onChange={setDescription}
                  placeholder="Describe your project..."
                />
              ) : (
                <div className="prose prose-invert max-w-none">
                  {project.description ? (
                    <RichTextRenderer content={project.description} />
                  ) : (
                    <p className="text-gray-500 italic">No description yet. Click Edit to add one.</p>
                  )}
                </div>
              )}
            </div>

            {/* Recent Tickets */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Recent Tickets</h2>
                <Link
                  href={`/board?project=${project.id}`}
                  className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  View all on board →
                </Link>
              </div>

              {tickets.length === 0 ? (
                <p className="text-gray-500">No tickets yet.</p>
              ) : (
                <div className="space-y-2">
                  {tickets.slice(0, 5).map((ticket) => {
                    const team = typeof ticket.team === 'object' ? ticket.team : null
                    return (
                      <div
                        key={ticket.id}
                        className="flex items-center gap-3 p-3 bg-[#1f1f23] rounded-md"
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
                        {team && (
                          <span
                            className="text-xs px-2 py-0.5 rounded"
                            style={{
                              backgroundColor: `${team.color}20`,
                              color: team.color as string,
                            }}
                          >
                            {team.name}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Status & Settings */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-6">
              <h3 className="text-sm font-medium text-gray-400 mb-4">Details</h3>

              <div className="space-y-4">
                {/* Status */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Status</label>
                  {isEditing ? (
                    <select
                      value={status as string}
                      onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                      className="w-full bg-[#1f1f23] border border-[#27272a] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    >
                      {PROJECT_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={`inline-block text-xs px-2 py-1 rounded ${getStatusBadgeClass(project.status as string)}`}>
                      {project.status}
                    </span>
                  )}
                </div>

                {/* Icon */}
                {isEditing && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-2">Icon</label>
                    <div className="grid grid-cols-4 gap-2">
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
                )}

                {/* Color */}
                {isEditing && (
                  <div>
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
                )}

                {/* Created */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Created</label>
                  <div className="flex items-center gap-2 text-sm text-white">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    {formatDate(project.createdAt)}
                  </div>
                </div>

                {/* Updated */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Last Updated</label>
                  <div className="flex items-center gap-2 text-sm text-white">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    {formatDate(project.updatedAt)}
                  </div>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-6">
              <h3 className="text-sm font-medium text-gray-400 mb-4">Statistics</h3>

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

                {/* Progress bar */}
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
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Simple Rich Text Renderer for Lexical content
function RichTextRenderer({ content }: { content: unknown }) {
  if (!content || typeof content !== 'object') {
    return <p className="text-gray-500 italic">No description</p>
  }

  const root = (content as { root?: { children?: unknown[] } }).root
  if (!root?.children) {
    return <p className="text-gray-500 italic">No description</p>
  }

  return (
    <div className="text-gray-300 space-y-2">
      {root.children.map((node: unknown, index: number) => {
        const typedNode = node as { type?: string; children?: { text?: string }[]; tag?: string }
        if (typedNode.type === 'paragraph') {
          const text = typedNode.children?.map((c) => c.text || '').join('') || ''
          if (!text) return null
          return <p key={index}>{text}</p>
        }
        if (typedNode.type === 'heading') {
          const text = typedNode.children?.map((c) => c.text || '').join('') || ''
          const Tag = (typedNode.tag || 'h2') as React.ElementType
          return <Tag key={index} className="font-semibold text-white">{text}</Tag>
        }
        return null
      })}
    </div>
  )
}
