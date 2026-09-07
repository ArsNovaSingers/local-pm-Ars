// Shared MCP server logic — tool definitions, Local PM API proxying, and request handlers.
// Used by both index.ts (stdio, for Claude Desktop) and http.ts (StreamableHTTP, for Cloud Run).
// Kept transport-agnostic on purpose: createServer() returns a fresh, fully-wired Server instance
// with no per-connection state of its own (all real state lives in the Local PM / Payload backend
// reachable via LOCAL_PM_URL), so it's safe to call once per stdio process or once per HTTP request.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { GoogleAuth, IdTokenClient } from 'google-auth-library';

const BASE_URL = process.env.LOCAL_PM_URL || 'http://localhost:3010';

// If LOCAL_PM_URL points at a Cloud Run service sitting behind Identity-Aware Proxy (IAP),
// IAP gates *every* path on that service, including this REST API — not just the browser UI.
// Set IAP_AUDIENCE to that IAP resource's OAuth Client ID (format:
// "NNNNN-xxxxx.apps.googleusercontent.com", found in GCP Console under Security >
// Identity-Aware Proxy > select the resource > Settings, once a *custom* OAuth client is
// configured there — Google-managed IAP clients cannot be used for programmatic access at all)
// and this server will mint its own Google ID token (via its Cloud Run service account, no key
// file needed) and attach it to every outbound call. Leave unset for a plain, non-IAP backend.
const IAP_AUDIENCE = process.env.IAP_AUDIENCE;

// Lazily created and cached — GoogleAuth/IdTokenClient handle token refresh internally, so we
// want exactly one client for the process lifetime, not one per request.
let iapClientPromise: Promise<IdTokenClient> | undefined;

function getIapClient(): Promise<IdTokenClient> | undefined {
  if (!IAP_AUDIENCE) return undefined;
  if (!iapClientPromise) {
    const auth = new GoogleAuth();
    iapClientPromise = auth.getIdTokenClient(IAP_AUDIENCE);
  }
  return iapClientPromise;
}

// Status mapping (MCP uses lowercase for readability, Payload uses uppercase).
// This is a convenience table, NOT a whitelist — see toStatusKey() below.
const STATUS_MAP: Record<string, string> = {
  active: 'ACTIVE',
  on_hold: 'ON_HOLD',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  todo: 'TODO',
  in_progress: 'IN_PROGRESS',
  done: 'DONE',
  no_priority: 'NO_PRIORITY',
  urgent: 'URGENT',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

function toPayloadValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return STATUS_MAP[value] || value;
}

/**
 * Ticket workflow states are DATA, not a closed enum.
 *
 * They are rows in the `statuses` collection (seeded with BACKLOG, TODO, IN_PROGRESS,
 * BLOCKED, REVIEW, DONE) and any workspace can add its own, so this deliberately does
 * not reject an unrecognised value: it keeps the historic lowercase -> UPPERCASE
 * convenience mapping and passes everything else through uppercased. `list_statuses`
 * returns the set that actually exists.
 */
function toStatusKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return STATUS_MAP[trimmed] || trimmed.toUpperCase();
}

// Encode a value before it goes into a query string. An id carrying a stray space or
// slash otherwise produces a malformed `where` clause that Payload quietly ignores,
// which reads as "the filter did nothing" rather than as an error.
function qs(value: unknown): string {
  return encodeURIComponent(String(value));
}

/**
 * Take the first argument that was actually supplied, so a tool can accept two names
 * for the same thing.
 *
 * This exists because MCP input schemas here do not set additionalProperties:false: a
 * caller that passes the WRONG argument name gets no error at all, the filter is simply
 * never applied, and the query comes back unfiltered. That is precisely how
 * `list_tickets` was seen "returning tickets from other projects" — the README
 * documented the filter as `project` while the code only ever read `projectId`.
 */
function firstDefined(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return undefined;
}

// Normalise a relationship list that may arrive as ids or as expanded documents.
function toIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') return String(entry);
      if (entry && typeof entry === 'object' && 'id' in (entry as Record<string, unknown>)) {
        return String((entry as { id: unknown }).id);
      }
      return null;
    })
    .filter((v): v is string => Boolean(v));
}

// Pagination response interface for AI-friendly output
interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    nextPage: number | null;
    prevPage: number | null;
  };
}

// Helper to format paginated responses in an AI-friendly way
function formatPaginatedResponse<T>(
  response: {
    docs: T[];
    totalDocs: number;
    limit: number;
    totalPages: number;
    page: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    nextPage?: number | null;
    prevPage?: number | null;
  }
): PaginatedResponse<T> {
  return {
    items: response.docs,
    pagination: {
      page: response.page,
      limit: response.limit,
      totalItems: response.totalDocs,
      totalPages: response.totalPages,
      hasNextPage: response.hasNextPage,
      hasPrevPage: response.hasPrevPage,
      nextPage: response.hasNextPage ? response.page + 1 : null,
      prevPage: response.hasPrevPage ? response.page - 1 : null,
    },
  };
}

// Helper functions to slim down nested relationship objects for list responses
// These prevent bloated responses when relationships are expanded with depth=1

interface SlimProject {
  id: string;
  prefix: string;
}

interface SlimTeam {
  id: string;
  name: string;
}

interface SlimNamed {
  id: string;
  name: string;
}

// Extract slim project info (just id and prefix) from expanded project object
function slimProject(project: unknown): SlimProject | string | null {
  if (!project) return null;
  if (typeof project === 'string') return project; // Already just an ID
  if (typeof project === 'object' && project !== null) {
    const p = project as Record<string, unknown>;
    return {
      id: p.id as string,
      prefix: p.prefix as string,
    };
  }
  return null;
}

// Extract slim team info (just id and name) from expanded team object
function slimTeam(team: unknown): SlimTeam | string | null {
  if (!team) return null;
  if (typeof team === 'string') return team; // Already just an ID
  if (typeof team === 'object' && team !== null) {
    const t = team as Record<string, unknown>;
    return {
      id: t.id as string,
      name: t.name as string,
    };
  }
  return null;
}

// Extract slim {id, name} info from any expanded relationship that has a name —
// milestones and the Team Member rows behind createdBy / updatedBy.
function slimNamed(value: unknown): SlimNamed | string | null {
  if (!value) return null;
  if (typeof value === 'string') return value; // Already just an ID
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>;
    return {
      id: v.id as string,
      name: v.name as string,
    };
  }
  return null;
}

// Extract just IDs from blockedBy array (which may contain full ticket objects)
function slimBlockedBy(blockedBy: unknown): string[] | null {
  if (!blockedBy) return null;
  if (!Array.isArray(blockedBy)) return null;
  return blockedBy.map(item => {
    if (typeof item === 'string') return item; // Already just an ID
    if (typeof item === 'object' && item !== null) {
      return (item as Record<string, unknown>).id as string;
    }
    return item;
  }).filter(Boolean) as string[];
}

// Apply slimming to a ticket object for list responses
function slimTicket(ticket: Record<string, unknown>, fieldsToInclude: Set<string>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};

  for (const field of fieldsToInclude) {
    if (!(field in ticket)) continue;

    const value = ticket[field];

    // Slim down relationship fields
    if (field === 'project') {
      filtered[field] = slimProject(value);
    } else if (field === 'team') {
      filtered[field] = slimTeam(value);
    } else if (field === 'milestone' || field === 'createdBy' || field === 'updatedBy') {
      filtered[field] = slimNamed(value);
    } else if (field === 'blockedBy') {
      filtered[field] = slimBlockedBy(value);
    } else {
      filtered[field] = value;
    }
  }

  return filtered;
}

