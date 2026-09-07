import type { CollectionConfig, PayloadRequest } from 'payload'
import { TicketPriority, TICKET_PRIORITY_OPTIONS, TicketStatus } from '@/types/enums'
import { collectionAccess } from '@/lib/access'
import { stampActor, actorFields } from '@/lib/actor'

export const Tickets: CollectionConfig = {
  slug: 'tickets',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['ticketId', 'title', 'status', 'priority', 'project', 'team'],
    description: 'Individual work items within projects',
  },
  access: collectionAccess,
  hooks: {
    beforeChange: [
      stampActor,
      async ({ data, req, operation, originalDoc }) => {
        if (operation === 'create' && data?.project) {
          data.ticketId = await generateTicketId(req, String(data.project))
        }

        if (data && (data.status === undefined || data.status === null || data.status === '')) {
          data.status = await resolveDefaultStatus(req)
        } else if (data?.status) {
          await assertStatusExists(req, String(data.status))
        }

        if (data?.blockedBy !== undefined) {
          await assertNoDependencyCycle(req, data.blockedBy, originalDoc?.id ?? null)
        }

        return data
      },
    ],
  },
  fields: [
    {
      name: 'ticketId',
      type: 'text',
      unique: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Auto-generated ticket ID (e.g., PROJ-123)',
      },
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: { description: 'Brief title of the ticket' },
    },
    {
      name: 'description',
      type: 'richText',
      admin: { description: 'Detailed description of the work' },
    },
    {
      name: 'status',
      type: 'text',
      required: true,
      defaultValue: TicketStatus.TODO,
      admin: {
        description:
          'The `key` of a row in the Statuses collection. This is deliberately a free string rather than a fixed list: workflow states are configurable per workspace.',
      },
    },
    {
      name: 'priority',
      type: 'select',
      options: TICKET_PRIORITY_OPTIONS,
      defaultValue: TicketPriority.NO_PRIORITY,
      admin: { description: 'Priority level of the ticket' },
    },
    {
      name: 'project',
      type: 'relationship',
      relationTo: 'projects',
      required: true,
      admin: { description: 'The project this ticket belongs to' },
    },
    {
      name: 'team',
      type: 'relationship',
      relationTo: 'teams',
      label: 'Assignee',
      admin: { description: 'The Team Member responsible for this ticket' },
    },
    {
      name: 'blockedBy',
      type: 'relationship',
      relationTo: 'tickets',
      hasMany: true,
      admin: {
        description: 'Tickets that must be completed before this ticket can be worked on',
      },
    },
    {
      name: 'milestone',
      type: 'relationship',
      relationTo: 'milestones',
      admin: { description: 'The dated marker this work is aimed at' },
    },
    {
      name: 'labels',
      type: 'array',
      admin: { description: 'Labels for categorization' },
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'color', type: 'text', defaultValue: '#6366f1' },
      ],
    },
    {
      name: 'startDate',
      type: 'date',
      admin: {
        description:
          'When work is planned to start. With a due date this draws a bar on the timeline; without one the ticket shows as a milestone diamond on its due date rather than a fabricated bar.',
        date: { pickerAppearance: 'dayOnly' },
      },
    },
    {
      name: 'dueDate',
      type: 'date',
      admin: {
        description: 'When this ticket should be completed',
        date: { pickerAppearance: 'dayOnly' },
      },
    },
    {
      name: 'subtasks',
      type: 'array',
      admin: { description: 'Subtasks for this ticket' },
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'completed', type: 'checkbox', defaultValue: false },
      ],
    },
    {
      name: 'customFields',
      type: 'array',
      admin: {
        description:
          'Values for the workspace-defined fields in the Custom Fields collection. Domain vocabulary lives here rather than in the schema.',
      },
      fields: [
        { name: 'key', type: 'text', required: true },
        { name: 'value', type: 'text' },
      ],
    },
    ...actorFields,
    {
      name: 'sortOrder',
      type: 'number',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
        description: 'Order within the column',
      },
    },
  ],
  timestamps: true,
}

/* ------------------------------------------------------------------ statuses -- */

async function resolveDefaultStatus(req: PayloadRequest): Promise<string> {
  try {
    const result = await req.payload.find({
      collection: 'statuses',
      where: { isDefault: { equals: true } },
      limit: 1,
      depth: 0,
    })
    if (result.docs.length) return String(result.docs[0].key)
  } catch {
    /* statuses not seeded yet — fall through */
  }
  return TicketStatus.TODO
}

/**
 * Reject a status key that no Statuses row defines — but only once statuses exist.
 * An unseeded workspace (a fresh clone, or this collection's first deploy) must keep
 * accepting the legacy keys, or every existing write breaks the moment the code lands.
 */
