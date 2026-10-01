/**
 * blockedBy writes. The field REPLACES on PATCH, so every change reads the ticket's
 * current list first and writes the union (add) or the difference (remove). Reading
 * fresh — instead of trusting the copy in the browser — means an edge someone else added
 * a minute ago is never silently dropped.
 */

export class DependencyError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function idOf(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) return String((value as { id: unknown }).id)
  return null
}

async function errorFrom(res: Response): Promise<DependencyError> {
  let message = `Request failed (${res.status})`
  try {
    const body = (await res.json()) as { errors?: Array<{ message?: string }>; message?: string }
    message = body.errors?.map((e) => e.message).filter(Boolean).join('; ') || body.message || message
  } catch {
    /* not JSON */
  }
  return new DependencyError(message, res.status)
}

export async function readBlockedByIds(ticketId: string): Promise<string[]> {
  const res = await fetch(`/api/tickets/${ticketId}?depth=0`, { cache: 'no-store', credentials: 'include' })
  if (!res.ok) throw await errorFrom(res)
  const doc = (await res.json()) as { blockedBy?: unknown[] | null }
  return (doc.blockedBy ?? []).map(idOf).filter((x): x is string => !!x)
}

async function writeBlockedBy(ticketId: string, ids: string[]): Promise<string[]> {
  const res = await fetch(`/api/tickets/${ticketId}?depth=0`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blockedBy: ids }),
  })
  if (!res.ok) throw await errorFrom(res)
  const body = (await res.json()) as { doc?: { blockedBy?: unknown[] | null }; blockedBy?: unknown[] | null }
  const saved = (body.doc ?? body).blockedBy ?? ids
  return saved.map(idOf).filter((x): x is string => !!x)
}

export interface DependencyResult {
  /** False when the edge already existed (add) or was already gone (remove). */
  changed: boolean
  /** The blocked ticket's blockedBy ids after the write. */
  ids: string[]
}

/** Make `blockedId` wait on `blockerId`. */
export async function addBlocker(blockedId: string, blockerId: string): Promise<DependencyResult> {
  const current = await readBlockedByIds(blockedId)
  if (current.includes(blockerId)) return { changed: false, ids: current }
  const ids = await writeBlockedBy(blockedId, [...current, blockerId])
  return { changed: true, ids }
}

/** Stop `blockedId` waiting on `blockerId`. */
export async function removeBlocker(blockedId: string, blockerId: string): Promise<DependencyResult> {
  const current = await readBlockedByIds(blockedId)
  if (!current.includes(blockerId)) return { changed: false, ids: current }
  const ids = await writeBlockedBy(
    blockedId,
    current.filter((id) => id !== blockerId),
  )
  return { changed: true, ids }
}
