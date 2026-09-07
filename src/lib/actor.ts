import type { CollectionBeforeChangeHook } from 'payload'

/**
 * Stamp every write with the Team Member who made it.
 *
 * Without this, a store written to by several agents, three scheduled sweeps and four
 * humans through one shared credential has no way to answer "who changed this?" — which
 * is the question that matters most once automated callers can edit the plan.
 *
 * `req.user` is populated by Payload auth. Calls that arrive without a user (for
 * example an MCP server authenticating at the network edge rather than as a Payload
 * user) leave the field untouched rather than inventing an actor.
 */
export const stampActor: CollectionBeforeChangeHook = ({ data, req, operation }) => {
  const userId = (req.user as { id?: string } | undefined)?.id
  if (!userId) return data
  if (operation === 'create') data.createdBy = userId
  data.updatedBy = userId
  return data
}

export const actorFields = [
  {
    name: 'createdBy',
    type: 'relationship' as const,
    relationTo: 'teams' as const,
    admin: {
      readOnly: true,
      position: 'sidebar' as const,
      description: 'The Team Member who created this. Empty for records written before actor tracking, or by an unauthenticated caller.',
    },
  },
  {
    name: 'updatedBy',
    type: 'relationship' as const,
    relationTo: 'teams' as const,
    admin: {
      readOnly: true,
      position: 'sidebar' as const,
      description: 'The Team Member who last changed this.',
    },
  },
]
