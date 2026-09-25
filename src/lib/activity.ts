import type { CollectionAfterChangeHook, PayloadRequest } from 'payload'

/**
 * Record what changed on a ticket, and who changed it, into the `activity` collection.
 *
 * Values are stored as human-readable text (a person's name, a ticket key, a date) rather
 * than ids, because the point is to answer "what was it before?" at a glance — and a
 * history that only makes sense while every referenced record still exists isn't a history.
 *
 * A failure here is logged and swallowed: losing a history line must never fail the edit
 * the person actually asked for.
 */

type Doc = Record<string, unknown>

const idOf = (v: unknown): string | null => {
  if (v == null || v === '') return null
  if (typeof v === 'object' && 'id' in (v as Doc)) return String((v as Doc).id)
  return String(v)
}

const dateOf = (v: unknown): string => (v ? String(v).slice(0, 10) : '')

async function nameLookup(req: PayloadRequest, collection: 'teams' | 'projects' | 'milestones' | 'tickets', id: string | null) {
  if (!id) return ''
  const cache = ((req.context as Doc).__activityNames ??= new Map<string, string>()) as Map<string, string>
  const key = `${collection}:${id}`
  if (cache.has(key)) return cache.get(key)!
  let label = id
  try {
    const d = (await req.payload.findByID({ collection, id, depth: 0, trash: true, overrideAccess: true, disableErrors: true })) as Doc | null
    if (d) label = String(d.ticketId ?? d.name ?? d.prefix ?? id)
  } catch {
    /* keep the id */
  }
  cache.set(key, label)
  return label
}

async function describe(req: PayloadRequest, field: string, v: unknown): Promise<string> {
  switch (field) {
    case 'team':
      return (await nameLookup(req, 'teams', idOf(v))) || 'Unassigned'
    case 'project':
      return nameLookup(req, 'projects', idOf(v))
    case 'milestone':
      return (await nameLookup(req, 'milestones', idOf(v))) || 'None'
    case 'dueDate':
    case 'startDate':
      return dateOf(v) || 'None'
    case 'blockedBy': {
      const ids = Array.isArray(v) ? v.map(idOf).filter(Boolean) as string[] : []
      const keys = await Promise.all(ids.map((id) => nameLookup(req, 'tickets', id)))
      return keys.sort().join(', ') || 'None'
    }
    case 'labels':
      return (Array.isArray(v) ? v.map((l) => String((l as Doc)?.name ?? '')).filter(Boolean).sort().join(', ') : '') || 'None'
    default:
      return v == null || v === '' ? 'None' : String(v)
  }
}

const TRACKED = ['title', 'status', 'priority', 'team', 'dueDate', 'startDate', 'project', 'milestone', 'blockedBy', 'labels'] as const

function subtaskChanges(prev: unknown, next: unknown): Array<{ field: string; from: string; to: string }> {
  const a = Array.isArray(prev) ? (prev as Doc[]) : []
  const b = Array.isArray(next) ? (next as Doc[]) : []
  const out: Array<{ field: string; from: string; to: string }> = []
  const byTitle = new Map(a.map((s) => [String(s.title), Boolean(s.completed)]))
  for (const s of b) {
    const title = String(s.title)
    if (!byTitle.has(title)) out.push({ field: 'subtask', from: '', to: `added: ${title}` })
    else if (byTitle.get(title) !== Boolean(s.completed)) {
      out.push({ field: 'subtask', from: title, to: s.completed ? 'completed' : 'reopened' })
    }
    byTitle.delete(title)
  }
  for (const title of byTitle.keys()) out.push({ field: 'subtask', from: title, to: 'removed' })
  return out
}

export const recordTicketActivity: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  try {
    const actor = (req.user as { id?: string } | undefined)?.id ?? null
    const key = String((doc as Doc).ticketId ?? '')
    const project = idOf((doc as Doc).project)

    let action: 'created' | 'updated' | 'trashed' | 'restored' = operation === 'create' ? 'created' : 'updated'
    const changes: Array<{ field: string; from: string; to: string }> = []

    if (operation === 'update') {
      const wasTrashed = Boolean((previousDoc as Doc)?.deletedAt)
      const isTrashed = Boolean((doc as Doc).deletedAt)
      if (!wasTrashed && isTrashed) action = 'trashed'
      else if (wasTrashed && !isTrashed) action = 'restored'

      for (const field of TRACKED) {
        const from = await describe(req, field, (previousDoc as Doc)?.[field])
        const to = await describe(req, field, (doc as Doc)[field])
        if (from !== to) changes.push({ field, from, to })
      }
      changes.push(...subtaskChanges((previousDoc as Doc)?.subtasks, (doc as Doc).subtasks))
      if (JSON.stringify((previousDoc as Doc)?.description ?? null) !== JSON.stringify((doc as Doc).description ?? null)) {
        changes.push({ field: 'description', from: '', to: 'edited' })
      }
      if (action === 'updated' && changes.length === 0) return doc // a no-op save: nothing to record
    }

    const who = actor ? await nameLookup(req, 'teams', actor) : 'Someone'
    const summary =
      action === 'created' ? `${who} created ${key}`
      : action === 'trashed' ? `${who} moved ${key} to the Trash`
      : action === 'restored' ? `${who} restored ${key} from the Trash`
      : `${who} changed ${changes.map((c) => c.field).filter((f, i, all) => all.indexOf(f) === i).join(', ')} on ${key}`

    await req.payload.create({
      collection: 'activity',
      data: { ticket: String((doc as Doc).id), project, actor, action, changes, summary },
      overrideAccess: true,
      // Deliberately NOT passing `req`: that would join the edit's transaction, and a failed
      // history write could then abort the edit itself.
    })
  } catch (err) {
    req.payload.logger.error({ err }, 'activity: failed to record ticket change')
  }
  return doc
}
