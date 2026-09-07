import type { Payload, Where } from 'payload'

/**
 * One fetch of EVERY ticket in the current filter scope.
 *
 * The Kanban board pages 20 tickets per column, which is right for a board and wrong
 * for anything that draws the whole picture. A timeline missing a third of its bars, or
 * a dependency graph missing the node in the middle of a chain, is not a partial answer
 * — it is a misleading one. Both new views therefore read through here.
 *
 * The cap exists so that a very large workspace degrades visibly rather than silently:
 * `truncated` is surfaced in the UI rather than swallowed.
 */
export const SCOPE_LIMIT = 500

export interface ScopeFilters {
  projectId?: string | null
  teamId?: string | null
  milestoneId?: string | null
}

export interface ScopeData {
  tickets: unknown[]
  projects: unknown[]
  teamMembers: unknown[]
  statuses: unknown[]
  milestones: unknown[]
  truncated: boolean
  totalInScope: number
  limit: number
}

export function buildScopeWhere(filters: ScopeFilters): Where {
  const where: Where = {}
  if (filters.projectId) where.project = { equals: filters.projectId }
  if (filters.teamId) where.team = { equals: filters.teamId }
  if (filters.milestoneId) where.milestone = { equals: filters.milestoneId }
  return where
}

export async function getScopeData(payload: Payload, filters: ScopeFilters = {}): Promise<ScopeData> {
  const where = buildScopeWhere(filters)

  const [ticketResult, projects, teamMembers, statuses, milestones] = await Promise.all([
    payload.find({
      collection: 'tickets',
      where,
      limit: SCOPE_LIMIT,
      page: 1,
      depth: 1,
      sort: 'sortOrder',
    }),
    payload.find({ collection: 'projects', limit: 200, depth: 0 }),
    payload.find({ collection: 'teams', limit: 200, depth: 0 }),
    payload.find({ collection: 'statuses', limit: 200, depth: 0, sort: 'order' }),
    payload.find({ collection: 'milestones', limit: 200, depth: 0, sort: 'date' }),
  ])

  return {
    tickets: ticketResult.docs,
    projects: projects.docs,
    teamMembers: teamMembers.docs,
    statuses: statuses.docs,
    milestones: milestones.docs,
    truncated: ticketResult.totalDocs > SCOPE_LIMIT,
    totalInScope: ticketResult.totalDocs,
    limit: SCOPE_LIMIT,
  }
}
