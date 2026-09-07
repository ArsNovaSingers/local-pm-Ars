'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Loader2, ChevronDown, Plus } from 'lucide-react'
import { KanbanCard } from './KanbanCard'
import { DEFAULT_STATUS_COLOR } from '@/types/enums'
import type { Ticket } from '@/payload-types'

interface ColumnPaginationInfo {
  hasNextPage: boolean
  totalDocs: number
  loadedCount: number
}

interface KanbanColumnProps {
  /** A status `key` from the `statuses` collection — a plain string, never an enum. */
  id: string
  title: string
  /** Authoritative colour comes from the status row. */
  color?: string
  /** The synthetic column holding tickets whose status matches no status row. */
  isUnknown?: boolean
  tickets: Ticket[]
  onViewTicket: (ticket: Ticket) => void
  onDeleteTicket?: (ticketId: string) => void
  pagination?: ColumnPaginationInfo
  isLoadingMore?: boolean
  onLoadMore?: () => void
}

export function KanbanColumn({
  id,
  title,
  color,
  isUnknown = false,
  tickets,
  onViewTicket,
  onDeleteTicket,
  pagination,
  isLoadingMore = false,
  onLoadMore,
}: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({
    id,
  })

  // The status row owns its colour; the shared default is only a fallback.
  const statusColor = color || DEFAULT_STATUS_COLOR

  return (
    <div className="flex flex-col w-80 flex-shrink-0 max-h-full">
      {/* Column Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColor }} />
          <h2 className="font-semibold text-sm text-foreground uppercase tracking-wide">{title}</h2>
          {isUnknown && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-500"
              title="These tickets carry a status that no longer exists in the Statuses collection. Drag them into a real column to fix them."
            >
              needs fixing
            </span>
          )}
          <span className="ml-1 px-1.5 py-0.5 rounded-md bg-secondary/60 text-xs font-medium text-muted-foreground">
            {pagination ? `${pagination.totalDocs}` : tickets.length}
          </span>
        </div>
      </div>

      {/* Droppable Area */}
      <div
        ref={setNodeRef}
        className="flex-1 overflow-y-auto bg-muted/10 rounded-xl px-2 py-2 border border-border/20 shadow-inner"
      >
        <div className="flex flex-col gap-3 min-h-[100px] p-1">
          <SortableContext
            items={tickets.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {tickets.map((ticket) => (
              <KanbanCard
                key={ticket.id}
                ticket={ticket}
                onClick={() => onViewTicket(ticket)}
                onDelete={onDeleteTicket ? () => onDeleteTicket(ticket.id) : undefined}
              />
            ))}
          </SortableContext>
        </div>

        {/* Load More Trigger */}
        {pagination?.hasNextPage && (
          <div className="p-3 mt-2 flex justify-center">
            <button
              onClick={onLoadMore}
              disabled={isLoadingMore}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all disabled:opacity-50"
            >
              {isLoadingMore ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
              {isLoadingMore ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}

        {/* Empty state hint */}
        {!pagination?.hasNextPage && tickets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground opacity-40">
            <div className="w-12 h-12 rounded-full border-2 border-dashed border-current flex items-center justify-center mb-2">
              <Plus className="w-5 h-5" />
            </div>
            <p className="text-xs font-medium">No tickets</p>
          </div>
        )}
      </div>
    </div>
  )
}