// Helper function to make API requests
async function apiRequest(
  endpoint: string,
  method: string = 'GET',
  body?: unknown
): Promise<unknown> {
  const url = `${BASE_URL}/api${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const iapClient = await getIapClient();
  if (iapClient) {
    // Behind IAP: attach a Google ID token scoped to the IAP audience so the request clears
    // the proxy before it ever reaches Local PM's own API auth (there is none, currently).
    const authHeaders = await iapClient.getRequestHeaders(url);
    Object.assign(headers, authHeaders as unknown as Record<string, string>);
  }

  const options: RequestInit = { method, headers };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API request failed: ${response.status} - ${error}`);
  }

  return response.json();
}

interface StatusRow {
  key: string;
  label: string;
  color?: string;
  order?: number;
  isDefault?: boolean;
  isDone?: boolean;
  isBlocked?: boolean;
}

// The seeded defaults, used ONLY when the statuses collection cannot be read (an older
// backend, or one that has not been seeded yet). The board still has to render.
const FALLBACK_STATUSES: StatusRow[] = [
  { key: 'BACKLOG', label: 'Backlog', color: '#6b7280', order: 0 },
  { key: 'TODO', label: 'To Do', color: '#6b7280', order: 1, isDefault: true },
  { key: 'IN_PROGRESS', label: 'In Progress', color: '#3b82f6', order: 2 },
  { key: 'BLOCKED', label: 'Blocked', color: '#ef4444', order: 3, isBlocked: true },
  { key: 'REVIEW', label: 'Review', color: '#a855f7', order: 4 },
  { key: 'DONE', label: 'Done', color: '#22c55e', order: 5, isDone: true },
];

// Read the workspace's configured workflow states, in board order.
async function fetchStatusRows(): Promise<StatusRow[]> {
  try {
    const response = await apiRequest('/statuses?limit=200&page=1&depth=0&sort=order') as {
      docs?: StatusRow[];
    };
    const docs = (response.docs || []).filter((doc) => doc && doc.key);
    if (docs.length) return docs;
  } catch {
    /* statuses collection unreachable — fall through to the seeded defaults */
  }
  return FALLBACK_STATUSES;
}

