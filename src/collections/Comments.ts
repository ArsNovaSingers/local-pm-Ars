import type { Access, CollectionConfig } from 'payload'
import { readAccess, writeAccess, requireAuthEnabled } from '@/lib/access'

/**
 * A conversation thread per ticket.
 *
 * Before this, the only place to write on a ticket was its description, so updates overwrote
 * each other and nobody could tell who said what. The author is always the signed-in Team
 * Member — set on the server, never taken from the request body — so "Kim: venue confirmed"
 * really was Kim.
 */

/** Authors may edit their own comment; admins may edit any. Open when auth is off. */
const ownOrAdmin: Access = ({ req }) => {
  if (!requireAuthEnabled() && !req.user) return true
  const user = req.user as { id?: string; role?: string } | undefined
  if (!user?.id) return false
  if (user.role === 'admin') return true
  return { author: { equals: user.id } }
}

export const Comments: CollectionConfig = {
  slug: 'comments',
  labels: { singular: 'Comment', plural: 'Comments' },
  admin: {
    useAsTitle: 'body',
    defaultColumns: ['ticket', 'author', 'body', 'createdAt'],
    description: 'Comments on tickets, newest last.',
  },
  access: {
    read: readAccess,
    create: writeAccess,
    update: ownOrAdmin,
    delete: ownOrAdmin,
  },
  trash: true,
  defaultSort: 'createdAt',
  hooks: {
    beforeChange: [
      ({ data, req, operation }) => {
        const userId = (req.user as { id?: string } | undefined)?.id
        if (operation === 'create') data.author = userId ?? null
        else delete data.author // authorship never changes
        if (typeof data.body === 'string') data.body = data.body.trim()
        return data
      },
    ],
  },
  fields: [
    { name: 'ticket', type: 'relationship', relationTo: 'tickets', required: true, index: true },
    { name: 'body', type: 'textarea', required: true, maxLength: 10000 },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'teams',
      admin: { readOnly: true, description: 'Set from the signed-in Team Member.' },
    },
  ],
  timestamps: true,
}
