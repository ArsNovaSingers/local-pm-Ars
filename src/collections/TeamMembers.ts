import type { CollectionConfig } from 'payload'
import { collectionAccess } from '@/lib/access'
import { TEAM_MEMBER_ROLE_OPTIONS, TeamMemberRole } from '@/types/enums'

/**
 * People who do the work.
 *
 * ⚠️ THE SLUG IS `teams` ON PURPOSE. The concept is a person; the collection is named
 * `teams` for compatibility. Renaming the slug would mean a Mongo collection rename, a
 * rewrite of every `relationTo: 'teams'` reference, new REST paths, and renaming six
 * live MCP tools that existing connector sessions are bound to — an outage to change a
 * word nobody sees. Every human-visible label says "Team Member". This gap is
 * deliberate and documented rather than accidental.
 *
 * This collection is auth-enabled, which is what lets Local PM run anywhere rather than
 * only behind a network-level gate such as IAP, and what gives every write an
 * attributable actor. `useAPIKey` gives agents their own revocable identity instead of
 * one shared token for every caller.
 */
export const TeamMembers: CollectionConfig = {
  slug: 'teams',
  labels: { singular: 'Team Member', plural: 'Team Members' },
  auth: {
    useAPIKey: true,
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'email', 'role', 'active'],
    description:
      'People who do the work. Stored under the slug "teams" for compatibility — the concept is a person, not a group.',
  },
  access: collectionAccess,
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'Display name, e.g. Kimberly Brody' },
    },
    {
      name: 'initials',
      type: 'text',
      maxLength: 3,
      admin: { description: 'Up to 3 characters for compact avatars. Derived from the name when empty.' },
    },
    {
      name: 'role',
      type: 'select',
      options: TEAM_MEMBER_ROLE_OPTIONS,
      defaultValue: TeamMemberRole.MEMBER,
      required: true,
      admin: {
        description:
          'admin can delete; member is an ordinary person; agent is an automated caller and should hold an API key rather than a password.',
      },
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      admin: { description: 'Inactive members keep their history but drop out of assignment pickers' },
    },
    { name: 'color', type: 'text', defaultValue: '#6366f1' },
    { name: 'description', type: 'textarea' },
  ],
  hooks: {
    beforeChange: [
      ({ data }) => {
        if (data && !data.initials && typeof data.name === 'string' && data.name.trim()) {
          const parts = data.name.trim().split(/\s+/)
          data.initials = (parts.length === 1
            ? parts[0].slice(0, 2)
            : parts[0][0] + parts[parts.length - 1][0]
          ).toUpperCase()
        }
        return data
      },
    ],
  },
  timestamps: true,
}