// Define all tools
const tools: Tool[] = [
  // ============== PROJECTS ==============
  {
    name: 'list_projects',
    description: 'List all projects in Local PM. By default returns only basic fields (id, name, prefix, status, color, icon). Use "include" to request additional fields like description.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status: active, on_hold, completed, cancelled',
          enum: ['active', 'on_hold', 'completed', 'cancelled'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of projects to return (default: 20)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1). Use with limit to paginate through results.',
        },
        include: {
          type: 'array',
          description: 'Additional fields to include in the response. By default only id, name, prefix, status, color, icon are returned.',
          items: {
            type: 'string',
            enum: ['description', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },
  {
    name: 'get_project',
    description: 'Get detailed information about a specific project by ID. Parameter naming: this tool takes "id". A wrong parameter name is silently ignored rather than rejected, so the request 404s — and that 404 looks exactly like a project that does not exist. Check the parameter name before concluding the record is missing.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The project ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_project',
    description: 'Create a new project in Local PM',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Project name',
        },
        prefix: {
          type: 'string',
          description: 'Project prefix (2-6 uppercase letters, used for ticket IDs like PROJ-1)',
        },
        description: {
          type: 'string',
          description: 'Project description (supports HTML for rich text)',
        },
        status: {
          type: 'string',
          description: 'Project status',
          enum: ['active', 'on_hold', 'completed', 'cancelled'],
          default: 'active',
        },
        icon: {
          type: 'string',
          description: 'Icon name: folder, rocket, zap, star, heart, flag, target, briefcase, code, box, layers, database',
          default: 'folder',
        },
        color: {
          type: 'string',
          description: 'Hex color code (e.g., #6366f1)',
          default: '#6366f1',
        },
      },
      required: ['name', 'prefix'],
    },
  },
  {
    name: 'update_project',
    description: 'Update an existing project. Parameter naming: the project is identified by "id" (not "projectId"). A wrong parameter name is silently ignored and the request 404s, which is indistinguishable from a missing project.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The project ID to update',
        },
        name: {
          type: 'string',
          description: 'New project name',
        },
        description: {
          type: 'string',
          description: 'New project description',
        },
        status: {
          type: 'string',
          description: 'New project status',
          enum: ['active', 'on_hold', 'completed', 'cancelled'],
        },
        icon: {
          type: 'string',
          description: 'New icon name',
        },
        color: {
          type: 'string',
          description: 'New hex color code',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_project',
    description: 'Delete a project and optionally all its tickets. Parameter naming: the project is identified by "id" (not "projectId"); a wrong name 404s in a way indistinguishable from a missing project.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The project ID to delete',
        },
        deleteTickets: {
          type: 'boolean',
          description: 'Whether to delete all tickets in the project (default: true)',
          default: true,
        },
      },
      required: ['id'],
    },
  },

  // ============== TEAM MEMBERS (slug: teams) ==============
  // The "teams" collection holds PEOPLE, not groups — it is titled "Team Members" in the
  // UI and the ticket field that points at it is labelled "Assignee". The slug, the REST
  // path and these five tool names stay "team" on purpose: four live Claude connectors are
  // bound to them, and a chat that was open when this server redeployed keeps the old tool
  // schema. The *_team_member tools below are aliases onto the very same handlers.
  {
    name: 'list_teams',
    description: 'List the team members (people) in Local PM. Prefer the newer alias "list_team_members" — it is the same call, with a name that says what these records are. A "team" here is one PERSON who can be assigned tickets, not a group. By default returns id, name, email, initials, role and active; use "include" for description and timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of team members to return (default: 20)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1). Use with limit to paginate through results.',
        },
        include: {
          type: 'array',
          description: 'Additional fields to include in the response. By default only id, name, email, initials, role, active, color are returned.',
          items: {
            type: 'string',
            enum: ['description', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },
  {
    name: 'get_team',
    description: 'Get detailed information about one team member (a person) by ID. Prefer the newer alias "get_team_member" — same call, clearer name. Parameter naming: this tool takes "id" (not "teamId" or "memberId"). A wrong parameter name is silently ignored, so the request 404s, and that 404 is indistinguishable from a person who does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The team member ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_team',
    description: 'Create a team member (a person who can be assigned tickets) in Local PM. Prefer the newer alias "create_team_member" — same call, clearer name. This does NOT create a group: "name" is a person\'s display name, e.g. "Kimberly Brody".',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: "The person's display name, e.g. Kimberly Brody",
        },
        email: {
          type: 'string',
          description: "The person's email address. Also their sign-in identity for the Local PM admin UI.",
        },
        initials: {
          type: 'string',
          description: 'Up to 3 characters for compact avatars. Derived from the name when omitted.',
        },
        role: {
          type: 'string',
          description: 'admin can delete; member is an ordinary person; agent is an automated caller and should hold an API key rather than a password.',
          enum: ['admin', 'member', 'agent'],
          default: 'member',
        },
        active: {
          type: 'boolean',
          description: 'Inactive people keep their history but drop out of assignment pickers (default: true)',
          default: true,
        },
        description: {
          type: 'string',
          description: 'Free-text note about this person (supports HTML for rich text)',
        },
        color: {
          type: 'string',
          description: 'Hex color code used for this person\'s avatar (e.g., #6366f1)',
          default: '#6366f1',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_team',
    description: 'Update an existing team member (a person). Prefer the newer alias "update_team_member" — same call, clearer name. Parameter naming: the person is identified by "id" (not "teamId"); a wrong name is silently ignored and the request 404s, which looks exactly like a missing person.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The team member ID to update',
        },
        name: {
          type: 'string',
          description: "The person's new display name",
        },
        email: {
          type: 'string',
          description: 'New email address',
        },
        initials: {
          type: 'string',
          description: 'New initials (up to 3 characters)',
        },
        role: {
          type: 'string',
          description: 'New role',
          enum: ['admin', 'member', 'agent'],
        },
        active: {
          type: 'boolean',
          description: 'Set false to retire this person without deleting their history',
        },
        description: {
          type: 'string',
          description: 'New free-text note',
        },
        color: {
          type: 'string',
          description: 'New hex color code',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_team',
    description: 'Delete a team member (a person). Tickets assigned to them become unassigned. Prefer the newer alias "delete_team_member" — same call, clearer name. Consider setting active:false via update_team instead, which keeps their history. Parameter naming: takes "id"; a wrong name 404s indistinguishably from a missing person.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The team member ID to delete',
        },
      },
      required: ['id'],
    },
  },

  // ---- Preferred names for the five tools above. Identical handlers, identical
  // ---- arguments; both sets stay registered so existing connector sessions keep working.
  {
    name: 'list_team_members',
    description: 'List the people who can be assigned tickets. Each record is one PERSON (name, email, initials, role, active), not a group — the underlying collection is still called "teams" for compatibility. Preferred over the older "list_teams", which is the same call. By default returns id, name, email, initials, role and active; use "include" for description and timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of team members to return (default: 20)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1). Use with limit to paginate through results.',
        },
        include: {
          type: 'array',
          description: 'Additional fields to include in the response. By default only id, name, email, initials, role, active, color are returned.',
          items: {
            type: 'string',
            enum: ['description', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },
  {
    name: 'get_team_member',
    description: 'Get one person by ID — name, email, initials, role and whether they are active. Preferred over the older "get_team", which is the same call. Parameter naming: this tool takes "id" (not "memberId" or "teamId"). A wrong parameter name is silently ignored, so the call 404s, and that 404 is indistinguishable from a person who does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The team member ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_team_member',
    description: 'Add a person who can be assigned tickets. Preferred over the older "create_team", which is the same call. "name" is a person\'s display name, e.g. "Kimberly Brody" — this is not a group.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: "The person's display name, e.g. Kimberly Brody",
        },
        email: {
          type: 'string',
          description: "The person's email address. Also their sign-in identity for the Local PM admin UI.",
        },
        initials: {
          type: 'string',
          description: 'Up to 3 characters for compact avatars. Derived from the name when omitted.',
        },
        role: {
          type: 'string',
          description: 'admin can delete; member is an ordinary person; agent is an automated caller and should hold an API key rather than a password.',
          enum: ['admin', 'member', 'agent'],
          default: 'member',
        },
        active: {
          type: 'boolean',
          description: 'Inactive people keep their history but drop out of assignment pickers (default: true)',
          default: true,
        },
        description: {
          type: 'string',
          description: 'Free-text note about this person (supports HTML for rich text)',
        },
        color: {
          type: 'string',
          description: 'Hex color code used for this person\'s avatar (e.g., #6366f1)',
          default: '#6366f1',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_team_member',
    description: 'Update a person — rename them, change their email, role or initials, or retire them with active:false. Preferred over the older "update_team", which is the same call. Parameter naming: the person is identified by "id" (not "memberId"); a wrong name is silently ignored and the request 404s, which looks exactly like a missing person.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The team member ID to update',
        },
        name: {
          type: 'string',
          description: "The person's new display name",
        },
        email: {
          type: 'string',
          description: 'New email address',
        },
        initials: {
          type: 'string',
          description: 'New initials (up to 3 characters)',
        },
        role: {
          type: 'string',
          description: 'New role',
          enum: ['admin', 'member', 'agent'],
        },
        active: {
          type: 'boolean',
          description: 'Set false to retire this person without deleting their history',
        },
        description: {
          type: 'string',
          description: 'New free-text note',
        },
        color: {
          type: 'string',
          description: 'New hex color code',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_team_member',
    description: 'Permanently delete a person. Tickets assigned to them become unassigned. Preferred over the older "delete_team", which is the same call. Prefer update_team_member with active:false when the person has history worth keeping. Parameter naming: takes "id"; a wrong name 404s indistinguishably from a missing person.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The team member ID to delete',
        },
      },
      required: ['id'],
    },
  },

  // ============== TICKETS ==============
  {
    name: 'list_tickets',
    description: 'List tickets in Local PM with optional filters. Parameter naming: the project filter is "projectId" and the assignee filter is "teamId" ("project" and "team" are accepted as aliases, because a mistyped filter name would otherwise be silently dropped and return tickets from EVERY project rather than an error). By default returns only basic fields (id, title, status, project). Use "include" to request additional fields. Note: relationship fields are returned in slim format - project returns {id, prefix}, team (the assignee, a person) returns {id, name}, milestone/createdBy/updatedBy return {id, name}, blockedBy returns an array of ticket IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Filter by project ID. Alias: "project".',
        },
        teamId: {
          type: 'string',
          description: 'Filter by assignee — the ID of a team member (a person). Alias: "team".',
        },
        milestoneId: {
          type: 'string',
          description: 'Filter by milestone ID — only tickets aimed at that dated marker. Alias: "milestone". Use list_milestones to find the ID.',
        },
        status: {
          type: 'string',
          description: 'Filter by workflow status. Statuses are configurable per workspace, so this is a free string rather than a fixed list — call list_statuses to see the current set (seeded defaults: BACKLOG, TODO, IN_PROGRESS, BLOCKED, REVIEW, DONE). Lowercase input is accepted and uppercased, so "in_progress" and "IN_PROGRESS" are the same filter.',
        },
        priority: {
          type: 'string',
          description: 'Filter by priority',
          enum: ['no_priority', 'urgent', 'high', 'medium', 'low'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of tickets to return (default: 20)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1). Use with limit to paginate through results.',
        },
        include: {
          type: 'array',
          description: 'Additional fields to include in the response. By default only id, title, status, and project are returned.',
          items: {
            type: 'string',
            enum: ['description', 'team', 'priority', 'startDate', 'dueDate', 'milestone', 'customFields', 'labels', 'subtasks', 'blockedBy', 'sortOrder', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },
  {
    name: 'get_ticket',
    description: 'Get detailed information about a specific ticket by ID. Parameter naming trap: this tool takes "id", NOT "ticketId". A wrong parameter name is silently ignored rather than rejected, so the call 404s — and that bare 404 is indistinguishable from a ticket that genuinely does not exist. Check the parameter name before concluding the record is missing.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ticket ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_ticket',
    description: 'Create a new ticket in Local PM. Parameter naming trap: the project is passed as "project", NOT "projectId" — a wrong name is silently ignored, and because project is required the call then fails in a way that looks like a missing project rather than a bad argument. The assignee is "team" (the ID of a team member, i.e. a person).',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Ticket title',
        },
        description: {
          type: 'string',
          description: 'Ticket description (supports HTML for rich text)',
        },
        project: {
          type: 'string',
          description: 'Project ID (required). The parameter is called "project", not "projectId".',
        },
        team: {
          type: 'string',
          description: 'Assignee — the ID of a team member (a person). Optional.',
        },
        status: {
          type: 'string',
          description: 'Ticket status. Statuses are configurable per workspace, so this is a free string rather than a fixed list — call list_statuses for the current set (seeded defaults: BACKLOG, TODO, IN_PROGRESS, BLOCKED, REVIEW, DONE). Lowercase input is uppercased. Omit it to let the workspace default status apply.',
          default: 'todo',
        },
        priority: {
          type: 'string',
          description: 'Ticket priority',
          enum: ['no_priority', 'urgent', 'high', 'medium', 'low'],
          default: 'no_priority',
        },
        startDate: {
          type: 'string',
          description: 'Planned start date in ISO format (YYYY-MM-DD). With a due date this draws a bar on the timeline; without one the ticket shows as a diamond on its due date.',
        },
        dueDate: {
          type: 'string',
          description: 'Due date in ISO format (YYYY-MM-DD)',
        },
        milestone: {
          type: 'string',
          description: 'Milestone ID this work is aimed at — a dated marker such as a concert, launch or deadline. Use list_milestones to find it, create_milestone to add one.',
        },
        customFields: {
          type: 'array',
          description: 'Values for the workspace-defined custom fields. Each entry is {key, value}, where key matches a row in the field-definitions collection (e.g. voice_part, sku). Domain vocabulary lives here rather than in the ticket schema.',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['key'],
          },
        },
        labels: {
          type: 'array',
          description: 'Array of labels with name and color',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              color: { type: 'string' },
            },
            required: ['name', 'color'],
          },
        },
        subtasks: {
          type: 'array',
          description: 'Array of subtasks with title and completed status',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              completed: { type: 'boolean', default: false },
            },
            required: ['title'],
          },
        },
        blockedBy: {
          type: 'array',
          description: 'Array of ticket IDs that block this ticket. The ticket cannot be worked on until all blocking tickets are done.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['title', 'project'],
    },
  },
  {
    name: 'update_ticket',
    description: 'Update an existing ticket. Parameter naming trap: the ticket is identified by "id", NOT "ticketId" — a wrong name is silently ignored, so the call 404s and that bare 404 is indistinguishable from a ticket that does not exist. Note that "blockedBy", "labels" and "subtasks" REPLACE the whole array; to add or remove a single dependency without clobbering a concurrent edit, use link_tickets / unlink_tickets instead.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ticket to update: its Mongo id (e.g. "6a9e...de1") or its human key (e.g. "TKT-1"). Alias: ticketId.',
        },
        title: {
          type: 'string',
          description: 'New ticket title',
        },
        description: {
          type: 'string',
          description: 'New ticket description',
        },
        team: {
          type: 'string',
          description: 'New assignee — the ID of a team member (a person). Use null to unassign.',
        },
        status: {
          type: 'string',
          description: 'New ticket status. Statuses are configurable per workspace, so this is a free string rather than a fixed list — call list_statuses for the current set (seeded defaults: BACKLOG, TODO, IN_PROGRESS, BLOCKED, REVIEW, DONE). Lowercase input is uppercased.',
        },
        priority: {
          type: 'string',
          description: 'New ticket priority',
          enum: ['no_priority', 'urgent', 'high', 'medium', 'low'],
        },
        startDate: {
          type: 'string',
          description: 'New planned start date in ISO format YYYY-MM-DD (use null to clear)',
        },
        dueDate: {
          type: 'string',
          description: 'New due date in ISO format (use null to clear)',
        },
        milestone: {
          type: 'string',
          description: 'New milestone ID this work is aimed at (use null to clear). See list_milestones.',
        },
        customFields: {
          type: 'array',
          description: 'New array of {key, value} custom field values (REPLACES existing). Keys match rows in the field-definitions collection.',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['key'],
          },
        },
        labels: {
          type: 'array',
          description: 'New array of labels (replaces existing)',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              color: { type: 'string' },
            },
            required: ['name', 'color'],
          },
        },
        subtasks: {
          type: 'array',
          description: 'New array of subtasks (replaces existing)',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              completed: { type: 'boolean' },
            },
            required: ['title'],
          },
        },
        blockedBy: {
          type: 'array',
          description: 'Array of ticket IDs that block this ticket. REPLACES the existing array in full — two agents adding different blockers seconds apart will lose one of them. Use link_tickets to add and unlink_tickets to remove; reach for this only when you deliberately want to set the whole list, or pass an empty array to clear it.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'move_ticket',
    description: 'Move a ticket to a different status (column on the Kanban board). Parameter naming trap: the ticket is identified by "id", NOT "ticketId" — a wrong name is silently ignored and the call 404s indistinguishably from a missing ticket.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ticket to move: its Mongo id or its human key (e.g. "TKT-1"). Alias: ticketId.',
        },
        status: {
          type: 'string',
          description: 'New status. Statuses are configurable per workspace, so this is a free string rather than a fixed list — call list_statuses for the current set (seeded defaults: BACKLOG, TODO, IN_PROGRESS, BLOCKED, REVIEW, DONE). Lowercase input is uppercased. An unknown key is rejected by the backend with the list of known keys.',
        },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'delete_ticket',
    description: 'Delete a ticket. Parameter naming trap: takes "id", NOT "ticketId" — a wrong name is silently ignored and the call 404s indistinguishably from a ticket that does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ticket to delete: its Mongo id or its human key (e.g. "TKT-1"). Alias: ticketId.',
        },
      },
      required: ['id'],
    },
  },

  // ============== BOARD ==============
  {
    name: 'get_board',
    description: 'Get the full Kanban board with tickets grouped by status. One column per row of the statuses collection, in board order, so a workspace that added its own states sees them here. Returns "columns" (the full, configurable set) plus legacy top-level todo / in_progress / done keys for older callers. Parameter naming: filters are "projectId" and "teamId" ("project" and "team" are accepted as aliases — a mistyped filter name would otherwise be silently dropped and quietly return every project\'s tickets). Relationship fields are slim - project {id, prefix}, team (assignee) {id, name}, milestone/createdBy/updatedBy {id, name}, blockedBy an array of ticket IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Filter by project ID. Alias: "project".',
        },
        teamId: {
          type: 'string',
          description: 'Filter by assignee — the ID of a team member (a person). Alias: "team".',
        },
        milestoneId: {
          type: 'string',
          description: 'Filter by milestone ID. Alias: "milestone".',
        },
        include: {
          type: 'array',
          description: 'Additional ticket fields to include. By default only id, title, status, and project are returned.',
          items: {
            type: 'string',
            enum: ['description', 'team', 'priority', 'startDate', 'dueDate', 'milestone', 'customFields', 'labels', 'subtasks', 'blockedBy', 'sortOrder', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },

  // ============== SUBTASKS ==============
  {
    name: 'toggle_subtask',
    description: 'Toggle a subtask completion status. Parameter naming: this tool DOES take "ticketId" (unlike get_ticket / update_ticket / move_ticket / delete_ticket, which take "id"). A wrong parameter name is silently ignored and the call 404s indistinguishably from a missing ticket.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'string',
          description: 'The ticket ID containing the subtask',
        },
        subtaskIndex: {
          type: 'number',
          description: 'The index of the subtask to toggle (0-based)',
        },
      },
      required: ['ticketId', 'subtaskIndex'],
    },
  },
  {
    name: 'add_subtask',
    description: 'Add a subtask to a ticket. Parameter naming: this tool DOES take "ticketId" (unlike get_ticket / update_ticket / move_ticket / delete_ticket, which take "id"). A wrong parameter name is silently ignored and the call 404s indistinguishably from a missing ticket.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'string',
          description: 'The ticket ID to add subtask to',
        },
        title: {
          type: 'string',
          description: 'Subtask title',
        },
      },
      required: ['ticketId', 'title'],
    },
  },

  // ============== STATUSES ==============
  {
    name: 'list_statuses',
    description: 'List the workflow states this workspace uses, in board order. Statuses are configurable DATA (rows in the statuses collection), not a fixed enum, so call this before setting or filtering by a status rather than assuming todo/in_progress/done — the seeded defaults are BACKLOG, TODO, IN_PROGRESS, BLOCKED, REVIEW, DONE, but a workspace can add its own and the backend rejects a key that no row defines. Each row returns: key (the exact value stored on a ticket), label, color, order (left-to-right board position), isDefault (where a ticket with no status lands), isDone (counts as finished — dependency logic reads this) and isBlocked (waiting rather than not-started).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of statuses to return (default: 100)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1)',
        },
      },
    },
  },

  // ============== MILESTONES ==============
  {
    name: 'list_milestones',
    description: 'List milestones — dated markers that work is planned against, such as a concert, a launch, a grant deadline or a board meeting. A milestone with no project applies across every project. By default returns id, name, date, color and project; use "include" for description and timestamps. Parameter naming: the project filter is "projectId" ("project" is accepted as an alias, because a mistyped filter name would otherwise be silently dropped and return every project\'s milestones).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Filter by project ID. Alias: "project". Milestones with no project (workspace-wide ones) are not returned by this filter.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of milestones to return (default: 50)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1). Use with limit to paginate through results.',
        },
        include: {
          type: 'array',
          description: 'Additional fields to include in the response. By default only id, name, date, color, project are returned.',
          items: {
            type: 'string',
            enum: ['description', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },
  {
    name: 'create_milestone',
    description: 'Create a milestone — a dated marker work is planned against (a concert, a launch, a deadline). Tickets point at it through their "milestone" field. Parameter naming: the owning project is passed as "project", NOT "projectId"; leave it out entirely for a milestone that applies to every project.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Milestone name, e.g. "Spring Concert" or "Season launch"',
        },
        date: {
          type: 'string',
          description: 'The date in ISO format (YYYY-MM-DD)',
        },
        color: {
          type: 'string',
          description: 'Hex color code used for the timeline marker (e.g., #ef4444)',
          default: '#ef4444',
        },
        description: {
          type: 'string',
          description: 'Free-text note about this milestone',
        },
        project: {
          type: 'string',
          description: 'Project ID this milestone belongs to. Omit for a milestone that applies across every project. The parameter is called "project", not "projectId".',
        },
      },
      required: ['name', 'date'],
    },
  },
  {
    name: 'update_milestone',
    description: 'Update an existing milestone. Parameter naming trap: the milestone is identified by "id", NOT "milestoneId" — a wrong name is silently ignored, so the call 404s and that bare 404 is indistinguishable from a milestone that does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The milestone ID to update',
        },
        name: {
          type: 'string',
          description: 'New milestone name',
        },
        date: {
          type: 'string',
          description: 'New date in ISO format (YYYY-MM-DD)',
        },
        color: {
          type: 'string',
          description: 'New hex color code',
        },
        description: {
          type: 'string',
          description: 'New free-text note',
        },
        project: {
          type: 'string',
          description: 'New project ID (use null to make the milestone apply across every project)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_milestone',
    description: 'Delete a milestone. Tickets aimed at it keep their dates but lose the marker. Parameter naming trap: takes "id", NOT "milestoneId" — a wrong name is silently ignored and the call 404s indistinguishably from a milestone that does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The milestone ID to delete',
        },
      },
      required: ['id'],
    },
  },

  // ============== DEPENDENCIES ==============
  {
    name: 'link_tickets',
    description: 'Add blockers to a ticket WITHOUT replacing the ones already there. This is the safe way to record a dependency: update_ticket.blockedBy overwrites the whole array, so two agents adding different blockers seconds apart silently lose one of them. This tool reads the current list, unions the new IDs into it and writes the result back, so it is additive and repeating it is harmless. The backend rejects an edge that would close a dependency cycle. Parameter naming: the ticket being blocked is "ticket"; the blockers are "blockedBy". A wrong name 404s indistinguishably from a missing ticket. The `ticket` parameter accepts its Mongo id or its human key (e.g. "TKT-1"); `id` and `ticketId` are accepted as aliases.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: {
          type: 'string',
          description: 'The ID of the ticket that is blocked — the one whose blockedBy list grows',
        },
        blockedBy: {
          type: 'array',
          description: 'Ticket IDs to ADD as blockers. IDs already present are left alone rather than duplicated.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['ticket', 'blockedBy'],
    },
  },
  {
    name: 'unlink_tickets',
    description: 'Remove specific blockers from a ticket, leaving the rest of its blockedBy list intact — the inverse of link_tickets, and the safe alternative to update_ticket.blockedBy, which replaces the whole array. IDs that are not present are ignored. Parameter naming: the blocked ticket is "ticket"; the blockers to drop are "blockedBy". A wrong name 404s indistinguishably from a missing ticket. The `ticket` parameter accepts its Mongo id or its human key (e.g. "TKT-1"); `id` and `ticketId` are accepted as aliases.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: {
          type: 'string',
          description: 'The ID of the ticket whose blockers are being removed',
        },
        blockedBy: {
          type: 'array',
          description: 'Ticket IDs to REMOVE from the blockedBy list. Anything not listed stays.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['ticket', 'blockedBy'],
    },
  },
];

