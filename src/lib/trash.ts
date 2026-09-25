import { APIError, type CollectionBeforeDeleteHook } from 'payload'

/**
 * Nothing is lost by accident.
 *
 * Tickets, projects and milestones use Payload's built-in trash (`trash: true`): "deleting"
 * sets `deletedAt`, the document drops out of every list and board, and clearing
 * `deletedAt` restores it. But a plain REST `DELETE` on a trash-enabled collection still
 * removes a live document permanently — and older clients (the Kanban board, the MCP server
 * before 2026-09-25) send exactly that.
 *
 * So a permanent delete is refused unless the document is ALREADY in the trash. Every
 * client, old or new, gets the same guarantee: to lose something for good you have to
 * trash it first and then empty it from the trash (or let the 30-day purge do it).
 *
 * Decided with Jon 2026-09-24: deletes stay open to everyone rather than admin-only, and this
 * is the safety net that makes that reasonable.
 */
export const requireTrashedBeforeDelete: CollectionBeforeDeleteHook = async ({ req, id, collection }) => {
  const doc = (await req.payload.findByID({
    collection: collection.slug as 'tickets',
    id,
    depth: 0,
    trash: true,
    overrideAccess: true,
    disableErrors: true,
  })) as { deletedAt?: string | null } | null

  if (doc && !doc.deletedAt) {
    throw new APIError(
      `Refusing to permanently delete a ${collection.slug.replace(/s$/, '')} that is not in the Trash. ` +
        `Move it to the Trash instead (PATCH { "deletedAt": "<now>" }); it can be restored from there.`,
      409,
    )
  }
}

/** Days a trashed document is kept before the nightly job purges it. */
export const TRASH_RETENTION_DAYS = 30
