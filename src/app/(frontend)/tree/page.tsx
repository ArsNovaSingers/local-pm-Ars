import { getPayload } from 'payload'
import config from '@payload-config'
import { getScopeData } from '@/lib/scope'
import { toBoardStatuses } from '@/components/kanban/status-utils'
import { TreeView } from '@/components/tree/TreeView'
import { initialsFor, type Person } from '@/components/tree/tree-model'
import type { Milestone, Project, Team, Ticket } from '@/payload-types'

export const dynamic = 'force-dynamic'

interface TreePageProps {
  searchParams: Promise<{ project?: string; team?: string; milestone?: string }>
}

function idOf(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in value) return String((value as { id: unknown }).id)
  return null
}

/**
 * Tree / dependency view: the whole filtered scope as a collapsible map. Data comes from
 * the same getScopeData() the other whole-picture views use; everything handed to the
 * client is reduced to the fields the view reads, so populated Team Member documents
 * (which carry auth fields) never reach the browser.
 */
export default async function TreePage({ searchParams }: TreePageProps) {
  const params = await searchParams
  const filters = {
    project: params.project || null,
    team: params.team || null,
    milestone: params.milestone || null,
  }
  const payload = await getPayload({ config })
  const scope = await getScopeData(payload, {
    projectId: filters.project,
    teamId: filters.team,
    milestoneId: filters.milestone,
  })

  const people: Person[] = (scope.teamMembers as Team[]).map((m) => ({
    id: m.id,
    name: m.name,
    initials: m.initials || initialsFor(m.name),
    color: m.color ?? null,
  }))
  const peopleById = new Map(people.map((p) => [p.id, p]))

  const projects = (scope.projects as Project[]).map((p) => ({
    id: p.id,
    name: p.name,
    prefix: p.prefix,
    color: p.color ?? null,
  }))
  const projectsById = new Map(projects.map((p) => [p.id, p]))

  const milestones = (scope.milestones as Milestone[]).map((m) => ({
    id: m.id,
    name: m.name,
    date: m.date,
    color: m.color ?? null,
    project: idOf(m.project),
  }))
  const milestonesById = new Map(milestones.map((m) => [m.id, m]))

  const tickets = (scope.tickets as Ticket[]).map((t) => {
    const teamId = idOf(t.team)
    const projectId = idOf(t.project)
    const milestoneId = idOf(t.milestone)
    return {
      id: t.id,
      ticketId: t.ticketId ?? null,
      title: t.title,
      description: t.description ?? null,
      status: t.status,
      priority: t.priority ?? null,
      project: (projectId && projectsById.get(projectId)) || projectId || '',
      team: teamId ? (peopleById.get(teamId) ?? teamId) : null,
      milestone: milestoneId ? (milestonesById.get(milestoneId) ?? milestoneId) : null,
      blockedBy: (t.blockedBy ?? []).map((b) =>
        typeof b === 'string'
          ? b
          : { id: b.id, ticketId: b.ticketId ?? null, title: b.title, status: b.status, project: idOf(b.project) },
      ),
      labels: t.labels ?? [],
      startDate: t.startDate ?? null,
      dueDate: t.dueDate ?? null,
      subtasks: t.subtasks ?? [],
      sortOrder: t.sortOrder ?? 0,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    } as unknown as Ticket
  })

  return (
    <TreeView
      tickets={tickets}
      projects={projects}
      people={people}
      milestones={milestones}
      statuses={toBoardStatuses(scope.statuses)}
      truncated={scope.truncated}
      totalInScope={scope.totalInScope}
      limit={scope.limit}
      filters={filters}
    />
  )
}
