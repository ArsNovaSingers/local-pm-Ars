// Tools and request/response shaping added 2026-09-25 (LPM-1, -3, -7, -8, -12, -13).
//
// Kept out of server.ts on purpose: server.ts owns the original 31 tools and their handlers;
// this file adds new tools and wraps every call with four steps, in order —
//
//   1. validateArgs     reject unknown argument names, naming the closest valid one (LPM-12)
//   2. resolvePeople    "me" / a name / an email / initials -> Team Member id (LPM-8)
//   3. handleExtraTool  new tools, and trash-instead-of-delete for the delete_* tools (LPM-1)
//   4. shapeResult      slim mutation replies; warn when starting blocked work (LPM-13)

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { apiRequest, fetchStatusRows, resolveTicketId, ARG_ALIASES } from './server.js';
import { actorContext } from './context.js';

export const NOT_HANDLED = Symbol('not handled');

type Doc = Record<string, unknown>;
type Paged = { docs: Doc[]; totalDocs: number };

const idOf = (v: unknown): string | null =>
  v == null || v === '' ? null : typeof v === 'object' && 'id' in (v as Doc) ? String((v as Doc).id) : String(v);

const today = () => new Date().toISOString().slice(0, 10);
const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);

// ------------------------------------------------------------------------------------------
// People
// ------------------------------------------------------------------------------------------

interface Person { id: string; name: string; email?: string; initials?: string; role?: string; active?: boolean }

let peopleCache: { at: number; people: Person[] } | undefined;

async function people(): Promise<Person[]> {
  if (peopleCache && Date.now() - peopleCache.at < 60_000) return peopleCache.people;
  const r = (await apiRequest('/teams?limit=200&depth=0')) as Paged;
  const list = r.docs.map((d) => ({
    id: String(d.id), name: String(d.name ?? ''), email: d.email as string | undefined,
    initials: d.initials as string | undefined, role: d.role as string | undefined, active: d.active !== false,
  }));
  peopleCache = { at: Date.now(), people: list };
  return list;
}

async function whoami(): Promise<Person | null> {
  const r = (await apiRequest('/views/whoami')) as { user?: Person | null };
  return r.user ?? null;
}

/**
 * Accepts a Team Member id, "me", an email, a name ("Kim" matches "Kimberly"), or initials.
 * Returns null for "none"/"unassigned"/"" (clear the assignee). Throws a helpful error when
 * nothing — or more than one person — matches.
 */
export async function resolvePerson(value: unknown): Promise<string | null> {
  if (value === null) return null;
  const raw = String(value ?? '').trim();
  if (!raw || /^(none|nobody|unassigned|null)$/i.test(raw)) return null;
  if (/^[0-9a-f]{24}$/i.test(raw)) return raw;
  if (/^(me|myself|i)$/i.test(raw)) {
    const me = await whoami();
    if (!me) throw new Error('Cannot resolve "me": this connection is not signed in as a Team Member.');
    return me.id;
  }
  const q = raw.toLowerCase();
  const all = (await people()).filter((p) => p.active);
  const exact = all.filter((p) =>
    p.email?.toLowerCase() === q || p.name.toLowerCase() === q || p.initials?.toLowerCase() === q);
  const matches = exact.length ? exact : all.filter((p) => p.name.toLowerCase().startsWith(q) || p.email?.toLowerCase().startsWith(q));
  if (matches.length === 1) return matches[0].id;
  const names = all.map((p) => `${p.name} <${p.email ?? '?'}>`).join(', ');
  throw new Error(
    matches.length
      ? `"${raw}" matches more than one person (${matches.map((p) => p.name).join(', ')}). Be more specific.`
      : `No active Team Member matches "${raw}". Team Members: ${names}.`,
  );
}

