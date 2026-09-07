import type { CollectionConfig } from 'payload'
import { collectionAccess } from '@/lib/access'

/**
 * Per-workspace custom fields — the mechanism that keeps domain vocabulary out of the
 * schema.
 *
 * A choir needs "Voice Part" and "Season"; an ecommerce plan needs "SKU", "Channel"
 * and "Supplier". Neither belongs in `Tickets.ts`. Definitions live here, values live
 * in `Tickets.customFields`, and the codebase stays domain-free.
 *
 * Phase 0 ships the storage and the API. The admin UI for editing values comes later;
 * until then values are set through the REST API and the MCP server.
 */
export const FieldDefinitions: CollectionConfig = {
  slug: 'field-definitions',
  labels: { singular: 'Custom Field', plural: 'Custom Fields' },
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label', 'key', 'type', 'project'],
    description: 'Extra fields this workspace wants on its tickets.',
  },
  access: collectionAccess,
  fields: [
    {
      name: 'key',
      type: 'text',
      required: true,
      unique: true,
      admin: { description: 'Stable machine value stored on tickets, e.g. voice_part' },
      validate: (value: string | null | undefined) => {
        if (!value) return 'Key is required'
        if (!/^[a-z][a-z0-9_]{1,39}$/.test(value)) {
          return 'Key must be 2-40 characters, lowercase letters, digits and underscores, starting with a letter'
        }
        return true
      },
    },
    { name: 'label', type: 'text', required: true },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'text',
      options: [
        { label: 'Text', value: 'text' },
        { label: 'Number', value: 'number' },
        { label: 'Date', value: 'date' },
        { label: 'Select (one of a list)', value: 'select' },
        { label: 'Checkbox', value: 'checkbox' },
        { label: 'URL', value: 'url' },
      ],
    },
    {
      name: 'options',
      type: 'array',
      admin: { description: 'Only used when type is Select', condition: (data) => data?.type === 'select' },
      fields: [{ name: 'value', type: 'text', required: true }],
    },
    {
      name: 'project',
      type: 'relationship',
      relationTo: 'projects',
      admin: { description: 'Leave empty to apply this field to every project' },
    },
    { name: 'description', type: 'textarea' },
  ],
  timestamps: true,
}
