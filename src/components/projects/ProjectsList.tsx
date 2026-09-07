'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, MoreHorizontal, Pencil, Trash2, FolderKanban, Eye, Loader2 } from 'lucide-react'
import { ProjectModal } from './ProjectModal'
import { ProjectDetailModal } from './ProjectDetailModal'
import { TicketDetailModal } from '@/components/kanban/TicketDetailModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PROJECT_STATUS_OPTIONS, ProjectStatus } from '@/types/enums'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import type { Project, Team, Ticket } from '@/payload-types'
import * as Icons from 'lucide-react'

interface PaginationInfo {
  page: number
  totalPages: number
  hasNextPage: boolean
}

interface ProjectsListProps {
  initialProjects: Project[]
  initialPagination?: PaginationInfo
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

export function ProjectsList({ initialProjects, initialPagination }: ProjectsListProps) {
  const [projects, setProjects] = useState<Project[]>(initialProjects)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [viewingProject, setViewingProject] = useState<Project | null>(null)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Pagination state
  const [pagination, setPagination] = useState<PaginationInfo>(
    initialPagination || { page: 1, totalPages: 1, hasNextPage: false }
  )

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    project: Project
    ticketCount: number
  } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Ticket detail modal state
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [teams, setTeams] = useState<Team[]>([])

  // Load more projects for infinite scroll
  const loadMoreProjects = useCallback(async () => {
    if (!pagination.hasNextPage) return

    try {
      const nextPage = pagination.page + 1
      const response = await fetch(`/api/projects?page=${nextPage}&limit=20&sort=-createdAt`)
      const data = await response.json()

      if (data.docs && data.docs.length > 0) {
        setProjects((prev) => [...prev, ...data.docs])
        setPagination({
          page: data.page,
          totalPages: data.totalPages,
          hasNextPage: data.hasNextPage,
        })
      }
    } catch (error) {
      console.error('Failed to load more projects:', error)
    }
  }, [pagination])

