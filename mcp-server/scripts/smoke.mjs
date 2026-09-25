// End-to-end smoke test for the Local PM MCP server, driven the way Claude drives it.
//
//   MCP_URL=http://localhost:8798/mcp MCP_KEY=<legacy key> node scripts/smoke.mjs
//
// Run it against a STAGING backend only: it creates, edits, trashes and restores a ticket
// and adds a comment. It cleans up by leaving the test ticket in the Trash.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.env.MCP_URL ?? 'http://localhost:8798/mcp');
if (process.env.MCP_KEY) url.searchParams.set('key', process.env.MCP_KEY);
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(url));

let pass = 0, fail = 0;
const results = [];
async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { isError: Boolean(r.isError), data, text };
}
function check(label, ok, detail = '') {
  ok ? pass++ : fail++;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -- ' + detail : ''}`);
}

// tools list + annotations
const { tools } = await client.listTools();
const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
for (const n of ['whoami', 'my_work', 'list_ready', 'list_trash', 'restore_item', 'add_comment', 'list_comments', 'get_ticket_history', 'recent_activity'])
  check(`tool listed: ${n}`, Boolean(byName[n]));
check('delete_project marked destructive', byName.delete_project?.annotations?.destructiveHint === true);
check('list_tickets marked read-only', byName.list_tickets?.annotations?.readOnlyHint === true);

// whoami
const me = await call('whoami');
check('whoami returns a person', !me.isError && me.data?.email, JSON.stringify(me.data).slice(0, 120));

// project
const projects = await call('list_projects', { limit: 50 });
const lpm = projects.data.items?.find((p) => p.prefix === 'LPM');
check('LPM project found', Boolean(lpm));

// strict args
const bad = await call('list_tickets', { projectId: lpm.id, asignee: 'me' });
check('misspelled arg rejected with suggestion', bad.isError && /did you mean "assignee"/.test(bad.text), bad.text.slice(0, 160));

// create assigned to "me", slim reply
const created = await call('create_ticket', { project: lpm.id, title: 'SMOKE ticket', assignee: 'me', dueDate: '2026-09-20' });
const t = created.data?.ticket;
check('create_ticket assignee "me" resolves', !created.isError && t?.assignee === me.data.name, JSON.stringify(created.data).slice(0, 200));
check('create_ticket reply is compact (<1.5KB)', created.text.length < 1500, `${created.text.length} bytes`);

// assign by first name, then back
const tom = await call('update_ticket', { id: t.key, assignee: 'Tom' });
check('update_ticket assignee by name', tom.data?.ticket?.assignee === 'Tom', JSON.stringify(tom.data).slice(0, 160));
const back = await call('update_ticket', { id: t.key, team: 'me' });
check('update_ticket team "me"', back.data?.ticket?.assignee === me.data.name);
const ambiguous = await call('update_ticket', { id: t.key, assignee: 'Nobody Here' });
check('unknown person is an error listing people', ambiguous.isError && /Team Members:/.test(ambiguous.text));

// blocked-start warning + list_ready
const blocker = await call('create_ticket', { project: lpm.id, title: 'SMOKE blocker', assignee: 'me' });
await call('update_ticket', { id: t.key, blockedBy: [blocker.data.ticket.id] });
const started = await call('move_ticket', { id: t.key, status: 'in_progress' });
check('starting blocked work returns a warning', /blocked by unfinished/.test(started.data?.warning ?? ''), JSON.stringify(started.data).slice(0, 200));
const ready1 = await call('list_ready', { assignee: 'me', projectId: lpm.id, limit: 500 });
check('blocked ticket NOT in list_ready', !ready1.data.ready.some((x) => x.key === t.key));
await call('move_ticket', { id: blocker.data.ticket.key, status: 'done' });
const ready2 = await call('list_ready', { assignee: 'me', projectId: lpm.id, limit: 500 });
check('ticket appears in list_ready once its blocker is done', ready2.data.ready.some((x) => x.key === t.key));

// my_work
const mw = await call('my_work', {});
check('my_work groups overdue', mw.data.overdue?.some((x) => x.key === t.key), `overdue=${mw.data.overdue?.length}`);

// comments
const c = await call('add_comment', { ticket: t.key, body: 'Smoke test comment' });
check('add_comment credited to me', new RegExp(me.data.name).test(c.data?.message ?? ''), c.text.slice(0, 120));
const cl = await call('list_comments', { ticket: t.key });
check('list_comments returns it', cl.data.comments?.some((x) => x.body === 'Smoke test comment' && x.author === me.data.name));

// history
const h = await call('get_ticket_history', { ticket: t.key });
const fields = h.data.history?.flatMap((e) => e.changes.map((ch) => ch.field)) ?? [];
check('history records create + assignee + status + blockedBy', h.data.history?.some((e) => e.action === 'created') && fields.includes('team') && fields.includes('status') && fields.includes('blockedBy'), fields.join(','));
const ra = await call('recent_activity', { projectId: lpm.id, limit: 20 });
check('recent_activity lists the change', ra.data.activity?.some((e) => (e.summary ?? '').includes(t.key)));

// trash / restore
const del = await call('delete_ticket', { id: t.key });
check('delete_ticket moves to Trash', /Trash/.test(del.data?.message ?? ''), del.text.slice(0, 120));
const gone = await call('list_tickets', { projectId: lpm.id, limit: 200 });
check('trashed ticket hidden from list_tickets', !gone.data.items.some((x) => x.id === t.id));
const trash = await call('list_trash', { type: 'tickets', projectId: lpm.id });
check('list_trash shows it with deletedBy', trash.data.tickets?.some((x) => x.key === t.key && x.deletedBy === me.data.name));
const res = await call('restore_item', { id: t.key });
check('restore_item restores', /Restored/.test(res.data?.message ?? ''));
const backList = await call('list_tickets', { projectId: lpm.id, limit: 200 });
check('restored ticket visible again', backList.data.items.some((x) => x.id === t.id));

// cleanup: leave both smoke tickets in the Trash
await call('delete_ticket', { id: t.key });
await call('delete_ticket', { id: blocker.data.ticket.key });

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
await client.close();
process.exit(fail ? 1 : 0);
