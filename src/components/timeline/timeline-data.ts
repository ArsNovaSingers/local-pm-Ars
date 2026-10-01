import type { ScopeData } from '@/lib/scope'
import { initialsFor, type Person } from '@/components/tree/tree-model'
import type { Milestone, Project, Team, Ticket } from '@/payload-types'

function idOf(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in value) return String((value as { id: unknown }).id)
  return null
}

export interface TimelineClientData {
  tickets: Ticket[]
  projects: Array<{ id: string; name: string; prefix?: string; color?: string | null }>
  people: Person[]
  milestones: Array<{ id: string; name: string; date?: string | null; color?: string | null; project?: string | null }>
}

/**
 * Reduce a scope to the fields the Timeline reads, on the server. Populated Team Member
 * documents carry auth fields; only id / name / initials / colour ever reach the browser.
 * Mirrors the reduction the Tree page does so both views see identical tickets.
 */
export function toTimelineData(scope: ScopeData): TimelineClientData {
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

  return { tickets, projects, people, milestones }
}
