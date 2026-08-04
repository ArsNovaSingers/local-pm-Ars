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

// Status mapping (MCP uses lowercase for readability, Payload uses uppercase)
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
    description: 'Get detailed information about a specific project by ID',
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
    description: 'Update an existing project',
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
    description: 'Delete a project and optionally all its tickets',
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

  // ============== TEAMS ==============
  {
    name: 'list_teams',
    description: 'List all teams in Local PM. By default returns only basic fields (id, name, color). Use "include" to request additional fields like description.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of teams to return (default: 20)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1). Use with limit to paginate through results.',
        },
        include: {
          type: 'array',
          description: 'Additional fields to include in the response. By default only id, name, color are returned.',
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
    description: 'Get detailed information about a specific team by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The team ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_team',
    description: 'Create a new team in Local PM',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Team name',
        },
        description: {
          type: 'string',
          description: 'Team description (supports HTML for rich text)',
        },
        color: {
          type: 'string',
          description: 'Hex color code (e.g., #6366f1)',
          default: '#6366f1',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_team',
    description: 'Update an existing team',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The team ID to update',
        },
        name: {
          type: 'string',
          description: 'New team name',
        },
        description: {
          type: 'string',
          description: 'New team description',
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
    description: 'Delete a team (tickets assigned to this team will become unassigned)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The team ID to delete',
        },
      },
      required: ['id'],
    },
  },

  // ============== TICKETS ==============
  {
    name: 'list_tickets',
    description: 'List tickets in Local PM with optional filters. By default returns only basic fields (id, title, status, project). Use "include" to request additional fields. Note: Relationship fields are returned in slim format - project returns {id, prefix}, team returns {id, name}, blockedBy returns array of ticket IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Filter by project ID',
        },
        teamId: {
          type: 'string',
          description: 'Filter by team ID',
        },
        status: {
          type: 'string',
          description: 'Filter by status',
          enum: ['todo', 'in_progress', 'done'],
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
            enum: ['description', 'team', 'priority', 'dueDate', 'labels', 'subtasks', 'blockedBy', 'sortOrder', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },
  {
    name: 'get_ticket',
    description: 'Get detailed information about a specific ticket by ID',
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
    description: 'Create a new ticket in Local PM',
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
          description: 'Project ID (required)',
        },
        team: {
          type: 'string',
          description: 'Team ID (optional)',
        },
        status: {
          type: 'string',
          description: 'Ticket status',
          enum: ['todo', 'in_progress', 'done'],
          default: 'todo',
        },
        priority: {
          type: 'string',
          description: 'Ticket priority',
          enum: ['no_priority', 'urgent', 'high', 'medium', 'low'],
          default: 'no_priority',
        },
        dueDate: {
          type: 'string',
          description: 'Due date in ISO format (YYYY-MM-DD)',
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
    description: 'Update an existing ticket',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ticket ID to update',
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
          description: 'New team ID (use null to unassign)',
        },
        status: {
          type: 'string',
          description: 'New ticket status',
          enum: ['todo', 'in_progress', 'done'],
        },
        priority: {
          type: 'string',
          description: 'New ticket priority',
          enum: ['no_priority', 'urgent', 'high', 'medium', 'low'],
        },
        dueDate: {
          type: 'string',
          description: 'New due date in ISO format (use null to clear)',
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
          description: 'Array of ticket IDs that block this ticket (replaces existing). Use empty array to clear.',
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
    description: 'Move a ticket to a different status (column on the Kanban board)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ticket ID to move',
        },
        status: {
          type: 'string',
          description: 'New status',
          enum: ['todo', 'in_progress', 'done'],
        },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'delete_ticket',
    description: 'Delete a ticket',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ticket ID to delete',
        },
      },
      required: ['id'],
    },
  },

  // ============== BOARD ==============
  {
    name: 'get_board',
    description: 'Get the full Kanban board with tickets grouped by status. Optionally filter by project or team. By default returns only basic ticket fields (id, title, status, project). Use "include" to request additional fields. Note: Relationship fields are returned in slim format - project returns {id, prefix}, team returns {id, name}, blockedBy returns array of ticket IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Filter by project ID',
        },
        teamId: {
          type: 'string',
          description: 'Filter by team ID',
        },
        include: {
          type: 'array',
          description: 'Additional ticket fields to include. By default only id, title, status, and project are returned.',
          items: {
            type: 'string',
            enum: ['description', 'team', 'priority', 'dueDate', 'labels', 'subtasks', 'blockedBy', 'sortOrder', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },

  // ============== SUBTASKS ==============
  {
    name: 'toggle_subtask',
    description: 'Toggle a subtask completion status',
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
    description: 'Add a subtask to a ticket',
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
];

// Tool handlers
async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
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
          `/tickets?where[project][equals]=${id}&limit=1000`
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

      // Default fields always included (excludes heavy description by default)
      const defaultFields = ['id', 'name', 'color'];
      // All optional fields that can be included
      const optionalFields = ['description', 'createdAt', 'updatedAt'];

      // Build the set of fields to include
      const fieldsToInclude = new Set([...defaultFields, ...includeFields.filter(f => optionalFields.includes(f))]);

      // Filter each team to only include requested fields
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
      return apiRequest(`/teams/${args.id}?depth=1`);
    }
    case 'create_team': {
      return apiRequest('/teams', 'POST', {
        name: args.name,
        description: args.description || null,
        color: args.color || '#6366f1',
      });
    }
    case 'update_team': {
      const { id, ...updates } = args;
      return apiRequest(`/teams/${id}`, 'PATCH', updates);
    }
    case 'delete_team': {
      return apiRequest(`/teams/${args.id}`, 'DELETE');
    }

    // Tickets
    case 'list_tickets': {
      const limit = (args.limit as number) || 20;
      const page = (args.page as number) || 1;
      const includeFields = (args.include as string[]) || [];

      let query = `?limit=${limit}&page=${page}&depth=1`;
      if (args.projectId) {
        query += `&where[project][equals]=${args.projectId}`;
      }
      if (args.teamId) {
        query += `&where[team][equals]=${args.teamId}`;
      }
      if (args.status) {
        query += `&where[status][equals]=${toPayloadValue(args.status as string)}`;
      }
      if (args.priority) {
        query += `&where[priority][equals]=${toPayloadValue(args.priority as string)}`;
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
      const optionalFields = ['description', 'team', 'priority', 'dueDate', 'labels', 'subtasks', 'blockedBy', 'sortOrder', 'createdAt', 'updatedAt'];

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
      return apiRequest(`/tickets/${args.id}?depth=1`);
    }
    case 'create_ticket': {
      return apiRequest('/tickets', 'POST', {
        title: args.title,
        description: args.description || null,
        project: args.project,
        team: args.team || null,
        status: toPayloadValue(args.status as string) || 'TODO',
        priority: toPayloadValue(args.priority as string) || 'NO_PRIORITY',
        dueDate: args.dueDate || null,
        labels: args.labels || [],
        subtasks: args.subtasks || [],
        blockedBy: args.blockedBy || [],
      });
    }
    case 'update_ticket': {
      const id = args.id;
      const updates: Record<string, unknown> = {};
      if (args.title) updates.title = args.title;
      if (args.description !== undefined) updates.description = args.description;
      if (args.team !== undefined) updates.team = args.team;
      if (args.status) updates.status = toPayloadValue(args.status as string);
      if (args.priority) updates.priority = toPayloadValue(args.priority as string);
      if (args.dueDate !== undefined) updates.dueDate = args.dueDate;
      if (args.labels) updates.labels = args.labels;
      if (args.subtasks) updates.subtasks = args.subtasks;
      if (args.blockedBy !== undefined) updates.blockedBy = args.blockedBy;
      return apiRequest(`/tickets/${id}`, 'PATCH', updates);
    }
    case 'move_ticket': {
      return apiRequest(`/tickets/${args.id}`, 'PATCH', {
        status: toPayloadValue(args.status as string),
      });
    }
    case 'delete_ticket': {
      return apiRequest(`/tickets/${args.id}`, 'DELETE');
    }

    // Board
    case 'get_board': {
      const includeFields = (args.include as string[]) || [];

      let query = '?limit=1000&depth=1';
      if (args.projectId) {
        query += `&where[project][equals]=${args.projectId}`;
      }
      if (args.teamId) {
        query += `&where[team][equals]=${args.teamId}`;
      }
      const response = await apiRequest(`/tickets${query}`) as { docs: Array<Record<string, unknown>> };
      const tickets = response.docs || [];

      // Default fields always included (slim versions of relationships)
      const defaultFields = ['id', 'title', 'status', 'project'];
      // All optional fields that can be included
      const optionalFields = ['description', 'team', 'priority', 'dueDate', 'labels', 'subtasks', 'blockedBy', 'sortOrder', 'createdAt', 'updatedAt'];

      // Build the set of fields to include
      const fieldsToInclude = new Set([...defaultFields, ...includeFields.filter(f => optionalFields.includes(f))]);

      // Group by status with filtered and slimmed fields
      const board = {
        todo: tickets.filter((t) => t.status === 'TODO').map(t => slimTicket(t, fieldsToInclude)),
        in_progress: tickets.filter((t) => t.status === 'IN_PROGRESS').map(t => slimTicket(t, fieldsToInclude)),
        done: tickets.filter((t) => t.status === 'DONE').map(t => slimTicket(t, fieldsToInclude)),
        summary: {
          total: tickets.length,
          todo: tickets.filter((t) => t.status === 'TODO').length,
          inProgress: tickets.filter((t) => t.status === 'IN_PROGRESS').length,
          done: tickets.filter((t) => t.status === 'DONE').length,
        },
      };
      return board;
    }

    // Subtasks
    case 'toggle_subtask': {
      const ticket = await apiRequest(`/tickets/${args.ticketId}`) as {
        subtasks?: Array<{ title: string; completed: boolean }>
      };
      const subtasks = ticket.subtasks || [];
      const index = args.subtaskIndex as number;

      if (index < 0 || index >= subtasks.length) {
        throw new Error(`Subtask index ${index} out of range`);
      }

      subtasks[index].completed = !subtasks[index].completed;
      return apiRequest(`/tickets/${args.ticketId}`, 'PATCH', { subtasks });
    }
    case 'add_subtask': {
      const ticket = await apiRequest(`/tickets/${args.ticketId}`) as {
        subtasks?: Array<{ title: string; completed: boolean }>
      };
      const subtasks = ticket.subtasks || [];
      subtasks.push({ title: args.title as string, completed: false });
      return apiRequest(`/tickets/${args.ticketId}`, 'PATCH', { subtasks });
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
      version: '1.0.0',
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