async function assertStatusExists(req: PayloadRequest, key: string): Promise<void> {
  try {
    const all = await req.payload.find({ collection: 'statuses', limit: 200, depth: 0 })
    if (!all.docs.length) return
    const known = new Set(all.docs.map((d) => String(d.key)))
    if (!known.has(key)) {
      throw new Error(
        `Unknown status "${key}". Known statuses: ${[...known].sort().join(', ')}. Add it to the Statuses collection first.`,
      )
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Unknown status')) throw err
    /* the statuses collection is unreachable — do not block the write on it */
  }
}

/* -------------------------------------------------------------- dependencies -- */

/**
 * `blockedBy` is a self-referential graph with nothing stopping A → B → A. A cycle is
 * not just bad data: it makes "what is ready to work on?" unanswerable and hangs any
 * layered graph layout that walks the edges. Reject the edge that would close the loop,
 * at the point it is created.
 */
async function assertNoDependencyCycle(
  req: PayloadRequest,
  blockedBy: unknown,
  selfId: string | number | null,
): Promise<void> {
  const proposed = toIdArray(blockedBy)
  if (!proposed.length) return

  if (selfId !== null && proposed.includes(String(selfId))) {
    throw new Error('A ticket cannot block itself.')
  }
  if (selfId === null) return // a brand-new ticket cannot yet be anyone's blocker

  const target = String(selfId)
  const seen = new Set<string>(proposed)
  let frontier = [...proposed]
  let hops = 0

  // Bounded walk: a workspace with a pathological graph must not spin here.
  while (frontier.length && hops < 64) {
    hops += 1
    const docs = await req.payload.find({
      collection: 'tickets',
      where: { id: { in: frontier } },
      limit: 500,
      depth: 0,
    })

    const next: string[] = []
    for (const doc of docs.docs) {
      for (const id of toIdArray((doc as { blockedBy?: unknown }).blockedBy)) {
        if (id === target) {
          throw new Error(
            'That dependency would create a cycle: the ticket you are blocking on already depends on this one, directly or through other tickets.',
          )
        }
        if (!seen.has(id)) {
          seen.add(id)
          next.push(id)
        }
      }
    }
    frontier = next
  }
}

function toIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (entry === null || entry === undefined) return null
      if (typeof entry === 'string' || typeof entry === 'number') return String(entry)
      if (typeof entry === 'object' && 'id' in (entry as Record<string, unknown>)) {
        return String((entry as { id: unknown }).id)
      }
      return null
    })
    .filter((v): v is string => Boolean(v))
}

/* ---------------------------------------------------------------- ticket ids -- */

/**
 * Allocate the next ticket number ATOMICALLY.
 *
 * The original implementation read `project.ticketCounter`, incremented it in
 * JavaScript and wrote it back. Two creates landing together both read 5, both computed
 * 6, and both wrote `PROJ-6` — the same class of duplicate-ID bug that made tasks
 * invisible in the spreadsheet this tool replaces. A bulk import IS that scenario.
 *
 * `findOneAndUpdate` with `$inc` performs the read and the increment as one document
 * operation, so concurrent callers are handed distinct numbers by the database.
 */
async function generateTicketId(req: PayloadRequest, projectId: string): Promise<string> {
  const model = getMongooseModel(req, 'projects')

  if (model) {
    const updated = await model.findOneAndUpdate(
      { _id: projectId },
      { $inc: { ticketCounter: 1 } },
      { new: true, returnDocument: 'after' },
    )
    if (!updated) throw new Error('Project not found')
    return `${updated.prefix}-${updated.ticketCounter}`
  }

  return generateTicketIdWithRetry(req, projectId)
}

type MinimalModel = {
  findOneAndUpdate: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => Promise<{ prefix: string; ticketCounter: number } | null>
}

function getMongooseModel(req: PayloadRequest, slug: string): MinimalModel | null {
  const collections = (req.payload.db as unknown as { collections?: Record<string, MinimalModel> })
    .collections
  const model = collections?.[slug]
  return model && typeof model.findOneAndUpdate === 'function' ? model : null
}

/**
 * Fallback for a database adapter that exposes no atomic primitive. Still not a true
 * compare-and-set, so it verifies the ID is unused before returning it and retries on
 * collision — which fails loudly rather than silently issuing a duplicate.
 */
async function generateTicketIdWithRetry(req: PayloadRequest, projectId: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const project = await req.payload.findByID({ collection: 'projects', id: projectId })
    if (!project) throw new Error('Project not found')

    const candidateCounter = (project.ticketCounter || 0) + 1
    const candidate = `${project.prefix}-${candidateCounter}`

    const clash = await req.payload.find({
      collection: 'tickets',
      where: { ticketId: { equals: candidate } },
      limit: 1,
      depth: 0,
    })

    if (clash.totalDocs === 0) {
      await req.payload.update({
        collection: 'projects',
        id: projectId,
        data: { ticketCounter: candidateCounter },
      })
      return candidate
    }
  }
  throw new Error('Could not allocate a unique ticket ID after 8 attempts — check the project ticketCounter.')
}
