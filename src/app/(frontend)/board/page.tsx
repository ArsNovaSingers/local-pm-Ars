import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import {
  UNKNOWN_STATUS_KEY,
  toBoardStatuses,
  type BoardStatus,
} from '@/components/kanban/status-utils'
import { getPayload } from 'payload'
import config from '@payload-config'
import { DEFAULT_STATUS_COLOR } from '@/types/enums'
import type { Where } from 'payload'

export const dynamic = 'force-dynamic'

const TICKETS_PER_COLUMN = 20

interface BoardPageProps {
  searchParams: Promise<{ project?: string; team?: string }>
}

export default async function BoardPage({ searchParams }: BoardPageProps) {
  const params = await searchParams
  const projectFilter = params.project || null
  const teamFilter = params.team || null

  const payload = await getPayload({ config })

  /**
   * Columns come from the `statuses` collection, not from a hardcoded list, so a
   * workspace can run whatever workflow it actually has. `toBoardStatuses` falls back to
   * the seeded defaults when the collection is EMPTY — a deployment where the Phase 0
   * migration has not run yet must still render a usable board rather than no columns.
   */
  const statusResult = await payload.find({
    collection: 'statuses',
    limit: 200,
    depth: 0,
    sort: 'order',
  })

  const statuses = toBoardStatuses(statusResult.docs as unknown as Array<Record<string, unknown>>)
  const knownKeys = statuses.map((s) => s.key)

  const withFilters = (conditions: Where): Where => {
    if (projectFilter) conditions.project = { equals: projectFilter }
    // The Payload slug stays `teams` on purpose — see collections/TeamMembers.ts. This
    // filters by Assignee (a person), not by a group.
    if (teamFilter) conditions.team = { equals: teamFilter }
    return conditions
  }

  const findColumn = (where: Where) =>
    payload.find({
      collection: 'tickets',
      limit: TICKETS_PER_COLUMN,
      page: 1,
      sort: 'sortOrder',
      depth: 2,
      where,
    })

  /**
   * A ticket whose status matches no status row must not vanish — the work still exists.
   * `not_in` finds them and they get a trailing column of their own where they are
   * visible and can be dragged somewhere real.
   */
  const [columnResults, orphanResult, projectsResult, teamsResult, milestonesResult] =
    await Promise.all([
      Promise.all(statuses.map((s) => findColumn(withFilters({ status: { equals: s.key } })))),
      findColumn(withFilters({ status: { not_in: knownKeys } })),
      payload.find({ collection: 'projects', limit: 100 }),
      // Slug is `teams`; the concept is a Team Member. Deliberate — see TeamMembers.ts.
      payload.find({ collection: 'teams', limit: 100 }),
      payload.find({ collection: 'milestones', limit: 200, sort: 'date', depth: 0 }),
    ])

  const columns: BoardStatus[] = [...statuses]
  const results = [...columnResults]

  if (orphanResult.totalDocs > 0) {
    columns.push({
      key: UNKNOWN_STATUS_KEY,
      label: 'Unknown status',
      color: DEFAULT_STATUS_COLOR,
      order: statuses.length,
      isUnknown: true,
    })
    results.push(orphanResult)
  }

  const initialTickets = results.flatMap((result) => result.docs)

  // Per-column pagination — 20 per column, each column paged independently. The infinite
  // scroll on the client depends on this shape.
  const initialColumnPagination = columns.map((column, index) => ({
    status: column.key,
    page: results[index].page ?? 1,
    totalPages: results[index].totalPages,
    hasNextPage: results[index].hasNextPage,
    totalDocs: results[index].totalDocs,
  }))

  return (
    <KanbanBoard
      initialTickets={initialTickets}
      projects={projectsResult.docs}
      teams={teamsResult.docs}
      statuses={columns}
      milestones={milestonesResult.docs}
      initialColumnPagination={initialColumnPagination}
    />
  )
}
