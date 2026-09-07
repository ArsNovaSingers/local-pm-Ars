import { getPayload } from 'payload'
import config from '@payload-config'
import { getScopeData } from '@/lib/scope'
import { ViewPlaceholder } from '@/components/views/ViewPlaceholder'

export const dynamic = 'force-dynamic'

interface NetworkPageProps {
  searchParams: Promise<{ project?: string; team?: string; milestone?: string }>
}

export default async function NetworkPage({ searchParams }: NetworkPageProps) {
  const params = await searchParams
  const payload = await getPayload({ config })
  const scope = await getScopeData(payload, {
    projectId: params.project || null,
    teamId: params.team || null,
    milestoneId: params.milestone || null,
  })

  const tickets = scope.tickets as Array<{ blockedBy?: unknown[] }>
  const edges = tickets.reduce((sum, t) => sum + (Array.isArray(t.blockedBy) ? t.blockedBy.length : 0), 0)
  const connected = new Set<string>()
  for (const t of scope.tickets as Array<{ id: string; blockedBy?: unknown[] }>) {
    if (Array.isArray(t.blockedBy) && t.blockedBy.length) {
      connected.add(String(t.id))
      for (const b of t.blockedBy) {
        connected.add(String(typeof b === 'object' && b && 'id' in b ? (b as { id: unknown }).id : b))
      }
    }
  }

  return (
    <ViewPlaceholder
      title="Network"
      phase="Phase 3"
      summary="The dependency structure on one canvas — what is ready, what is genuinely blocked, and the critical path to a milestone."
      scope={scope}
      stats={[
        { label: 'Dependency edges', value: edges },
        { label: 'Connected tickets', value: connected.size },
        { label: 'Unconnected', value: tickets.length - connected.size },
      ]}
      note={
        edges === 0
          ? 'No dependencies recorded in this scope yet. The canvas is built, but a graph needs edges — dependency capture (drag-to-link, and the link_tickets MCP tool shipped in this release) comes first.'
          : `${edges} dependency edge${edges === 1 ? '' : 's'} recorded. Unconnected tickets will sit in a side tray rather than floating on the canvas.`
      }
    />
  )
}
