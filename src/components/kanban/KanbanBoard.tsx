'use client'

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { KanbanColumn } from './KanbanColumn'
import { KanbanCard } from './KanbanCard'
import { KanbanHeader } from './KanbanHeader'
import { TicketModal } from './TicketModal'
import { TicketDetailModal } from './TicketDetailModal'
import type { BoardStatus } from './status-utils'
import type { Milestone, Project, Team, Ticket } from '@/payload-types'

const TICKETS_PER_PAGE = 20

interface ColumnPaginationInfo {
  page: number
  totalPages: number
  hasNextPage: boolean
  totalDocs: number
  loadedCount: number
}

type ColumnPaginationState = Record<string, ColumnPaginationInfo>

interface InitialColumnPagination {
  status: string
  page: number
  totalPages: number
  hasNextPage: boolean
  totalDocs: number
}

interface KanbanBoardProps {
  initialTickets: Ticket[]
  projects: Project[]
  /** People. The Payload slug is `teams` on purpose — see collections/TeamMembers.ts. */
  teams: Team[]
  statuses: BoardStatus[]
  milestones?: Milestone[]
  initialColumnPagination?: InitialColumnPagination[]
}

const EMPTY_PAGINATION: ColumnPaginationInfo = {
  page: 1,
  totalPages: 1,
  hasNextPage: false,
  totalDocs: 0,
  loadedCount: 0,
}

/** Does this ticket belong in this column? Orphans belong to the unknown column. */
function belongsToColumn(ticket: Ticket, column: BoardStatus, knownKeys: Set<string>): boolean {
  if (column.isUnknown) return !knownKeys.has(String(ticket.status))
  return ticket.status === column.key
}

function createInitialColumnPagination(
  initialTickets: Ticket[],
  statuses: BoardStatus[],
  knownKeys: Set<string>,
  initialColumnPagination?: InitialColumnPagination[],
): ColumnPaginationState {
  const state: ColumnPaginationState = {}
  const fromServer = new Map((initialColumnPagination ?? []).map((c) => [c.status, c]))

  for (const column of statuses) {
    const loadedCount = initialTickets.filter((t) => belongsToColumn(t, column, knownKeys)).length
    const server = fromServer.get(column.key)

    state[column.key] = server
      ? {
          page: server.page,
          totalPages: server.totalPages,
          hasNextPage: server.hasNextPage,
          totalDocs: server.totalDocs,
          loadedCount,
        }
      : {
          // No server pagination for this column: everything we have is everything there is.
          page: 1,
          totalPages: 1,
          hasNextPage: false,
          totalDocs: loadedCount,
          loadedCount,
        }
  }

  return state
}

