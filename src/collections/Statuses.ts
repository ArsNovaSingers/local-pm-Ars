import type { CollectionConfig } from 'payload'
import { collectionAccess } from '@/lib/access'

/**
 * Workflow states are DATA, not a TypeScript enum.
 *
 * A choir season, an ecommerce launch and a software backlog do not share one set of
 * states, and this tool is meant to serve all three. `Tickets.status` stores the `key`
 * of one of these rows as a plain string, so the existing TODO / IN_PROGRESS / DONE
 * values remain valid and no ticket needed migrating when this collection was added.
 */
export const Statuses: CollectionConfig = {
  slug: 'statuses',
  labels: { singular: 'Status', plural: 'Statuses' },
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label', 'key', 'order', 'isDefault', 'isDone'],
    description: 'The workflow states this workspace uses. Board columns are built from these.',
  },
  access: collectionAccess,
  defaultSort: 'order',
  fields: [
    {
      name: 'key',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description:
          'Stable machine value stored on tickets, e.g. IN_PROGRESS. Changing it after tickets exist orphans them — add a new status instead.',
      },
      validate: (value: string | null | undefined) => {
        if (!value) return 'Key is required'
        if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(value)) {
          return 'Key must be 2-32 characters, uppercase letters, digits and underscores, starting with a letter'
        }
        return true
      },
    },
    { name: 'label', type: 'text', required: true, admin: { description: 'Shown on the board column and the ticket' } },
    { name: 'color', type: 'text', defaultValue: '#6b7280' },
    {
      name: 'order',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: { description: 'Left-to-right position on the board' },
    },
    {
      name: 'isDefault',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'New tickets land here when no status is given. Exactly one status should have this set.' },
    },
    {
      name: 'isDone',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description:
          'Marks work as finished. Dependency logic reads this: a ticket is "ready" when every blocker sits in a done status.',
      },
    },
    {
      name: 'isBlocked',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Marks work as waiting on something. Used to distinguish waiting from not-started.' },
    },
  ],
  timestamps: true,
}
