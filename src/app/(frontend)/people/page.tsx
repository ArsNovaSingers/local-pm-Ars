import { TeamMembersList } from '@/components/people/TeamMembersList'
import { getPayload } from 'payload'
import config from '@payload-config'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

export default async function PeoplePage() {
  const payload = await getPayload({ config })

  /**
   * The Payload slug is still `teams` on purpose — it holds people now, and renaming the
   * slug would mean a database rename, new REST paths and renamed MCP tools for a word
   * nobody sees. See collections/TeamMembers.ts. Only the route and the labels changed.
   */
  const teamMembersResult = await payload.find({
    collection: 'teams',
    limit: PAGE_SIZE,
    page: 1,
    sort: '-createdAt',
  })

  return (
    <TeamMembersList
      initialTeamMembers={teamMembersResult.docs}
      initialPagination={{
        page: teamMembersResult.page ?? 1,
        totalPages: teamMembersResult.totalPages,
        hasNextPage: teamMembersResult.hasNextPage,
      }}
    />
  )
}
