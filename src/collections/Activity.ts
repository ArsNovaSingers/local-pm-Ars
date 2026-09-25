import type { CollectionConfig } from 'payload'
import { readAccess } from '@/lib/access'

/**
 * Append-only history of ticket changes: who changed what, from what, to what.
 *
 * Written only by the afterChange hook in src/lib/activity.ts (with overrideAccess), never by
 * clients — create/update/delete are closed to everyone, so the record can't be edited after
 * the fact. `updatedBy` says who touched a ticket last; this says what they did.
 */
export const Activity: CollectionConfig = {
  slug: 'activity',
  labels: { singular: 'Activity', plural: 'Activity' },
  admin: {
    useAsTitle: 'summary',
    defaultColumns: ['summary', 'actor', 'createdAt'],
    description: 'Automatic change history for tickets. Read-only.',
  },
  access: {
    read: readAccess,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  defaultSort: '-createdAt',
  fields: [
    { name: 'ticket', type: 'relationship', relationTo: 'tickets', index: true },
    { name: 'project', type: 'relationship', relationTo: 'projects', index: true },
    { name: 'actor', type: 'relationship', relationTo: 'teams' },
    {
      name: 'action',
      type: 'select',
      options: ['created', 'updated', 'trashed', 'restored'],
      required: true,
    },
    {
      name: 'changes',
      type: 'array',
      fields: [
        { name: 'field', type: 'text' },
        { name: 'from', type: 'text' },
        { name: 'to', type: 'text' },
      ],
    },
    { name: 'summary', type: 'text' },
  ],
  timestamps: true,
}