export function KanbanBoard({
  initialTickets,
  projects,
  teams,
  statuses,
  milestones = [],
  initialColumnPagination,
}: KanbanBoardProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const [tickets, setTickets] = useState<Ticket[]>(initialTickets)
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null)

  // The real, writable statuses — the synthetic orphan column is not one of them.
  const realStatuses = useMemo(() => statuses.filter((s) => !s.isUnknown), [statuses])
  const knownKeys = useMemo(() => new Set(realStatuses.map((s) => s.key)), [realStatuses])
  const knownKeyList = useMemo(() => realStatuses.map((s) => s.key), [realStatuses])

  // Initialize from URL params
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    searchParams.get('project')
  )
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(
    searchParams.get('team')
  )

  // Sync URL when filters change
  const updateUrlParams = useCallback((projectId: string | null, teamId: string | null) => {
    const params = new URLSearchParams()
    if (projectId) params.set('project', projectId)
    if (teamId) params.set('team', teamId)
    const queryString = params.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
  }, [router, pathname])

  // Update URL when filters change
  const handleProjectChange = useCallback((projectId: string | null) => {
    setSelectedProjectId(projectId)
    updateUrlParams(projectId, selectedTeamId)
  }, [selectedTeamId, updateUrlParams])

  const handleTeamChange = useCallback((teamId: string | null) => {
    setSelectedTeamId(teamId)
    updateUrlParams(selectedProjectId, teamId)
  }, [selectedProjectId, updateUrlParams])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null)
  const [viewingTicket, setViewingTicket] = useState<Ticket | null>(null)

  // Pagination state per column, keyed by status key
  const [columnPagination, setColumnPagination] = useState<ColumnPaginationState>(
    () => createInitialColumnPagination(initialTickets, statuses, knownKeys, initialColumnPagination)
  )
  const [loadingColumns, setLoadingColumns] = useState<Record<string, boolean>>({})
  const [, setIsRefetching] = useState(false)

  const paginationFor = useCallback(
    (key: string): ColumnPaginationInfo => columnPagination[key] ?? EMPTY_PAGINATION,
    [columnPagination]
  )

  /**
   * One column's REST query. The orphan column is the inverse of every known key rather
   * than an equality match, so it stays correct as statuses are added or removed.
   */
  const buildColumnUrl = useCallback(
    (column: BoardStatus, page: number) => {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(TICKETS_PER_PAGE))
      params.set('depth', '2')
      params.set('sort', 'sortOrder')
      if (column.isUnknown) {
        params.set('where[status][not_in]', knownKeyList.join(','))
      } else {
        params.set('where[status][equals]', column.key)
      }
      if (selectedProjectId) params.set('where[project][equals]', selectedProjectId)
      if (selectedTeamId) params.set('where[team][equals]', selectedTeamId)
      return `/api/tickets?${params.toString()}`
    },
    [knownKeyList, selectedProjectId, selectedTeamId]
  )

  // Track if this is the initial mount to avoid refetching on first render
  const isInitialMount = useRef(true)

  // Refetch tickets when filters change
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }

    let cancelled = false

    const refetchTickets = async () => {
      setIsRefetching(true)
      try {
        // Fetch every column in parallel — however many the workspace has defined.
        const results = await Promise.all(
          statuses.map(async (column) => {
            const response = await fetch(buildColumnUrl(column, 1))
            return { column, data: await response.json() }
          })
        )

        if (cancelled) return

        setTickets(results.flatMap((r) => r.data.docs || []))

        const nextPagination: ColumnPaginationState = {}
        for (const { column, data } of results) {
          nextPagination[column.key] = {
            page: data.page ?? 1,
            totalPages: data.totalPages ?? 1,
            hasNextPage: data.hasNextPage ?? false,
            totalDocs: data.totalDocs ?? 0,
            loadedCount: data.docs?.length ?? 0,
          }
        }
        setColumnPagination(nextPagination)
      } catch (error) {
        console.error('Failed to refetch tickets:', error)
      } finally {
        if (!cancelled) setIsRefetching(false)
      }
    }

    refetchTickets()

    return () => {
      cancelled = true
    }
  }, [selectedProjectId, selectedTeamId, statuses, buildColumnUrl])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Load more tickets for a specific column
  const loadMoreTicketsForColumn = useCallback(async (column: BoardStatus) => {
    const colPag = columnPagination[column.key]
    if (!colPag?.hasNextPage || loadingColumns[column.key]) return

    setLoadingColumns(prev => ({ ...prev, [column.key]: true }))
    try {
      const nextPage = colPag.page + 1
      const response = await fetch(buildColumnUrl(column, nextPage))
      const data = await response.json()

      if (data.docs && data.docs.length > 0) {
        // Avoid duplicates by filtering out existing ticket IDs
        const existingIds = new Set(tickets.map(t => t.id))
        const newTickets = data.docs.filter((t: Ticket) => !existingIds.has(t.id))

        setTickets((prev) => [...prev, ...newTickets])
        setColumnPagination(prev => ({
          ...prev,
          [column.key]: {
            page: data.page,
            totalPages: data.totalPages,
            hasNextPage: data.hasNextPage,
            totalDocs: data.totalDocs,
            loadedCount: (prev[column.key]?.loadedCount ?? 0) + newTickets.length,
          },
        }))
      }
    } catch (error) {
      console.error(`Failed to load more tickets for ${column.key}:`, error)
    } finally {
      setLoadingColumns(prev => ({ ...prev, [column.key]: false }))
    }
  }, [buildColumnUrl, columnPagination, loadingColumns, tickets])

  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      if (selectedProjectId) {
        const projectId = typeof ticket.project === 'string' ? ticket.project : ticket.project?.id
        if (projectId !== selectedProjectId) return false
      }
      if (selectedTeamId) {
        const teamId = typeof ticket.team === 'string' ? ticket.team : ticket.team?.id
        if (teamId !== selectedTeamId) return false
      }
      return true
    })
  }, [tickets, selectedProjectId, selectedTeamId])

  const getTicketsForColumn = useCallback(
    (column: BoardStatus) => {
      return filteredTickets
        .filter((ticket) => belongsToColumn(ticket, column, knownKeys))
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    },
    [filteredTickets, knownKeys]
  )

  const handleDragStart = (event: DragStartEvent) => {
    const ticket = tickets.find((t) => t.id === event.active.id)
    setActiveTicket(ticket || null)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    const draggedTicket = tickets.find((t) => t.id === activeId)
    if (!draggedTicket) return

    // Check if we're over a column
    const overColumn = statuses.find((col) => col.key === overId)
    if (overColumn) {
      // Never move a ticket INTO the orphan column — it is a symptom, not a destination.
      if (overColumn.isUnknown) return
      if (draggedTicket.status !== overColumn.key) {
        setTickets((prev) =>
          prev.map((ticket) =>
            ticket.id === activeId ? { ...ticket, status: overColumn.key } : ticket
          )
        )
      }
      return
    }

    // We're over another ticket
    const overTicket = tickets.find((t) => t.id === overId)
    if (!overTicket) return

    // Hovering an orphan ticket must not adopt its unknown status.
    if (!knownKeys.has(String(overTicket.status))) return

    if (draggedTicket.status !== overTicket.status) {
      setTickets((prev) =>
        prev.map((ticket) =>
          ticket.id === activeId ? { ...ticket, status: overTicket.status } : ticket
        )
      )
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTicket(null)

    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    if (activeId === overId) return

    const draggedTicket = tickets.find((t) => t.id === activeId)
    if (!draggedTicket) return

    // Determine the target status
    let targetStatus = draggedTicket.status
    const overColumn = statuses.find((col) => col.key === overId)
    const isOverColumn = Boolean(overColumn)
    if (overColumn) {
      if (overColumn.isUnknown) return
      targetStatus = overColumn.key
    } else {
      const overTicket = tickets.find((t) => t.id === overId)
      if (overTicket) {
        if (!knownKeys.has(String(overTicket.status))) return
        targetStatus = overTicket.status
      }
    }

    // Get tickets in the target column
    const columnTickets = tickets.filter((t) => t.status === targetStatus)
    const oldIndex = columnTickets.findIndex((t) => t.id === activeId)
    const newIndex = isOverColumn
      ? columnTickets.length
      : columnTickets.findIndex((t) => t.id === overId)

    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      const reorderedTickets = arrayMove(columnTickets, oldIndex, newIndex)

      // Update sort order for all tickets in the column
      const updatedTickets = tickets.map((ticket) => {
        const reorderedIndex = reorderedTickets.findIndex((t) => t.id === ticket.id)
        if (reorderedIndex !== -1) {
          return { ...ticket, sortOrder: reorderedIndex, status: targetStatus }
        }
        return ticket
      })

      setTickets(updatedTickets)
    }

    // Update the ticket in the database
    try {
      await fetch(`/api/tickets/${activeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: targetStatus,
          sortOrder: columnTickets.findIndex((t) => t.id === overId) + 1,
        }),
      })
    } catch (error) {
      console.error('Failed to update ticket:', error)
    }
  }

  const handleCreateTicket = () => {
    setEditingTicket(null)
    setIsModalOpen(true)
  }

  const handleViewTicket = (ticket: Ticket) => {
    setViewingTicket(ticket)
  }

  const handleTicketSaved = (savedTicket: Ticket) => {
    if (editingTicket) {
      setTickets((prev) =>
        prev.map((t) => (t.id === savedTicket.id ? savedTicket : t))
      )
    } else {
      setTickets((prev) => [...prev, savedTicket])
    }
    setIsModalOpen(false)
    setEditingTicket(null)
  }

  const handleTicketUpdated = (updatedTicket: Ticket) => {
    setTickets((prev) =>
      prev.map((t) => (t.id === updatedTicket.id ? updatedTicket : t))
    )
    setViewingTicket(updatedTicket)
  }

  const handleDeleteTicket = async (ticketId: string) => {
    try {
      await fetch(`/api/tickets/${ticketId}`, { method: 'DELETE' })
      setTickets((prev) => prev.filter((t) => t.id !== ticketId))
    } catch (error) {
      console.error('Failed to delete ticket:', error)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <KanbanHeader
        projects={projects}
        teams={teams}
        selectedProjectId={selectedProjectId}
        selectedTeamId={selectedTeamId}
        onProjectChange={handleProjectChange}
        onTeamChange={handleTeamChange}
        onCreateTicket={handleCreateTicket}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 flex gap-4 p-6 overflow-x-auto">
          {statuses.map((column) => (
            <KanbanColumn
              key={column.key}
              id={column.key}
              title={column.label}
              color={column.color}
              isUnknown={column.isUnknown}
              tickets={getTicketsForColumn(column)}
              onViewTicket={handleViewTicket}
              onDeleteTicket={handleDeleteTicket}
              pagination={{
                hasNextPage: paginationFor(column.key).hasNextPage,
                totalDocs: paginationFor(column.key).totalDocs,
                loadedCount: paginationFor(column.key).loadedCount,
              }}
              isLoadingMore={loadingColumns[column.key] ?? false}
              onLoadMore={() => loadMoreTicketsForColumn(column)}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTicket ? <KanbanCard ticket={activeTicket} isOverlay /> : null}
        </DragOverlay>
      </DndContext>

      <TicketModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        ticket={editingTicket}
        projects={projects}
        teams={teams}
        statuses={realStatuses}
        milestones={milestones}
        allTickets={tickets}
        onSave={handleTicketSaved}
        defaultProjectId={selectedProjectId}
      />

      {viewingTicket && (
        <TicketDetailModal
          isOpen={!!viewingTicket}
          onClose={() => setViewingTicket(null)}
          ticket={viewingTicket}
          projects={projects}
          teams={teams}
          statuses={realStatuses}
          milestones={milestones}
          allTickets={tickets}
          onUpdate={handleTicketUpdated}
          onDelete={handleDeleteTicket}
        />
      )}
    </div>
  )
}
