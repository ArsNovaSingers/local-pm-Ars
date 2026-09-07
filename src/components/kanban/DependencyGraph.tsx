'use client'

import { useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, Circle, Ban, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { Ticket } from '@/payload-types'
import { type BoardStatus, fallbackStatuses, isDoneStatus, statusColor } from './status-utils'

interface DependencyGraphProps {
  ticket: Ticket
  allTickets: Ticket[]
  /**
   * Workflow states. "Finished" is whatever this workspace flagged `isDone` — the graph
   * used to test `status === 'DONE'`, which quietly called every custom state unfinished.
   */
  statuses?: BoardStatus[]
  onTicketClick?: (ticket: Ticket) => void
}

interface GraphNode {
  ticket: Ticket
  x: number
  y: number
  level: number
  type: 'blocker' | 'current' | 'blocked'
}

interface GraphEdge {
  from: GraphNode
  to: GraphNode
}

export function DependencyGraph({ ticket, allTickets, statuses, onTicketClick }: DependencyGraphProps) {
  const [zoom, setZoom] = useState(1)
  const statusList = statuses?.length ? statuses : fallbackStatuses()
  const done = (t: Ticket) => isDoneStatus(statusList, t.status)

  // Build the dependency graph
  const { nodes, edges, hasGraph } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>()
    const edges: GraphEdge[] = []

    // Get blocking tickets (blockers of current ticket)
    const blockerIds = (ticket.blockedBy || []).map(t => typeof t === 'string' ? t : t.id)
    const blockers = blockerIds
      .map(id => allTickets.find(t => t.id === id))
      .filter((t): t is Ticket => t !== undefined)

    // Get blocked tickets (tickets that are blocked by current ticket)
    const blockedTickets = allTickets.filter(t => {
      const blockedByIds = (t.blockedBy || []).map(b => typeof b === 'string' ? b : b.id)
      return blockedByIds.includes(ticket.id)
    })

    // No graph if no dependencies
    if (blockers.length === 0 && blockedTickets.length === 0) {
      return { nodes: [], edges: [], hasGraph: false }
    }

    // Layout constants
    const nodeWidth = 180
    const nodeHeight = 60
    const levelGap = 100
    const nodeGap = 20

    // Add blocker nodes (level 0)
    blockers.forEach((blocker, i) => {
      const node: GraphNode = {
        ticket: blocker,
        x: i * (nodeWidth + nodeGap),
        y: 0,
        level: 0,
        type: 'blocker'
      }
      nodeMap.set(blocker.id, node)
    })

    // Add current ticket node (level 1)
    const blockersTotalWidth = blockers.length * (nodeWidth + nodeGap) - nodeGap
    const blockedTotalWidth = blockedTickets.length * (nodeWidth + nodeGap) - nodeGap
    const maxWidth = Math.max(blockersTotalWidth, blockedTotalWidth, nodeWidth)

    const currentNode: GraphNode = {
      ticket,
      x: (maxWidth - nodeWidth) / 2,
      y: blockers.length > 0 ? nodeHeight + levelGap : 0,
      level: 1,
      type: 'current'
    }
    nodeMap.set(ticket.id, currentNode)

    // Add blocked nodes (level 2)
    const blockedStartX = (maxWidth - blockedTotalWidth) / 2
    blockedTickets.forEach((blocked, i) => {
      const node: GraphNode = {
        ticket: blocked,
        x: blockedStartX + i * (nodeWidth + nodeGap),
        y: currentNode.y + nodeHeight + levelGap,
        level: 2,
        type: 'blocked'
      }
      nodeMap.set(blocked.id, node)
    })

    // Center blocker nodes
    if (blockers.length > 0) {
      const blockerStartX = (maxWidth - blockersTotalWidth) / 2
      blockers.forEach((blocker, i) => {
        const node = nodeMap.get(blocker.id)!
        node.x = blockerStartX + i * (nodeWidth + nodeGap)
      })
    }

    // Create edges from blockers to current
    blockers.forEach(blocker => {
      const fromNode = nodeMap.get(blocker.id)!
      edges.push({ from: fromNode, to: currentNode })
    })

    // Create edges from current to blocked
    blockedTickets.forEach(blocked => {
      const toNode = nodeMap.get(blocked.id)!
      edges.push({ from: currentNode, to: toNode })
    })

    return {
      nodes: Array.from(nodeMap.values()),
      edges,
      hasGraph: true
    }
  }, [ticket, allTickets])

  if (!hasGraph) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground bg-secondary/10 rounded-xl border border-border/40 border-dashed">
        <Circle className="w-10 h-10 mb-3 opacity-20" />
        <p className="text-sm font-medium">No dependencies for this ticket</p>
      </div>
    )
  }

  // Calculate SVG dimensions
  const padding = 40
  const nodeWidth = 180
  const nodeHeight = 60
  const maxX = Math.max(...nodes.map(n => n.x)) + nodeWidth + padding * 2
  const maxY = Math.max(...nodes.map(n => n.y)) + nodeHeight + padding * 2

  const getStatusColor = (status: unknown) => ({ bg: statusColor(statusList, status) })

  const getNodeBorderColor = (node: GraphNode) => {
    if (node.type === 'current') return '#6366f1' // Primary
    if (done(node.ticket)) return '#22c55e' // Success
    return '#f59e0b' // Warning/Amber
  }

  return (
    <div className="relative group">
      {/* Zoom controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1 z-10 bg-card border border-border/50 rounded-lg p-1 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
          className="p-1.5 hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-foreground"
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-xs font-medium text-muted-foreground px-1 min-w-[32px] text-center">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom(z => Math.min(1.5, z + 0.1))}
          className="p-1.5 hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-foreground"
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
      </div>

      {/* Legend */}
      <div className="absolute top-3 left-3 flex items-center gap-4 z-10 text-xs font-medium text-muted-foreground bg-card/50 backdrop-blur-sm px-3 py-1.5 rounded-full border border-border/30">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          <span>Blocking</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-primary" />
          <span>Current</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>Done</span>
        </div>
      </div>

      {/* Graph */}
      <div className="overflow-auto max-h-[400px] mt-2 bg-secondary/10 rounded-xl border border-border/40 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
        <svg
          width={maxX * zoom}
          height={maxY * zoom}
          viewBox={`0 0 ${maxX} ${maxY}`}
          className="min-w-full"
        >
          <defs>
            {/* Arrow marker */}
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                fill="#71717a"
              />
            </marker>
            <marker
              id="arrowhead-green"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                fill="#22c55e"
              />
            </marker>
          </defs>

          {/* Edges */}
          {edges.map((edge, i) => {
            const fromX = edge.from.x + padding + nodeWidth / 2
            const fromY = edge.from.y + padding + nodeHeight
            const toX = edge.to.x + padding + nodeWidth / 2
            const toY = edge.to.y + padding

            const isDone = done(edge.from.ticket)
            const midY = (fromY + toY) / 2

            return (
              <g key={i}>
                {/* Curved path */}
                <path
                  d={`M ${fromX} ${fromY}
                      C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY - 10}`}
                  fill="none"
                  stroke={isDone ? '#22c55e' : '#52525b'}
                  strokeWidth="2"
                  strokeDasharray={isDone ? 'none' : '5,5'}
                  markerEnd={isDone ? 'url(#arrowhead-green)' : 'url(#arrowhead)'}
                  className="transition-all duration-300"
                />
              </g>
            )
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const project = typeof node.ticket.project === 'object' ? node.ticket.project : null
            const statusColors = getStatusColor(node.ticket.status)
            const borderColor = getNodeBorderColor(node)
            const isClickable = node.type !== 'current' && onTicketClick

            return (
              <g
                key={node.ticket.id}
                transform={`translate(${node.x + padding}, ${node.y + padding})`}
                onClick={() => isClickable && onTicketClick?.(node.ticket)}
                className={isClickable ? 'cursor-pointer' : ''}
              >
                {/* Node background */}
                <rect
                  x="0"
                  y="0"
                  width={nodeWidth}
                  height={nodeHeight}
                  rx="10"
                  fill="#18181b"
                  stroke={borderColor}
                  strokeWidth={node.type === 'current' ? '2.5' : '1.5'}
                  className={`${isClickable ? 'hover:brightness-110 transition-all' : ''} drop-shadow-lg`}
                />

                {/* Status indicator */}
                <circle
                  cx="16"
                  cy={nodeHeight / 2}
                  r="4"
                  fill={statusColors.bg}
                />
                {done(node.ticket) && (
                  <path
                    d="M13 30 L15 32 L19 28"
                    stroke="white"
                    strokeWidth="1.5"
                    fill="none"
                    transform={`translate(-1, ${nodeHeight / 2 - 30}) scale(0.9)`}
                  />
                )}

                {/* Ticket ID */}
                <text
                  x="28"
                  y="20"
                  fontSize="10"
                  fontWeight="600"
                  fill={project?.color as string || '#a1a1aa'}
                  style={{ fontFamily: 'var(--font-inter), sans-serif' }}
                >
                  {node.ticket.ticketId}
                </text>

                {/* Title (truncated) */}
                <text
                  x="28"
                  y="36"
                  fontSize="11"
                  fill="#fafafa"
                  className="font-medium"
                  style={{ fontFamily: 'var(--font-inter), sans-serif' }}
                >
                  {node.ticket.title.length > 20
                    ? node.ticket.title.substring(0, 19) + '...'
                    : node.ticket.title}
                </text>

                {/* Type indicator for current node */}
                {node.type === 'current' && (
                  <g transform={`translate(${nodeWidth - 18}, 10)`}>
                    <circle r="3" fill="#6366f1" />
                  </g>
                )}

                {/* Blocked indicator */}
                {node.type === 'blocked' && !done(node.ticket) && (
                  <g transform={`translate(${nodeWidth - 38}, ${nodeHeight - 16})`}>
                    <rect
                      x="0"
                      y="0"
                      width="30"
                      height="12"
                      rx="3"
                      fill="#f59e0b20"
                    />
                    <text x="15" y="8" fontSize="8" fill="#f59e0b" textAnchor="middle" dominantBaseline="middle">
                      blocked
                    </text>
                  </g>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