/**
 * The five *_team_member tools are aliases of the five *_team tools and run the very
 * same handlers.
 *
 * Both names stay registered permanently. Four people's live Claude connectors are bound
 * to the older names, and a chat that was open when this server redeployed keeps the tool
 * schema it started with — renaming rather than aliasing would break those sessions with
 * no warning and no fix on the user's side.
 */
const TOOL_ALIASES: Record<string, string> = {
  list_team_members: 'list_teams',
  get_team_member: 'get_team',
  create_team_member: 'create_team',
  update_team_member: 'update_team',
  delete_team_member: 'delete_team',
};

// Tool handlers
/**
 * Accept the parameter names callers actually reach for, not only the ones the schema declares.
 *
 * Why this exists: the ticket tools declare `id`, the subtask tools declare `ticketId`, and
 * `create_ticket` declares `project` while `list_tickets` declares `projectId`. Nothing enforces
 * `required` before the handler runs, so a caller who guesses the wrong (but entirely reasonable)
 * name previously got a request to `/tickets/undefined` — a bare 404 that is indistinguishable
 * from a genuinely missing record. That trap cost real debugging time on 2026-09-04 and again on
 * 2026-09-07. Normalising here is cheaper than everyone rediscovering it.
 */
const ARG_ALIASES: Record<string, Record<string, string>> = {
  get_ticket:     { ticketId: 'id', ticket: 'id' },
  update_ticket:  { ticketId: 'id', ticket: 'id', teamId: 'team', projectId: 'project' },
  move_ticket:    { ticketId: 'id', ticket: 'id' },
  delete_ticket:  { ticketId: 'id', ticket: 'id' },
  create_ticket:  { projectId: 'project', teamId: 'team' },
  list_tickets:   { project: 'projectId', team: 'teamId' },
  get_board:      { project: 'projectId', team: 'teamId' },
  toggle_subtask: { id: 'ticketId', ticket: 'ticketId' },
  add_subtask:    { id: 'ticketId', ticket: 'ticketId' },
  get_project:    { projectId: 'id', project: 'id' },
  update_project: { projectId: 'id', project: 'id' },
  delete_project: { projectId: 'id', project: 'id' },
  get_team:       { teamId: 'id', team: 'id' },
  update_team:    { teamId: 'id', team: 'id' },
  delete_team:    { teamId: 'id', team: 'id' },
  link_tickets:   { id: 'ticket', ticketId: 'ticket' },
  unlink_tickets: { id: 'ticket', ticketId: 'ticket' },
  update_milestone: { milestoneId: 'id', milestone: 'id' },
  delete_milestone: { milestoneId: 'id', milestone: 'id' },
  list_milestones:  { project: 'projectId' },
};

function normalizeArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const aliases = ARG_ALIASES[name];
  if (!aliases) return args;
  const out = { ...args };
  for (const [from, to] of Object.entries(aliases)) {
    if (out[from] !== undefined && out[to] === undefined) {
      out[to] = out[from];
      delete out[from];
    }
  }
  return out;
}

/**
 * Resolve either a Mongo document id or a human ticket key ("TKT-1", "HUB-16") to a Mongo id.
 * People and agents both refer to tickets by their key; only the id addresses the REST route.
 */
async function resolveTicketId(value: unknown, toolName: string): Promise<string> {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    throw new Error(
      `${toolName}: no ticket identifier supplied. Pass "id" — the ticket's Mongo id (e.g. ` +
      `"6a9eedc588c3e6fef1696de1") or its human key (e.g. "TKT-1"). "ticketId" is accepted as an alias.`
    );
  }
  if (/^[0-9a-f]{24}$/i.test(raw)) return raw;
  const found = await apiRequest(
    `/tickets?limit=1&depth=0&where[ticketId][equals]=${encodeURIComponent(raw)}`
  ) as { docs?: Array<{ id?: string }> };
  const id = found.docs?.[0]?.id;
  if (!id) {
    throw new Error(`${toolName}: no ticket found with id or key "${raw}".`);
  }
  return id;
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  // Resolve the alias FIRST, then normalise arguments against the resolved name — so a
  // call to `update_team_member` gets `update_team`'s parameter aliases too.
  const tool = TOOL_ALIASES[name] || name;
  args = normalizeArgs(tool, args);
  switch (tool) {
    // Projects
    case 'list_projects': {
      const limit = (args.limit as number) || 20;
      const page = (args.page as number) || 1;
      const includeFields = (args.include as string[]) || [];
      let query = `?limit=${limit}&page=${page}&depth=0`;
      if (args.status) {
        query += `&where[status][equals]=${toPayloadValue(args.status as string)}`;
      }
      const response = await apiRequest(`/projects${query}`) as {
        docs: Array<Record<string, unknown>>;
        totalDocs: number;
        limit: number;
        totalPages: number;
        page: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        nextPage?: number | null;
        prevPage?: number | null;
      };

      // Default fields always included (excludes heavy description by default)
      const defaultFields = ['id', 'name', 'prefix', 'status', 'color', 'icon'];
      // All optional fields that can be included
      const optionalFields = ['description', 'createdAt', 'updatedAt'];

      // Build the set of fields to include
      const fieldsToInclude = new Set([...defaultFields, ...includeFields.filter(f => optionalFields.includes(f))]);

      // Filter each project to only include requested fields
      const filteredDocs = response.docs.map(project => {
        const filtered: Record<string, unknown> = {};
        for (const field of fieldsToInclude) {
          if (field in project) {
            filtered[field] = project[field];
          }
        }
        return filtered;
      });

      return formatPaginatedResponse({
        ...response,
        docs: filteredDocs,
      });
    }
    case 'get_project': {
      return apiRequest(`/projects/${args.id}?depth=1`);
    }
    case 'create_project': {
      return apiRequest('/projects', 'POST', {
        name: args.name,
        prefix: (args.prefix as string).toUpperCase(),
        description: args.description || null,
        status: toPayloadValue(args.status as string) || 'ACTIVE',
        icon: args.icon || 'folder',
        color: args.color || '#6366f1',
      });
    }
    case 'update_project': {
      const id = args.id;
      const updates: Record<string, unknown> = {};
      if (args.name) updates.name = args.name;
      if (args.description !== undefined) updates.description = args.description;
      if (args.status) updates.status = toPayloadValue(args.status as string);
      if (args.icon) updates.icon = args.icon;
      if (args.color) updates.color = args.color;
      return apiRequest(`/projects/${id}`, 'PATCH', updates);
    }
    case 'delete_project': {
      const { id, deleteTickets = true } = args;
      if (deleteTickets) {
        // First get all tickets for this project
        const ticketsResponse = await apiRequest(
          `/tickets?where[project][equals]=${qs(id)}&limit=1000`
        ) as { docs: Array<{ id: string }> };
        // Delete each ticket
        for (const ticket of ticketsResponse.docs || []) {
          await apiRequest(`/tickets/${ticket.id}`, 'DELETE');
        }
      }
      return apiRequest(`/projects/${id}`, 'DELETE');
    }

    // Teams
    case 'list_teams': {
      const limit = (args.limit as number) || 20;
      const page = (args.page as number) || 1;
      const includeFields = (args.include as string[]) || [];
      const query = `?limit=${limit}&page=${page}&depth=0`;
      const response = await apiRequest(`/teams${query}`) as {
        docs: Array<Record<string, unknown>>;
        totalDocs: number;
        limit: number;
        totalPages: number;
        page: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        nextPage?: number | null;
        prevPage?: number | null;
      };

      // Default fields always included (excludes heavy description by default).
      // These are PEOPLE: name, email, initials, role and active are all cheap and are
      // what a caller needs in order to pick an assignee.
      const defaultFields = ['id', 'name', 'email', 'initials', 'role', 'active', 'color'];
      // All optional fields that can be included
      const optionalFields = ['description', 'createdAt', 'updatedAt'];

      // Build the set of fields to include
      const fieldsToInclude = new Set([...defaultFields, ...includeFields.filter(f => optionalFields.includes(f))]);

      // Filter each team member to only include requested fields
      const filteredDocs = response.docs.map(team => {
        const filtered: Record<string, unknown> = {};
        for (const field of fieldsToInclude) {
          if (field in team) {
            filtered[field] = team[field];
          }
        }
        return filtered;
      });

      return formatPaginatedResponse({
        ...response,
        docs: filteredDocs,
      });
    }
    case 'get_team': {
      return apiRequest(`/teams/${qs(args.id)}?depth=1`);
    }
    case 'create_team': {
      // email and initials are only sent when supplied: `teams` is an auth-enabled
      // collection, so a null email is a validation error rather than "no email", and an
      // absent `initials` lets the collection's hook derive it from the name.
      const body: Record<string, unknown> = {
        name: args.name,
        role: args.role || 'member',
        active: args.active !== undefined ? args.active : true,
        description: args.description || null,
        color: args.color || '#6366f1',
      };
      if (args.email !== undefined) body.email = args.email;
      if (args.initials !== undefined) body.initials = args.initials;
      return apiRequest('/teams', 'POST', body);
    }
    case 'update_team': {
      const id = args.id;
      const updates: Record<string, unknown> = {};
      if (args.name) updates.name = args.name;
      if (args.email !== undefined) updates.email = args.email;
      if (args.initials !== undefined) updates.initials = args.initials;
      if (args.role) updates.role = args.role;
      if (args.active !== undefined) updates.active = args.active;
      if (args.description !== undefined) updates.description = args.description;
      if (args.color) updates.color = args.color;
      return apiRequest(`/teams/${qs(id)}`, 'PATCH', updates);
    }
    case 'delete_team': {
      return apiRequest(`/teams/${qs(args.id)}`, 'DELETE');
    }

    // Tickets
    case 'list_tickets': {
      const limit = (args.limit as number) || 20;
      const page = (args.page as number) || 1;
      const includeFields = (args.include as string[]) || [];

      // Accept both the documented name and the obvious alternative. A filter passed
      // under an unrecognised name is not an error here — it is simply never applied, so
      // the caller gets every project's tickets back and reads that as a broken filter.
      const projectId = firstDefined(args.projectId, args.project);
      const teamId = firstDefined(args.teamId, args.team);
      const milestoneId = firstDefined(args.milestoneId, args.milestone);

      let query = `?limit=${limit}&page=${page}&depth=1`;
      if (projectId) {
        query += `&where[project][equals]=${qs(projectId)}`;
      }
      if (teamId) {
        query += `&where[team][equals]=${qs(teamId)}`;
      }
      if (milestoneId) {
        query += `&where[milestone][equals]=${qs(milestoneId)}`;
      }
      if (args.status) {
        query += `&where[status][equals]=${qs(toStatusKey(args.status as string))}`;
      }
      if (args.priority) {
        query += `&where[priority][equals]=${qs(toPayloadValue(args.priority as string))}`;
      }
      const response = await apiRequest(`/tickets${query}`) as {
        docs: Array<Record<string, unknown>>;
        totalDocs: number;
        limit: number;
        totalPages: number;
        page: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        nextPage?: number | null;
        prevPage?: number | null;
      };

      // Default fields always included (slim versions of relationships)
      const defaultFields = ['id', 'title', 'status', 'project'];
      // All optional fields that can be included
      const optionalFields = ['description', 'team', 'priority', 'startDate', 'dueDate', 'milestone', 'customFields', 'labels', 'subtasks', 'blockedBy', 'sortOrder', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt'];

      // Build the set of fields to include
      const fieldsToInclude = new Set([...defaultFields, ...includeFields.filter(f => optionalFields.includes(f))]);

      // Filter each ticket to only include requested fields, with slimmed relationships
      const filteredDocs = response.docs.map(ticket => slimTicket(ticket, fieldsToInclude));

      return formatPaginatedResponse({
        ...response,
        docs: filteredDocs,
      });
    }
    case 'get_ticket': {
      const id = await resolveTicketId(args.id, 'get_ticket');
      return apiRequest(`/tickets/${qs(id)}?depth=1`);
    }
    case 'create_ticket': {
      // `status` is left off entirely when the caller omits it, so the backend applies
      // whichever status row is marked isDefault rather than a hardcoded TODO.
      const body: Record<string, unknown> = {
        title: args.title,
        description: args.description || null,
        project: args.project,
        team: args.team || null,
        priority: toPayloadValue(args.priority as string) || 'NO_PRIORITY',
        startDate: args.startDate || null,
        dueDate: args.dueDate || null,
        milestone: args.milestone || null,
        labels: args.labels || [],
        subtasks: args.subtasks || [],
        customFields: args.customFields || [],
        blockedBy: args.blockedBy || [],
      };
      const status = toStatusKey(args.status as string);
      if (status) body.status = status;
      return apiRequest('/tickets', 'POST', body);
    }
    case 'update_ticket': {
      const id = await resolveTicketId(args.id, 'update_ticket');
      const updates: Record<string, unknown> = {};
      if (args.title) updates.title = args.title;
      if (args.description !== undefined) updates.description = args.description;
      if (args.team !== undefined) updates.team = args.team;
      if (args.status) updates.status = toStatusKey(args.status as string);
      if (args.priority) updates.priority = toPayloadValue(args.priority as string);
      if (args.startDate !== undefined) updates.startDate = args.startDate;
      if (args.dueDate !== undefined) updates.dueDate = args.dueDate;
      if (args.milestone !== undefined) updates.milestone = args.milestone;
      if (args.labels) updates.labels = args.labels;
      if (args.subtasks) updates.subtasks = args.subtasks;
      if (args.customFields !== undefined) updates.customFields = args.customFields;
      if (args.blockedBy !== undefined) updates.blockedBy = args.blockedBy;
      return apiRequest(`/tickets/${qs(id)}`, 'PATCH', updates);
    }
    case 'move_ticket': {
      const id = await resolveTicketId(args.id, 'move_ticket');
      // toStatusKey, not toPayloadValue: workflow states are configurable now, so an
      // unrecognised status must pass through rather than be rejected.
      return apiRequest(`/tickets/${qs(id)}`, 'PATCH', {
        status: toStatusKey(args.status as string),
      });
    }
    case 'delete_ticket': {
      const id = await resolveTicketId(args.id, 'delete_ticket');
      return apiRequest(`/tickets/${qs(id)}`, 'DELETE');
    }

    // Board
    case 'get_board': {
      const includeFields = (args.include as string[]) || [];

      // Same alias handling as list_tickets: an unrecognised filter name is silently
      // dropped by the schema, which would quietly widen the board to every project.
      const projectId = firstDefined(args.projectId, args.project);
      const teamId = firstDefined(args.teamId, args.team);
      const milestoneId = firstDefined(args.milestoneId, args.milestone);

      let query = '?limit=1000&depth=1';
      if (projectId) {
        query += `&where[project][equals]=${qs(projectId)}`;
      }
      if (teamId) {
        query += `&where[team][equals]=${qs(teamId)}`;
      }
      if (milestoneId) {
        query += `&where[milestone][equals]=${qs(milestoneId)}`;
      }
      const response = await apiRequest(`/tickets${query}`) as { docs: Array<Record<string, unknown>> };
      const tickets = response.docs || [];

      // Columns are the workspace's configured statuses, in board order — hardcoding
      // todo/in_progress/done here would silently hide every ticket sitting in BACKLOG,
      // BLOCKED, REVIEW or any state this workspace added.
      const statuses = await fetchStatusRows();

      // Default fields always included (slim versions of relationships)
      const defaultFields = ['id', 'title', 'status', 'project'];
      // All optional fields that can be included
      const optionalFields = ['description', 'team', 'priority', 'startDate', 'dueDate', 'milestone', 'customFields', 'labels', 'subtasks', 'blockedBy', 'sortOrder', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt'];

      // Build the set of fields to include
      const fieldsToInclude = new Set([...defaultFields, ...includeFields.filter(f => optionalFields.includes(f))]);

      const inStatus = (key: string) =>
        tickets.filter((t) => String(t.status) === key).map(t => slimTicket(t, fieldsToInclude));

      const columns = statuses.map((status) => ({
        key: status.key,
        label: status.label,
        color: status.color,
        isDone: status.isDone ?? false,
        isBlocked: status.isBlocked ?? false,
        tickets: inStatus(status.key),
      }));

      // A ticket whose status matches no row (legacy data, or a status deleted out from
      // under it) must still appear somewhere rather than vanishing off the board.
      const knownKeys = new Set(statuses.map((status) => status.key));
      const orphaned = tickets.filter((t) => !knownKeys.has(String(t.status)));
      if (orphaned.length) {
        columns.push({
          key: 'UNKNOWN',
          label: 'Unknown status',
          color: '#6b7280',
          isDone: false,
          isBlocked: false,
          tickets: orphaned.map(t => slimTicket(t, fieldsToInclude)),
        });
      }

      const byStatus: Record<string, number> = {};
      for (const ticket of tickets) {
        const key = String(ticket.status ?? 'UNKNOWN');
        byStatus[key] = (byStatus[key] || 0) + 1;
      }

      // `columns` is the real board. The three top-level keys below are the pre-statuses
      // response shape, kept so connectors bound to it keep working.
      const board = {
        columns,
        todo: inStatus('TODO'),
        in_progress: inStatus('IN_PROGRESS'),
        done: inStatus('DONE'),
        summary: {
          total: tickets.length,
          byStatus,
          todo: byStatus.TODO || 0,
          inProgress: byStatus.IN_PROGRESS || 0,
          done: byStatus.DONE || 0,
        },
      };
      return board;
    }

    // Subtasks
    case 'toggle_subtask': {
      const ticketId = await resolveTicketId(args.ticketId, 'toggle_subtask');
      const ticket = await apiRequest(`/tickets/${qs(ticketId)}`) as {
        subtasks?: Array<{ title: string; completed: boolean }>
      };
      const subtasks = ticket.subtasks || [];
      const index = args.subtaskIndex as number;

      if (index < 0 || index >= subtasks.length) {
        throw new Error(`Subtask index ${index} out of range`);
      }

      subtasks[index].completed = !subtasks[index].completed;
      return apiRequest(`/tickets/${qs(ticketId)}`, 'PATCH', { subtasks });
    }
    case 'add_subtask': {
      const ticketId = await resolveTicketId(args.ticketId, 'add_subtask');
      const ticket = await apiRequest(`/tickets/${qs(ticketId)}`) as {
        subtasks?: Array<{ title: string; completed: boolean }>
      };
      const subtasks = ticket.subtasks || [];
      subtasks.push({ title: args.title as string, completed: false });
      return apiRequest(`/tickets/${qs(ticketId)}`, 'PATCH', { subtasks });
    }

    // Statuses
    case 'list_statuses': {
      const limit = (args.limit as number) || 100;
      const page = (args.page as number) || 1;
      const response = await apiRequest(
        `/statuses?limit=${limit}&page=${page}&depth=0&sort=order`
      ) as {
        docs: Array<Record<string, unknown>>;
        totalDocs: number;
        limit: number;
        totalPages: number;
        page: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        nextPage?: number | null;
        prevPage?: number | null;
      };

      const fields = ['id', 'key', 'label', 'color', 'order', 'isDefault', 'isDone', 'isBlocked'];
      const filteredDocs = response.docs.map(status => {
        const filtered: Record<string, unknown> = {};
        for (const field of fields) {
          if (field in status) {
            filtered[field] = status[field];
          }
        }
        return filtered;
      });

      return formatPaginatedResponse({
        ...response,
        docs: filteredDocs,
      });
    }

    // Milestones
    case 'list_milestones': {
      const limit = (args.limit as number) || 50;
      const page = (args.page as number) || 1;
      const includeFields = (args.include as string[]) || [];
      const projectId = firstDefined(args.projectId, args.project);

      let query = `?limit=${limit}&page=${page}&depth=1&sort=date`;
      if (projectId) {
        query += `&where[project][equals]=${qs(projectId)}`;
      }
      const response = await apiRequest(`/milestones${query}`) as {
        docs: Array<Record<string, unknown>>;
        totalDocs: number;
        limit: number;
        totalPages: number;
        page: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        nextPage?: number | null;
        prevPage?: number | null;
      };

      // Default fields always included (excludes heavy description by default)
      const defaultFields = ['id', 'name', 'date', 'color', 'project'];
      // All optional fields that can be included
      const optionalFields = ['description', 'createdAt', 'updatedAt'];

      // Build the set of fields to include
      const fieldsToInclude = new Set([...defaultFields, ...includeFields.filter(f => optionalFields.includes(f))]);

      // Filter each milestone to only include requested fields, slimming the project
      const filteredDocs = response.docs.map(milestone => {
        const filtered: Record<string, unknown> = {};
        for (const field of fieldsToInclude) {
          if (!(field in milestone)) continue;
          filtered[field] = field === 'project'
            ? slimProject(milestone[field])
            : milestone[field];
        }
        return filtered;
      });

      return formatPaginatedResponse({
        ...response,
        docs: filteredDocs,
      });
    }
    case 'create_milestone': {
      return apiRequest('/milestones', 'POST', {
        name: args.name,
        date: args.date,
        color: args.color || '#ef4444',
        description: args.description || null,
        project: args.project || null,
      });
    }
    case 'update_milestone': {
      const id = args.id;
      const updates: Record<string, unknown> = {};
      if (args.name) updates.name = args.name;
      if (args.date) updates.date = args.date;
      if (args.color) updates.color = args.color;
      if (args.description !== undefined) updates.description = args.description;
      if (args.project !== undefined) updates.project = args.project;
      return apiRequest(`/milestones/${qs(id)}`, 'PATCH', updates);
    }
    case 'delete_milestone': {
      return apiRequest(`/milestones/${qs(args.id)}`, 'DELETE');
    }

    // Dependencies
    case 'link_tickets': {
      // Read-modify-write, deliberately: update_ticket.blockedBy replaces the whole
      // array, so two agents adding different blockers seconds apart lose one of them.
      // Union the incoming ids into whatever is already stored instead.
      const ticketId = await resolveTicketId(args.ticket, 'link_tickets');
      const incoming = toIdList(args.blockedBy);
      const current = await apiRequest(`/tickets/${qs(ticketId)}?depth=0`) as {
        blockedBy?: unknown;
      };
      const existing = toIdList(current.blockedBy);

      const merged = [...existing];
      const added: string[] = [];
      for (const id of incoming) {
        if (merged.includes(id)) continue;
        merged.push(id);
        added.push(id);
      }

      if (!added.length) {
        // Nothing to do — skip the write rather than bump updatedAt for no reason.
        return { id: ticketId, blockedBy: existing, added: [], alreadyLinked: incoming };
      }

      const updated = await apiRequest(`/tickets/${qs(ticketId)}`, 'PATCH', {
        blockedBy: merged,
      }) as Record<string, unknown>;

      return {
        id: ticketId,
        blockedBy: merged,
        added,
        alreadyLinked: incoming.filter(id => !added.includes(id)),
        ticket: (updated as { doc?: unknown }).doc ?? updated,
      };
    }
    case 'unlink_tickets': {
      // The inverse of link_tickets: drop only the listed ids, keep the rest.
      const ticketId = await resolveTicketId(args.ticket, 'unlink_tickets');
      const outgoing = new Set(toIdList(args.blockedBy));
      const current = await apiRequest(`/tickets/${qs(ticketId)}?depth=0`) as {
        blockedBy?: unknown;
      };
      const existing = toIdList(current.blockedBy);

      const remaining = existing.filter(id => !outgoing.has(id));
      const removed = existing.filter(id => outgoing.has(id));

      if (!removed.length) {
        return { id: ticketId, blockedBy: existing, removed: [], notLinked: [...outgoing] };
      }

      const updated = await apiRequest(`/tickets/${qs(ticketId)}`, 'PATCH', {
        blockedBy: remaining,
      }) as Record<string, unknown>;

      return {
        id: ticketId,
        blockedBy: remaining,
        removed,
        notLinked: [...outgoing].filter(id => !removed.includes(id)),
        ticket: (updated as { doc?: unknown }).doc ?? updated,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Build a fresh, fully-wired MCP Server instance.
 *
 * Deliberately stateless: everything the tools need lives in the Local PM / Payload backend
 * behind LOCAL_PM_URL, not on this object. That makes it safe to call createServer() once per
 * long-lived stdio process (index.ts) OR once per incoming HTTP request in stateless mode
 * (http.ts) without any risk of one caller's session bleeding into another's.
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: 'local-pm-mcp',
      version: '1.2.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await handleToolCall(name, args as Record<string, unknown>);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