/** Step 2: turn human references to people into ids, for the tools that take a person. */
export async function resolvePeople(tool: string, args: Doc): Promise<Doc> {
  const out = { ...args };
  const personArg = (key: string) => key in out && out[key] !== undefined;
  if (['list_tickets', 'get_board', 'list_ready'].includes(tool)) {
    const v = out.assignee ?? out.teamId;
    delete out.assignee;
    if (v !== undefined) out.teamId = (await resolvePerson(v)) ?? undefined;
  }
  if (['create_ticket', 'update_ticket'].includes(tool)) {
    if (personArg('assignee') && !personArg('team')) out.team = out.assignee;
    delete out.assignee;
    if (personArg('team')) out.team = await resolvePerson(out.team);
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Argument validation (LPM-12)
// ------------------------------------------------------------------------------------------

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/**
 * Step 1. The schemas never set additionalProperties:false, so a misspelled argument was
 * silently dropped and the call "succeeded" having done less than asked. Now it is an error
 * that names the closest valid argument.
 */
export function validateArgs(tool: string, args: Doc, allTools: Tool[]): void {
  const def = allTools.find((t) => t.name === tool);
  if (!def) return; // unknown tool: the dispatcher reports that
  const allowed = new Set([
    ...Object.keys((def.inputSchema as { properties?: Doc })?.properties ?? {}),
    ...Object.keys(ARG_ALIASES[tool] ?? {}),
    ...Object.values(ARG_ALIASES[tool] ?? {}),
  ]);
  const unknown = Object.keys(args).filter((k) => !allowed.has(k));
  if (!unknown.length) return;
  const valid = [...allowed].sort();
  const hints = unknown.map((k) => {
    const best = valid.map((v) => [v, editDistance(k.toLowerCase(), v.toLowerCase())] as const).sort((a, b) => a[1] - b[1])[0];
    return best && best[1] <= Math.max(2, Math.floor(k.length / 3)) ? `"${k}" (did you mean "${best[0]}"?)` : `"${k}"`;
  });
  throw new Error(`${tool}: unknown argument ${hints.join(', ')}. Nothing was changed. Valid arguments: ${valid.join(', ')}.`);
}

// ------------------------------------------------------------------------------------------
// Shared lookups
// ------------------------------------------------------------------------------------------

async function doneStatusKeys(): Promise<Set<string>> {
  const rows = await fetchStatusRows();
  const done = rows.filter((r) => (r as { isDone?: boolean }).isDone).map((r) => r.key);
  return new Set(done.length ? done : ['DONE']);
}

async function allOpenTickets(filter = ''): Promise<Doc[]> {
  const r = (await apiRequest(`/tickets?limit=1000&depth=1${filter}`)) as Paged;
  const done = await doneStatusKeys();
  return r.docs.filter((t) => !done.has(String(t.status)));
}

/** Compact, human-oriented ticket shape used by every new tool and by mutation replies. */
export function compactTicket(t: Doc): Doc {
  const team = t.team as Doc | string | null;
  const project = t.project as Doc | string | null;
  const milestone = t.milestone as Doc | string | null;
  const subtasks = Array.isArray(t.subtasks) ? (t.subtasks as Doc[]) : [];
  const out: Doc = {
    id: t.id,
    key: t.ticketId ?? null,
    title: t.title,
    status: t.status,
    priority: t.priority,
    project: project && typeof project === 'object' ? project.prefix ?? project.id : project,
    assignee: team && typeof team === 'object' ? team.name : team ?? null,
    dueDate: day(t.dueDate),
  };
  if (t.startDate) out.startDate = day(t.startDate);
  if (milestone) out.milestone = typeof milestone === 'object' ? milestone.name : milestone;
  if (Array.isArray(t.labels) && t.labels.length) out.labels = (t.labels as Doc[]).map((l) => l.name);
  if (Array.isArray(t.blockedBy) && t.blockedBy.length) {
    out.blockedBy = (t.blockedBy as Array<Doc | string>).map((b) => (typeof b === 'object' ? b.ticketId ?? b.id : b));
  }
  if (subtasks.length) out.subtasks = `${subtasks.filter((s) => s.completed).length}/${subtasks.length} done`;
  const ub = t.updatedBy as Doc | string | null;
  if (ub && typeof ub === 'object') out.lastChangedBy = ub.name;
  if (t.deletedAt) out.deletedAt = t.deletedAt;
  return out;
}

async function unfinishedBlockers(ticket: Doc): Promise<string[]> {
  const ids = (Array.isArray(ticket.blockedBy) ? ticket.blockedBy : []).map(idOf).filter(Boolean) as string[];
  if (!ids.length) return [];
  const done = await doneStatusKeys();
  const r = (await apiRequest(`/tickets?limit=100&depth=0&where[id][in]=${ids.join(',')}`)) as Paged;
  return r.docs.filter((b) => !done.has(String(b.status))).map((b) => `${b.ticketId ?? b.id} (${b.status})`);
}

// ------------------------------------------------------------------------------------------
// New tool definitions
// ------------------------------------------------------------------------------------------

const TICKET_REF = { type: 'string', description: 'Ticket key (e.g. "RSM-5") or id' };

export const EXTRA_TOOLS: Tool[] = [
  {
    name: 'whoami',
    description: 'Who this connection is signed in as (name, email, role). Use it to answer "me" questions and before assigning work to "me".',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'my_work',
    description: 'Open tickets assigned to a person (default: me), grouped into overdue / due this week / later / no due date, with a flag on anything blocked by unfinished work. The best answer to "what is on my plate?".',
    inputSchema: {
      type: 'object',
      properties: {
        assignee: { type: 'string', description: '"me" (default), a name like "Kim", an email, or a Team Member id' },
        projectId: { type: 'string', description: 'Optional: only this project (id)' },
      },
    },
  },
  {
    name: 'list_ready',
    description: 'Open tickets that can be started now: every ticket they are blocked by is done (or they have no blockers). Optionally for one person or project.',
    inputSchema: {
      type: 'object',
      properties: {
        assignee: { type: 'string', description: '"me", a name, an email, or a Team Member id' },
        projectId: { type: 'string', description: 'Project id' },
        limit: { type: 'number', description: 'Max tickets to return (default 50)' },
      },
    },
  },
  {
    name: 'list_trash',
    description: 'Items in the Trash (deleted tickets, projects and milestones), newest first, with who deleted them. Trashed items are kept 30 days and can be restored with restore_item.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['tickets', 'projects', 'milestones', 'all'], description: 'Default: all' },
        projectId: { type: 'string', description: 'Only tickets from this project' },
      },
    },
  },
  {
    name: 'restore_item',
    description: 'Restore something from the Trash. Restoring a project also restores the tickets that were trashed with it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Ticket key (e.g. "RSM-5") or the id of a ticket, project or milestone' },
        type: { type: 'string', enum: ['tickets', 'projects', 'milestones'], description: 'Default: tickets' },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a ticket. It is recorded under the signed-in person\'s name. Use comments for updates and discussion instead of editing the description.',
    inputSchema: {
      type: 'object',
      properties: { ticket: TICKET_REF, body: { type: 'string', description: 'Comment text' } },
      required: ['ticket', 'body'],
    },
  },
  {
    name: 'list_comments',
    description: 'Comments on a ticket, oldest first, with author and time.',
    inputSchema: { type: 'object', properties: { ticket: TICKET_REF }, required: ['ticket'] },
  },
  {
    name: 'get_ticket_history',
    description: 'Change history of a ticket: who created it and every change since (field, from, to, who, when), including moves to and from the Trash.',
    inputSchema: {
      type: 'object',
      properties: { ticket: TICKET_REF, limit: { type: 'number', description: 'Default 50' } },
      required: ['ticket'],
    },
  },
  {
    name: 'recent_activity',
    description: 'Recent changes across Local PM (or one project), newest first: "Tom changed status on RSM-5", "Kim created DKL-12". Good for "what happened while I was away?".',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Only this project (id)' },
        since: { type: 'string', description: 'ISO date or datetime; default: last 7 days' },
        limit: { type: 'number', description: 'Default 50' },
      },
    },
  },
];

