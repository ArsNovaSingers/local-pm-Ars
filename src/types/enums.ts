/**
 * NOTE ON STATUSES
 *
 * `TicketStatus` is no longer the closed set of workflow states — it is the set of
 * DEFAULT keys a fresh workspace is seeded with. Real states live in the `statuses`
 * collection so that a choir season, an ecommerce launch and a software backlog can
 * each use their own. `Tickets.status` stores a status `key` as a plain string.
 *
 * The enum is kept because these keys are the seeded defaults and the existing data
 * uses them, so code may still refer to them by name. Do not write code that assumes
 * a ticket's status is one of these three.
 */
export enum TicketStatus {
  BACKLOG = 'BACKLOG',
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  BLOCKED = 'BLOCKED',
  REVIEW = 'REVIEW',
  DONE = 'DONE',
}

export interface StatusSeed {
  key: string
  label: string
  color: string
  order: number
  isDefault?: boolean
  isDone?: boolean
  isBlocked?: boolean
}

/**
 * Seeded into the `statuses` collection on first run. Six states rather than three:
 * "waiting on someone" and "not started yet" are different facts, and a board that
 * cannot tell them apart hides work people are waiting on.
 */
export const DEFAULT_STATUSES: StatusSeed[] = [
  { key: TicketStatus.BACKLOG, label: 'Backlog', color: '#52525b', order: 0 },
  { key: TicketStatus.TODO, label: 'Todo', color: '#6b7280', order: 1, isDefault: true },
  { key: TicketStatus.IN_PROGRESS, label: 'In Progress', color: '#3b82f6', order: 2 },
  { key: TicketStatus.BLOCKED, label: 'Blocked', color: '#f59e0b', order: 3, isBlocked: true },
  { key: TicketStatus.REVIEW, label: 'Review', color: '#a855f7', order: 4 },
  { key: TicketStatus.DONE, label: 'Done', color: '#22c55e', order: 5, isDone: true },
]

export enum TicketPriority {
  NO_PRIORITY = 'NO_PRIORITY',
  URGENT = 'URGENT',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  ON_HOLD = 'ON_HOLD',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum TeamMemberRole {
  ADMIN = 'admin',
  MEMBER = 'member',
  AGENT = 'agent',
}

export const TEAM_MEMBER_ROLE_OPTIONS = [
  { label: 'Admin', value: TeamMemberRole.ADMIN },
  { label: 'Member', value: TeamMemberRole.MEMBER },
  { label: 'Agent (automated caller)', value: TeamMemberRole.AGENT },
]

export const TICKET_PRIORITY_OPTIONS = [
  { label: 'No Priority', value: TicketPriority.NO_PRIORITY },
  { label: 'Urgent', value: TicketPriority.URGENT },
  { label: 'High', value: TicketPriority.HIGH },
  { label: 'Medium', value: TicketPriority.MEDIUM },
  { label: 'Low', value: TicketPriority.LOW },
]

export const PROJECT_STATUS_OPTIONS = [
  { label: 'Active', value: ProjectStatus.ACTIVE },
  { label: 'On Hold', value: ProjectStatus.ON_HOLD },
  { label: 'Completed', value: ProjectStatus.COMPLETED },
  { label: 'Cancelled', value: ProjectStatus.CANCELLED },
]

export const PRIORITY_COLORS: Record<TicketPriority, string> = {
  [TicketPriority.NO_PRIORITY]: '#6b7280',
  [TicketPriority.URGENT]: '#ef4444',
  [TicketPriority.HIGH]: '#f97316',
  [TicketPriority.MEDIUM]: '#eab308',
  [TicketPriority.LOW]: '#22c55e',
}

/**
 * Fallback colours only. The authoritative colour for a status is the `color` field on
 * its row in the `statuses` collection; this map is what the UI falls back to for a
 * status it has no row for.
 */
export const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  DEFAULT_STATUSES.map((s) => [s.key, s.color]),
)

export const DEFAULT_STATUS_COLOR = '#6b7280'

export const PROJECT_ICONS = [
  'folder',
  'rocket',
  'zap',
  'star',
  'heart',
  'flag',
  'target',
  'briefcase',
  'code',
  'box',
  'layers',
  'database',
  'megaphone',
  'cloud',
  'users',
]

export const PROJECT_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#a855f7', // Purple
  '#d946ef', // Fuchsia
  '#ec4899', // Pink
  '#ef4444', // Red
  '#f97316', // Orange
  '#f59e0b', // Amber/Yellow
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
]
