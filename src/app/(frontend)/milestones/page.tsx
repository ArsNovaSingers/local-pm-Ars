import { MilestonesList } from '@/components/milestones/MilestonesList'
import { getPayload } from 'payload'
import config from '@payload-config'

export const dynamic = 'force-dynamic'

export default async function MilestonesPage() {
  const payload = await getPayload({ config })

  const [milestonesResult, projectsResult, ticketsResult] = await Promise.all([
    payload.find({ collection: 'milestones', limit: 200, sort: 'date', depth: 1 }),
    payload.find({ collection: 'projects', limit: 200, depth: 0 }),
    payload.find({ collection: 'tickets', limit: 1000, depth: 0 }),
  ])

  // How much work points at each milestone — the number that says whether a date is
  // real or decorative.
  const counts: Record<string, number> = {}
  for (const ticket of ticketsResult.docs) {
    const raw = (ticket as { milestone?: unknown }).milestone
    if (!raw) continue
    const id = String(typeof raw === 'object' && raw && 'id' in raw ? (raw as { id: unknown }).id : raw)
    counts[id] = (counts[id] || 0) + 1
  }

  return (
    <MilestonesList
      initialMilestones={milestonesResult.docs}
      projects={projectsResult.docs}
      ticketCounts={counts}
    />
  )
}