/** Extra arguments accepted by existing tools. */
export function augmentCoreTools(tools: Tool[]): Tool[] {
  const assignee = { type: 'string', description: 'Person: "me", a name like "Kim", an email, or a Team Member id' };
  return tools.map((t) => {
    const props = { ...((t.inputSchema as { properties?: Doc }).properties ?? {}) };
    if (['list_tickets', 'get_board'].includes(t.name)) props.assignee = { ...assignee, description: 'Filter by person: ' + assignee.description };
    if (['create_ticket', 'update_ticket'].includes(t.name)) {
      props.assignee = { ...assignee, description: 'Who the ticket is assigned to (same as "team"): ' + assignee.description + '; "none" to unassign' };
      if (props.team) props.team = { ...(props.team as Doc), description: 'Assignee: "me", a name, an email, or a Team Member id; "none" to unassign' };
    }
    if (t.name === 'delete_ticket') t = { ...t, description: 'Move a ticket to the Trash (restorable for 30 days with restore_item).' };
    if (t.name === 'delete_project') t = { ...t, description: 'Move a project to the Trash, and by default its tickets with it. Restorable for 30 days with restore_item.' };
    if (t.name === 'delete_milestone') t = { ...t, description: 'Move a milestone to the Trash (restorable for 30 days with restore_item).' };
    if (['delete_team', 'delete_team_member'].includes(t.name)) t = { ...t, description: 'Deactivate a Team Member: they keep their history but drop out of assignment. Nothing is deleted.' };
    return { ...t, inputSchema: { ...t.inputSchema, properties: props } } as Tool;
  });
}

