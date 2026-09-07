import { DEFAULT_STATUSES, DEFAULT_STATUS_COLOR, TicketStatus } from '@/types/enums'

/**
 * Workflow states are DATA (see collections/Statuses.ts). Everything the board draws is
 * built from rows of that collection, so a status key is a plain string and the number
 * of columns is whatever the workspace defined — never a fixed three.
 */
export interface BoardStatus {
  key: string
  label: string
  color: string
  order: number
  isDefault?: boolean
  isDone?: boolean
  isBlocked?: boolean
  /** True only for the synthetic trailing column that surfaces orphaned tickets. */
  isUnknown?: boolean
}

/**
 * The column key for tickets whose status matches no status row. It is NOT a status:
 * nothing is ever written with this value. It exists so orphaned work stays visible and
 * can be dragged into a real column rather than silently disappearing from the board.
 */
export const UNKNOWN_STATUS_KEY = '__UNKNOWN__'

/**
 * What the board shows when the `statuses` collection is empty — a deployment where the
 * Phase 0 migration has not run yet. These are the same keys the existing tickets carry,
 * so the board renders correctly instead of rendering nothing.
 */
export function fallbackStatuses(): BoardStatus[] {
  return DEFAULT_STATUSES.map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color,
    order: s.order,
    isDefault: Boolean(s.isDefault),
    isDone: Boolean(s.isDone),
    isBlocked: Boolean(s.isBlocked),
  }))
}

/**
 * Coerce rows out of the `statuses` collection into board columns.
 *
 * Takes `unknown[]` rather than the generated `Status[]` so that the same helper works
 * for a server component holding real Payload documents and for a client component
 * holding a parsed JSON response, without a cast at either call site.
 */
export function toBoardStatuses(docs: readonly unknown[]): BoardStatus[] {
  if (!docs.length) return fallbackStatuses()
  return docs.map((raw) => {
    const doc = (raw ?? {}) as Record<string, unknown>
    return {
      key: String(doc.key),
      label: String(doc.label ?? doc.key),
      color: (doc.color as string) || DEFAULT_STATUS_COLOR,
      order: typeof doc.order === 'number' ? doc.order : 0,
      isDefault: Boolean(doc.isDefault),
      isDone: Boolean(doc.isDone),
      isBlocked: Boolean(doc.isBlocked),
    }
  })
}

/** Where a new ticket lands: the row flagged `isDefault`, else the first column. */
export function defaultStatusKey(statuses: BoardStatus[]): string {
  const real = statuses.filter((s) => !s.isUnknown)
  return real.find((s) => s.isDefault)?.key ?? real[0]?.key ?? TicketStatus.TODO
}

export function findStatus(statuses: BoardStatus[], key: unknown): BoardStatus | undefined {
  return statuses.find((s) => s.key === String(key))
}

export function statusLabel(statuses: BoardStatus[], key: unknown): string {
  return findStatus(statuses, key)?.label ?? String(key ?? 'Unknown status')
}

export function statusColor(statuses: BoardStatus[], key: unknown): string {
  return findStatus(statuses, key)?.color ?? DEFAULT_STATUS_COLOR
}

/** True when the status is one the workspace marks as finished work. */
export function isDoneStatus(statuses: BoardStatus[], key: unknown): boolean {
  return Boolean(findStatus(statuses, key)?.isDone)
}
