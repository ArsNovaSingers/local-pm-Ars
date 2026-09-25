/**
 * Browser-side "delete" helpers. Nothing in the UI deletes permanently: tickets, projects
 * and milestones move to the Trash (restorable for 30 days from /trash), and people are
 * deactivated. The server refuses a permanent delete of anything not already trashed
 * (src/lib/trash.ts), so these are the only deletes that work anyway.
 */
type Trashable = 'tickets' | 'projects' | 'milestones'

async function patch(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

export function moveToTrash(collection: Trashable, id: string, at = new Date().toISOString()) {
  return patch(`/api/${collection}/${id}?depth=0`, { deletedAt: at })
}

export function restoreFromTrash(collection: Trashable, id: string) {
  return patch(`/api/${collection}/${id}?depth=0&trash=true`, { deletedAt: null })
}

/** A project and its tickets share one timestamp, so they can be restored together. */
export async function moveProjectToTrash(projectId: string, ticketIds: string[]) {
  const at = new Date().toISOString()
  await Promise.all(ticketIds.map((id) => moveToTrash('tickets', id, at)))
  await moveToTrash('projects', projectId, at)
}

export function deactivatePerson(id: string) {
  return patch(`/api/teams/${id}?depth=0`, { active: false })
}