// ------------------------------------------------------------------------------------------
// Handlers
// ------------------------------------------------------------------------------------------

async function trashTicketsOf(projectId: string, at: string): Promise<number> {
  const r = (await apiRequest(`/tickets?limit=1000&depth=0&where[project][equals]=${projectId}`)) as Paged;
  for (const t of r.docs) await apiRequest(`/tickets/${t.id}?depth=0`, 'PATCH', { deletedAt: at });
  return r.docs.length;
}

export async function handleExtraTool(tool: string, args: Doc): Promise<unknown | typeof NOT_HANDLED> {
  switch (tool) {
    case 'whoami': {
      const me = await whoami();
      return me ?? { user: null, note: 'Not signed in as a Team Member (anonymous connection).' };
    }

    case 'my_work': {
      const who = await resolvePerson(args.assignee ?? 'me');
      if (!who) throw new Error('my_work needs a person.');
      const person = (await people()).find((p) => p.id === who);
      let filter = `&where[team][equals]=${who}`;
      if (args.projectId) filter += `&where[project][equals]=${args.projectId}`;
      const open = await allOpenTickets(filter);
      const now = today();
      const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
      const groups: Record<string, Doc[]> = { overdue: [], dueThisWeek: [], later: [], noDueDate: [] };
      for (const t of open) {
        const c = compactTicket(t);
        const blockers = await unfinishedBlockers(t);
        if (blockers.length) c.blockedBy = blockers;
        const d = day(t.dueDate);
        (d == null ? groups.noDueDate : d < now ? groups.overdue : d <= week ? groups.dueThisWeek : groups.later).push(c);
      }
      for (const g of Object.values(groups)) g.sort((a, b) => String(a.dueDate ?? '9').localeCompare(String(b.dueDate ?? '9')));
      return { person: person?.name ?? who, today: now, openTickets: open.length, ...groups };
    }

    case 'list_ready': {
      let filter = '';
      if (args.teamId) filter += `&where[team][equals]=${args.teamId}`;
      if (args.projectId) filter += `&where[project][equals]=${args.projectId}`;
      const open = await allOpenTickets(filter);
      const ready: Doc[] = [];
      for (const t of open) if (!(await unfinishedBlockers(t)).length) ready.push(compactTicket(t));
      ready.sort((a, b) => String(a.dueDate ?? '9').localeCompare(String(b.dueDate ?? '9')));
      const limit = Number(args.limit) || 50;
      return { ready: ready.slice(0, limit), total: ready.length, openInScope: open.length };
    }

    case 'list_trash': {
      const types = !args.type || args.type === 'all' ? ['tickets', 'projects', 'milestones'] : [String(args.type)];
      const out: Doc = {};
      for (const type of types) {
        let q = `/${type}?trash=true&limit=200&depth=1&sort=-deletedAt&where[deletedAt][exists]=true`;
        if (type === 'tickets' && args.projectId) q += `&where[project][equals]=${args.projectId}`;
        const r = (await apiRequest(q)) as Paged;
        out[type] = r.docs.map((d) => ({
          ...(type === 'tickets' ? compactTicket(d) : { id: d.id, name: d.name, prefix: d.prefix }),
          deletedAt: d.deletedAt,
          deletedBy: (d.updatedBy as Doc | null)?.name ?? null,
        }));
      }
      return { ...out, note: 'Trashed items are kept 30 days. Use restore_item to bring one back.' };
    }

    case 'restore_item': {
      const type = String(args.type ?? 'tickets');
      const id = type === 'tickets' ? await resolveTicketIdInTrash(args.id) : String(args.id);
      const doc = (await apiRequest(`/${type}/${id}?trash=true&depth=0`)) as Doc;
      if (!doc.deletedAt) return { message: 'That item is not in the Trash; nothing to restore.', id };
      await apiRequest(`/${type}/${id}?trash=true&depth=0`, 'PATCH', { deletedAt: null });
      let ticketsRestored = 0;
      if (type === 'projects') {
        // Tickets trashed together with the project share its deletedAt (within a minute).
        const at = new Date(String(doc.deletedAt)).getTime();
        const r = (await apiRequest(`/tickets?trash=true&limit=1000&depth=0&where[project][equals]=${id}&where[deletedAt][exists]=true`)) as Paged;
        for (const t of r.docs) {
          if (Math.abs(new Date(String(t.deletedAt)).getTime() - at) <= 60_000) {
            await apiRequest(`/tickets/${t.id}?trash=true&depth=0`, 'PATCH', { deletedAt: null });
            ticketsRestored++;
          }
        }
      }
      return { message: `Restored from the Trash.`, id, key: doc.ticketId ?? doc.prefix ?? doc.name, ticketsRestored };
    }

    case 'add_comment': {
      const ticket = await resolveTicketId(args.ticket, 'add_comment');
      const r = (await apiRequest('/comments?depth=1', 'POST', { ticket, body: args.body })) as { doc: Doc };
      const author = (r.doc.author as Doc | null)?.name ?? null;
      return {
        message: author ? `Comment added as ${author}.` : 'Comment added (anonymous: this connection is not signed in as a Team Member).',
        comment: { id: r.doc.id, author, body: r.doc.body, at: r.doc.createdAt },
      };
    }

    case 'list_comments': {
      const ticket = await resolveTicketId(args.ticket, 'list_comments');
      const r = (await apiRequest(`/comments?limit=200&depth=1&sort=createdAt&where[ticket][equals]=${ticket}`)) as Paged;
      return {
        comments: r.docs.map((c) => ({ id: c.id, author: (c.author as Doc | null)?.name ?? null, body: c.body, at: c.createdAt })),
      };
    }

    case 'get_ticket_history': {
      const ticket = await resolveTicketIdInTrash(args.ticket);
      const limit = Number(args.limit) || 50;
      const r = (await apiRequest(`/activity?limit=${limit}&depth=1&sort=-createdAt&where[ticket][equals]=${ticket}`)) as Paged;
      return { history: r.docs.map(activityLine) };
    }

    case 'recent_activity': {
      const since = String(args.since ?? new Date(Date.now() - 7 * 864e5).toISOString());
      const limit = Number(args.limit) || 50;
      let q = `/activity?limit=${limit}&depth=1&sort=-createdAt&where[createdAt][greater_than_equal]=${encodeURIComponent(since)}`;
      if (args.projectId) q += `&where[project][equals]=${args.projectId}`;
      const r = (await apiRequest(q)) as Paged;
      return { since, activity: r.docs.map(activityLine) };
    }

    // --- Nothing is lost by accident (LPM-1): deletes move to the Trash. -----------------
    case 'delete_ticket': {
      const id = await resolveTicketId(args.id, 'delete_ticket');
      const r = (await apiRequest(`/tickets/${id}?depth=0`, 'PATCH', { deletedAt: new Date().toISOString() })) as { doc: Doc };
      return { message: `Moved ${r.doc.ticketId ?? id} to the Trash. Restore it with restore_item within 30 days.`, id };
    }
    case 'delete_project': {
      const id = String(args.id);
      const at = new Date().toISOString();
      const tickets = args.deleteTickets === false ? 0 : await trashTicketsOf(id, at);
      const r = (await apiRequest(`/projects/${id}?depth=0`, 'PATCH', { deletedAt: at })) as { doc: Doc };
      return {
        message: `Moved project ${r.doc.name} to the Trash${tickets ? ` together with its ${tickets} tickets` : ''}. restore_item with type "projects" brings it all back.`,
        id,
        ticketsTrashed: tickets,
      };
    }
    case 'delete_milestone': {
      const id = String(args.id);
      await apiRequest(`/milestones/${id}?depth=0`, 'PATCH', { deletedAt: new Date().toISOString() });
      return { message: 'Moved the milestone to the Trash.', id };
    }
    case 'delete_team': {
      const id = String(args.id);
      const r = (await apiRequest(`/teams/${id}?depth=0`, 'PATCH', { active: false })) as { doc: Doc };
      peopleCache = undefined;
      return { message: `${r.doc.name} is now inactive: history kept, no longer assignable. Set active=true with update_team_member to undo.`, id };
    }
  }
  return NOT_HANDLED;
}

