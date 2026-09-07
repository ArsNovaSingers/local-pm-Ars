import { getPayload } from 'payload'
import config from '@payload-config'
import { getScopeData } from '@/lib/scope'
import { ViewPlaceholder } from '@/components/views/ViewPlaceholder'

export const dynamic = 'force-dynamic'

interface TimelinePageProps {
  searchParams: Promise<{ project?: string; team?: string; milestone?: string }>
}

export default async function TimelinePage({ searchParams }: TimelinePageProps) {
  const params = await searchParams
  const payload = await getPayload({ config })
  const scope = await getScopeData(payload, {
    projectId: params.project || null,
    teamId: params.team || null,
    milestoneId: params.milestone || null,
  })

  const tickets = scope.tickets as Array<{ startDate?: string | null; dueDate?: string | null }>
  const bars = tickets.filter((t) => t.startDate && t.dueDate).length
  const diamonds = tickets.filter((t) => !t.startDate && t.dueDate).length
  const unscheduled = tickets.length - bars - diamonds

  return (
    <ViewPlaceholder
      title="Timeline"
      phase="Phase 1"
      summary="Tasks laid out on a date axis — schedules, durations, dependency arrows and milestone markers."
      scope={scope}
      stats={[
        { label: 'Bars (start + due)', value: bars },
        { label: 'Milestones (due only)', value: diamonds },
        { label: 'Unscheduled', value: unscheduled },
        { label: 'Milestones defined', value: scope.milestones.length },
      ]}
      note={
        unscheduled > 0
          ? `${unscheduled} of ${tickets.length} tickets in this scope have no dates. The timeline will show them in an "Unscheduled" tray you can drag onto the chart — that drag is what puts real dates into the store.`
          : 'Every ticket in this scope carries dates.'
      }
    />
  )
}