  const { sentinelRef, isLoading: isLoadingMore } = useInfiniteScroll(
    loadMoreProjects,
    pagination.hasNextPage
  )

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    // Load Team Members for the ticket detail modal. The REST path stays /api/teams —
    // the slug is unchanged on purpose (see collections/TeamMembers.ts).
    const loadTeams = async () => {
      try {
        const response = await fetch('/api/teams?limit=100')
        const data = await response.json()
        setTeams(data.docs || [])
      } catch (error) {
        console.error('Failed to load team members:', error)
      }
    }
    loadTeams()
  }, [])

  const handleCreateProject = () => {
    setEditingProject(null)
    setIsModalOpen(true)
  }

  const handleViewProject = (project: Project) => {
    setViewingProject(project)
    setMenuOpen(null)
  }

  const handleEditProject = (project: Project) => {
    setEditingProject(project)
    setIsModalOpen(true)
    setMenuOpen(null)
  }

  const handleInitiateDelete = async (project: Project) => {
    setMenuOpen(null)

    // Fetch ticket count for this project
    try {
      const response = await fetch(`/api/tickets?where[project][equals]=${project.id}&limit=0`)
      const data = await response.json()
      const ticketCount = data.totalDocs || 0

      setDeleteConfirm({ project, ticketCount })
    } catch (error) {
      console.error('Failed to fetch ticket count:', error)
      // Show dialog with unknown count
      setDeleteConfirm({ project, ticketCount: -1 })
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return

    setIsDeleting(true)
    try {
      const { project, ticketCount } = deleteConfirm

      // First, delete all tickets associated with this project
      if (ticketCount > 0) {
        // Fetch all ticket IDs for this project
        const ticketsResponse = await fetch(
          `/api/tickets?where[project][equals]=${project.id}&limit=1000`
        )
        const ticketsData = await ticketsResponse.json()
        const tickets = ticketsData.docs || []

        // Delete each ticket
        await Promise.all(
          tickets.map((ticket: { id: string }) =>
            fetch(`/api/tickets/${ticket.id}`, { method: 'DELETE' })
          )
        )
      }

      // Then delete the project
      await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      setProjects((prev) => prev.filter((p) => p.id !== project.id))
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Failed to delete project:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleProjectSaved = (savedProject: Project) => {
    if (editingProject) {
      setProjects((prev) =>
        prev.map((p) => (p.id === savedProject.id ? savedProject : p))
      )
    } else {
      setProjects((prev) => [savedProject, ...prev])
    }
    setIsModalOpen(false)
    setEditingProject(null)
  }

  const handleProjectUpdated = (updatedProject: Project) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === updatedProject.id ? updatedProject : p))
    )
    setViewingProject(updatedProject)
  }

  const handleProjectDeleted = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId)
    if (project) {
      handleInitiateDelete(project)
    }
    setViewingProject(null)
  }

  const handleTicketClick = (ticket: Ticket) => {
    setSelectedTicket(ticket)
  }

  const handleTicketUpdate = (updatedTicket: Ticket) => {
    setSelectedTicket(updatedTicket)
  }

  const handleTicketDelete = async (ticketId: string) => {
    try {
      await fetch(`/api/tickets/${ticketId}`, { method: 'DELETE' })
      setSelectedTicket(null)
    } catch (error) {
      console.error('Failed to delete ticket:', error)
    }
  }

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      [ProjectStatus.ACTIVE]: 'bg-green-500/20 text-green-400',
      [ProjectStatus.ON_HOLD]: 'bg-yellow-500/20 text-yellow-400',
      [ProjectStatus.COMPLETED]: 'bg-blue-500/20 text-blue-400',
      [ProjectStatus.CANCELLED]: 'bg-red-500/20 text-red-400',
    }
    return colors[status] || 'bg-gray-500/20 text-gray-400'
  }

  const getDeleteMessage = () => {
    if (!deleteConfirm) return ''
    const { project, ticketCount } = deleteConfirm

    if (ticketCount === -1) {
      return `Are you sure you want to delete "${project.name}"?\n\nThis will also delete all associated tickets.`
    }

    if (ticketCount === 0) {
      return `Are you sure you want to delete "${project.name}"?\n\nThis project has no tickets.`
    }

    return `Are you sure you want to delete "${project.name}"?\n\nThis will permanently delete ${ticketCount} ticket${ticketCount === 1 ? '' : 's'} associated with this project.`
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Projects</h1>
        <button
          onClick={handleCreateProject}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      {/* Projects Grid */}
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <FolderKanban className="w-12 h-12 text-gray-500 mb-4" />
          <h2 className="text-lg font-medium text-white mb-2">No projects yet</h2>
          <p className="text-gray-400 mb-4">Create your first project to get started</p>
          <button
            onClick={handleCreateProject}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Project
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => {
              const IconComponent = iconMap[project.icon as string] || Icons.Folder
              return (
                <div
                  key={project.id}
                  onClick={() => handleViewProject(project)}
                  className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 hover:border-[#3f3f46] transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
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
                      <div>
                        <h3 className="text-white font-medium">{project.name}</h3>
                        <span className="text-xs text-gray-500">{project.prefix}</span>
                      </div>
                    </div>

                    <div className="relative" ref={menuOpen === project.id ? menuRef : null}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setMenuOpen(menuOpen === project.id ? null : project.id)
                        }}
                        className="p-1 text-gray-400 hover:text-white transition-colors"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>

                      {menuOpen === project.id && (
                        <div className="absolute right-0 top-full mt-1 bg-[#27272a] border border-[#3f3f46] rounded-md shadow-lg py-1 z-10 min-w-[120px]">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleViewProject(project)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-[#3f3f46] transition-colors"
                          >
                            <Eye className="w-3 h-3" />
                            View
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleEditProject(project)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-[#3f3f46] transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                            Edit
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleInitiateDelete(project)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-[#3f3f46] transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className={`text-xs px-2 py-1 rounded ${getStatusBadge(project.status as string)}`}>
                      {PROJECT_STATUS_OPTIONS.find((o) => o.value === project.status)?.label || project.status}
                    </span>
                    <span className="text-xs text-gray-500">
                      {project.ticketCounter || 0} tickets
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Infinite scroll sentinel and loading indicator */}
          <div ref={sentinelRef} className="h-4" />
          {isLoadingMore && (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
            </div>
          )}
        </>
      )}

      <ProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        project={editingProject}
        onSave={handleProjectSaved}
      />

      {viewingProject && (
        <ProjectDetailModal
          isOpen={!!viewingProject}
          onClose={() => setViewingProject(null)}
          project={viewingProject}
          onUpdate={handleProjectUpdated}
          onDelete={handleProjectDeleted}
          onTicketClick={handleTicketClick}
        />
      )}

      {selectedTicket && (
        <TicketDetailModal
          isOpen={!!selectedTicket}
          onClose={() => setSelectedTicket(null)}
          ticket={selectedTicket}
          projects={projects}
          teams={teams}
          allTickets={[]}
          onUpdate={handleTicketUpdate}
          onDelete={handleTicketDelete}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Project"
        message={getDeleteMessage()}
        confirmText="Delete Project"
        isDestructive={true}
        isLoading={isDeleting}
      />
    </div>
  )
}
