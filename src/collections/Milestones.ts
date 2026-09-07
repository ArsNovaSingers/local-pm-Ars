import type { CollectionConfig } from 'payload'
import { collectionAccess } from '@/lib/access'

/**
 * A dated point that work is planned against.
 *
 * Deliberately domain-free: a concert, a product launch, a grant deadline, a board
 * meeting and a trade show are all just rows here. Nothing in this collection knows
 * what kind of organization is using it.
 */
export const Milestones: CollectionConfig = {
  slug: 'milestones',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'date', 'project'],
    description: 'Dated markers work is planned against. Rendered as vertical lines on the timeline.',
  },
  access: collectionAccess,
  defaultSort: 'date',
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'date',
      type: 'date',
      required: true,
      admin: { date: { pickerAppearance: 'dayOnly' } },
    },
    { name: 'color', type: 'text', defaultValue: '#ef4444' },
    { name: 'description', type: 'textarea' },
    {
      name: 'project',
      type: 'relationship',
      relationTo: 'projects',
      admin: { description: 'Leave empty for a milestone that applies across every project' },
    },
  ],
  timestamps: true,
}