function activityLine(a: Doc): Doc {
  return {
    at: a.createdAt,
    who: (a.actor as Doc | null)?.name ?? null,
    action: a.action,
    summary: a.summary,
    changes: (a.changes as Doc[] | undefined)?.map((c) => ({ field: c.field, from: c.from, to: c.to })) ?? [],
  };
}

/** Like resolveTicketId, but also finds tickets that are in the Trash. */
async function resolveTicketIdInTrash(value: unknown): Promise<string> {
  const raw = String(value ?? '').trim();
  if (/^[0-9a-f]{24}$/i.test(raw)) return raw;
  const r = (await apiRequest(`/tickets?trash=true&limit=1&depth=0&where[ticketId][equals]=${encodeURIComponent(raw)}`)) as Paged;
  const id = r.docs[0]?.id;
  if (!id) throw new Error(`No ticket found with key "${raw}" (including the Trash).`);
  return String(id);
}

// ------------------------------------------------------------------------------------------
// Step 4: shape replies
// ------------------------------------------------------------------------------------------

const TICKET_MUTATIONS = new Set(['create_ticket', 'update_ticket', 'move_ticket', 'toggle_subtask', 'add_subtask', 'link_tickets', 'unlink_tickets']);

export async function shapeResult(tool: string, args: Doc, result: unknown): Promise<unknown> {
  const r = result as { doc?: Doc; message?: string } | null;
  if (TICKET_MUTATIONS.has(tool) && r?.doc && typeof r.doc === 'object') {
    const shaped: Doc = { message: r.message ?? 'OK', ticket: compactTicket(r.doc) };
    const startedWork = ['update_ticket', 'move_ticket'].includes(tool) && String(r.doc.status) === 'IN_PROGRESS';
    if (startedWork) {
      const blockers = await unfinishedBlockers(r.doc);
      if (blockers.length) shaped.warning = `Started while still blocked by unfinished work: ${blockers.join(', ')}.`;
    }
    return shaped;
  }
  if (['create_project', 'update_project'].includes(tool) && r?.doc) {
    const d = r.doc;
    return { message: r.message ?? 'OK', project: { id: d.id, name: d.name, prefix: d.prefix, status: d.status } };
  }
  if (['create_milestone', 'update_milestone'].includes(tool) && r?.doc) {
    const d = r.doc;
    return { message: r.message ?? 'OK', milestone: { id: d.id, name: d.name, date: day(d.date), project: idOf(d.project) } };
  }
  return result;
}

/** Used by oauth/debug: the current actor's email, if any. */
export const currentActorEmail = () => actorContext.getStore()?.email ?? null;
