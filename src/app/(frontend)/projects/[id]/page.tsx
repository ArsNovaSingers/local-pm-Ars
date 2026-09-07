import { ProjectDetail } from '@/components/projects/ProjectDetail'
import { getPayload } from 'payload'
import config from '@payload-config'
import { notFound } from 'next/navigation'
import { toBoardStatuses } from '@/components/kanban/status-utils'

export const dynamic = 'force-dynamic'

interface ProjectPageProps {
  params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params
  const payload = await getPayload({ config })

  try {
    const project = await payload.findByID({
      collection: 'projects',
      id,
      depth: 0,
    })

    if (!project) {
      notFound()
    }

    // Get tickets for this project
    const ticketsResult = await payload.find({
      collection: 'tickets',
      where: {
        project: { equals: id },
      },
      limit: 1000,
      depth: 1,
    })

    // Team Members for the Assignee dropdown. The slug is still `teams` on purpose —
    // see collections/TeamMembers.ts.
    const teamsResult = await payload.find({
      collection: 'teams',
      limit: 100,
    })

    // Workflow states are configurable, so the project's ticket breakdown is built
    // from the workspace's own states rather than an assumed Todo/In Progress/Done.
    const statusesResult = await payload.find({
      collection: 'statuses',
      limit: 200,
      depth: 0,
      sort: 'order',
    })

    return (
      <ProjectDetail
        project={project}
        tickets={ticketsResult.docs}
        teams={teamsResult.docs}
        statuses={toBoardStatuses(statusesResult.docs)}
      />
    )
  } catch {
    notFound()
  }
}
