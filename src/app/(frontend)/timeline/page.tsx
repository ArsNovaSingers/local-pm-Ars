import { getPayload } from 'payload'
import config from '@payload-config'
import { getScopeData } from '@/lib/scope'
import { toBoardStatuses } from '@/components/kanban/status-utils'
import { TimelineView } from '@/components/timeline/TimelineView'
import { toTimelineData } from '@/components/timeline/timeline-data'

export const dynamic = 'force-dynamic'

interface TimelinePageProps {
  searchParams: Promise<{ project?: string; team?: string; milestone?: string }>
}

/**
 * Timeline: the filtered scope on a date axis. Bars for start + due, diamonds for due-only
 * tickets, milestone lines across every lane, and an undated tray per lane whose items can
 * be dragged onto the chart to give them a due date.
 */
export default async function TimelinePage({ searchParams }: TimelinePageProps) {
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
  const data = toTimelineData(scope)

  return (
    <TimelineView
      {...data}
      statuses={toBoardStatuses(scope.statuses)}
      truncated={scope.truncated}
      totalInScope={scope.totalInScope}
      limit={scope.limit}
      filters={filters}
    />
  )
}
