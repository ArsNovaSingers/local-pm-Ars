# Local PM MCP Server

A Model Context Protocol (MCP) server for Local PM - a lightweight project management system with Kanban boards.

## Features

This MCP server provides AI models with full access to Local PM functionality.

### Projects
- `list_projects` - List all projects with pagination
- `get_project` - Get project details by ID
- `create_project` - Create a new project
- `update_project` - Update an existing project
- `delete_project` - Delete a project

### Team Members (people)
The `teams` collection holds **people**, not groups — it is titled "Team Members" in the UI,
and a ticket's `team` field is the **assignee**. The slug and the older tool names stay
`team` on purpose (see [Two names for the team tools](#two-names-for-the-team-tools)).

Preferred names:
- `list_team_members` - List the people who can be assigned tickets
- `get_team_member` - Get one person by ID
- `create_team_member` - Add a person (name, email, initials, role, active)
- `update_team_member` - Update a person
- `delete_team_member` - Delete a person

Older names, still registered and still working — identical handlers, identical arguments:
- `list_teams`, `get_team`, `create_team`, `update_team`, `delete_team`

### Tickets
- `list_tickets` - List tickets, filtered by project, assignee, milestone, status or priority
- `get_ticket` - Get ticket details by ID (includes subtasks)
- `create_ticket` - Create a ticket, with start/due dates, milestone, custom fields, subtasks
- `update_ticket` - Update ticket fields
- `move_ticket` - Move a ticket to another status
- `delete_ticket` - Delete a ticket

### Statuses
- `list_statuses` - List the workspace's workflow states, in board order

Workflow states are **data**, not a fixed enum: they are rows in the `statuses` collection.
The seeded defaults are `BACKLOG`, `TODO`, `IN_PROGRESS`, `BLOCKED`, `REVIEW`, `DONE`, and a
workspace can add its own. Every status argument on every tool is therefore a free string;
call `list_statuses` rather than assuming a set. Lowercase input (`in_progress`) is accepted
and uppercased.

### Milestones
- `list_milestones` - List dated markers work is planned against
- `create_milestone` - Create a milestone (name, date, color, description, project)
- `update_milestone` - Update a milestone
- `delete_milestone` - Delete a milestone

A milestone with no `project` applies across every project.

### Dependencies
- `link_tickets` - **Add** blockers to a ticket without replacing the existing ones
- `unlink_tickets` - Remove specific blockers, leaving the rest

`update_ticket.blockedBy` replaces the whole array, so two agents adding different blockers
seconds apart silently lose one. `link_tickets` and `unlink_tickets` read-modify-write the
list instead and are the right tool for a single edge.

### Board View
- `get_board` - Kanban board, one column per configured status, in board order

### Subtasks
- `toggle_subtask` - Toggle a subtask's completion status
- `add_subtask` - Add a new subtask to a ticket

## Two names for the team tools

`list_team_members` / `get_team_member` / `create_team_member` / `update_team_member` /
`delete_team_member` are aliases dispatched onto the same handlers as `list_teams` /
`get_team` / `create_team` / `update_team` / `delete_team`. Both sets stay registered.

Renaming rather than aliasing would break live sessions: existing Claude connectors are bound
to the older names, and a chat that was open when this server redeployed keeps the tool schema
it started with. Prefer the `*_team_member` names in new work — the descriptions steer models
toward them — but never remove the old ones.

## Argument-name traps

The MCP input schemas here do not set `additionalProperties: false`, so an argument passed
under the wrong name is **silently dropped**, not rejected. That produces two failure modes
worth knowing:

| Tool | Correct name | Common wrong name | What a wrong name looks like |
|------|--------------|-------------------|------------------------------|
| `create_ticket` | `project` | `projectId` | required-field error that reads like a missing project |
| `get_ticket`, `update_ticket`, `move_ticket`, `delete_ticket` | `id` | `ticketId` | a bare **404**, indistinguishable from a ticket that does not exist |
| `toggle_subtask`, `add_subtask` | `ticketId` | `id` | same bare 404 |
| `get_project`, `update_project`, `delete_project` | `id` | `projectId` | same bare 404 |
| `update_milestone`, `delete_milestone` | `id` | `milestoneId` | same bare 404 |
| `list_tickets`, `get_board` | `projectId` / `teamId` / `milestoneId` | `project` / `team` / `milestone` | filter never applied — **every project's tickets come back** |

That last row was a real bug: this README used to document `list_tickets`'s filter as
`project` while the code only ever read `projectId`, so the filter did nothing and the tool
appeared to "return tickets from other projects". `list_tickets`, `get_board` and
`list_milestones` now accept **both** spellings, and all ids are URL-encoded before they go
into a `where` clause.

A 404 from any of these tools means *either* a wrong argument name *or* a missing record.
Check the argument name first.

## Installation

### Prerequisites
- Node.js 18+
- Local PM running at `http://localhost:3010` (or custom URL)

### Build from Source

```bash
cd mcp-server
npm install
npm run build
```

### Global Installation

```bash
cd mcp-server
npm install
npm run build
npm link
```

This makes `local-pm-mcp` available globally.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_PM_URL` | `http://localhost:3010` | Base URL of Local PM instance |

### Claude Desktop Configuration

Add to your Claude Desktop config file:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "local-pm": {
      "command": "node",
      "args": ["C:/projects/local-pm/mcp-server/dist/index.js"],
      "env": {
        "LOCAL_PM_URL": "http://localhost:3010"
      }
    }
  }
}
```

Or if installed globally via `npm link`:

```json
{
  "mcpServers": {
    "local-pm": {
      "command": "local-pm-mcp",
      "env": {
        "LOCAL_PM_URL": "http://localhost:3010"
      }
    }
  }
}
```

### Claude Code Configuration

Add to your Claude Code settings file:

**Windows**: `%USERPROFILE%\.claude\settings.json`
**macOS/Linux**: `~/.claude/settings.json`

```json
{
  "mcpServers": {
    "local-pm": {
      "command": "node",
      "args": ["C:/projects/local-pm/mcp-server/dist/index.js"],
      "env": {
        "LOCAL_PM_URL": "http://localhost:3010"
      }
    }
  }
}
```

## Remote / Cloud Run Deployment

Besides the stdio mode above (a local subprocess Claude Desktop/Code spawns per machine), this
server also has an HTTP entry point (`src/http.ts` → `dist/http.js`) that runs as a persistent
Streamable HTTP MCP server — deployable to Cloud Run (or any container host) and reachable from
desktop, phone, and scheduled/headless sessions alike, not just one machine's Claude Desktop
config.

### Running it

```bash
npm run build
npm run start:http
```

### Environment Variables (HTTP mode)

| Variable | Default | Description |
|----------|---------|--------------|
| `PORT` | `8080` | Port the HTTP server listens on (Cloud Run sets this automatically) |
| `LOCAL_PM_URL` | `http://localhost:3010` | Base URL of the Local PM instance to proxy to — point this at your deployed app's URL, not `localhost`, when running remotely |
| `MCP_AUTH_TOKEN` | *(none)* | Shared-secret gate. **Required for any deployment reachable from the internet** — without it the server accepts unauthenticated requests. Checked against either an `Authorization: Bearer <token>` header or a `?key=<token>` query param |
| `IAP_AUDIENCE` | *(none)* | Only needed when `LOCAL_PM_URL` points at a Cloud Run service sitting behind Identity-Aware Proxy (IAP) — IAP gates every path on that service, including this REST API, not just its browser UI. Set to that resource's IAP OAuth **Client ID** (format `NNNNN-xxxxx.apps.googleusercontent.com`, from GCP Console → Security → Identity-Aware Proxy → the resource → Settings). Requires the resource's IAP to use a *custom* OAuth client — Google-managed IAP clients (the default from a plain `--iap` flag) cannot be used for programmatic access at all. When set, this server mints its own Google ID token via its Cloud Run service account (no key file) and attaches it to every outbound call; also grant that service account `roles/iap.httpsResourceAccessor` on the target resource. Leave unset for a plain, non-IAP backend |

### Adding it as a custom connector in Claude

Settings → Connectors → Add custom connector → URL:
```
https://<your-cloud-run-url>/mcp?key=<MCP_AUTH_TOKEN>
```

The first attempt may show a "couldn't register with sign-in service" error — this is expected
(the server intentionally 401s the OAuth discovery paths Claude probes first) and clears up if you
click Add/retry once; leave the OAuth Client ID field blank.

### Dockerfile

`mcp-server/Dockerfile` builds and runs `dist/http.js` in a small Node 20-alpine image, matching
the pattern used for the main Local PM app's Dockerfile in the repo root.

## Usage Examples

Once configured, AI models can interact with Local PM:

### Create a Project
```
Create a new project called "Website Redesign" with color blue
```

### Create Tickets
```
Create a ticket "Design homepage mockup" in the Website Redesign project
```

### View Board
```
Show me the Kanban board for the Website Redesign project
```

### Move Tickets
```
Move ticket WEBS-1 to in_progress status
```

### Add Subtasks
```
Add subtasks "Create wireframe" and "Review with team" to ticket WEBS-1
```

## Tool Reference

Every id argument below is URL-encoded before it reaches the API. Where a tool takes an id,
the parameter name is stated explicitly — see [Argument-name traps](#argument-name-traps).

### Projects

#### list_projects
- `status` (string, optional): `active` | `on_hold` | `completed` | `cancelled`
- `limit` (number, optional): max results (default: 20)
- `page` (number, optional): page number (default: 1)
- `include` (string[], optional): `description`, `createdAt`, `updatedAt`

#### get_project / delete_project
- `id` (string, required): the project ID — **not** `projectId`
- `deleteTickets` (boolean, `delete_project` only, default `true`)

#### create_project
- `name` (string, required), `prefix` (string, required, 2-6 uppercase letters)
- `description`, `status`, `icon`, `color` (all optional)

#### update_project
- `id` (string, required), plus any of `name`, `description`, `status`, `icon`, `color`

### Team Members

`list_team_members` / `get_team_member` / `create_team_member` / `update_team_member` /
`delete_team_member` take exactly the same arguments as `list_teams` / `get_team` /
`create_team` / `update_team` / `delete_team`.

#### list_team_members (alias of list_teams)
- `limit` (number, optional): max results (default: 20)
- `page` (number, optional): page number (default: 1)
- `include` (string[], optional): `description`, `createdAt`, `updatedAt`

Returns `id`, `name`, `email`, `initials`, `role`, `active`, `color` by default.

#### get_team_member (alias of get_team)
- `id` (string, required): the team member ID

#### create_team_member (alias of create_team)
- `name` (string, required): the person's display name, e.g. `Kimberly Brody`
- `email` (string, optional): also their sign-in identity for the admin UI
- `initials` (string, optional): up to 3 chars; derived from the name when omitted
- `role` (string, optional): `admin` | `member` | `agent` (default `member`)
- `active` (boolean, optional, default `true`)
- `description`, `color` (optional)

#### update_team_member (alias of update_team)
- `id` (string, required), plus any of `name`, `email`, `initials`, `role`, `active`,
  `description`, `color`

Prefer `active: false` over deletion when the person has history worth keeping.

#### delete_team_member (alias of delete_team)
- `id` (string, required): tickets assigned to them become unassigned

### Tickets

#### list_tickets
- `projectId` (string, optional; alias `project`): filter by project
- `teamId` (string, optional; alias `team`): filter by assignee
- `milestoneId` (string, optional; alias `milestone`): filter by milestone
- `status` (string, optional): any configured status key — see `list_statuses`
- `priority` (string, optional): `no_priority` | `urgent` | `high` | `medium` | `low`
- `limit`, `page` (numbers, optional)
- `include` (string[], optional): `description`, `team`, `priority`, `startDate`, `dueDate`,
  `milestone`, `customFields`, `labels`, `subtasks`, `blockedBy`, `sortOrder`, `createdBy`,
  `updatedBy`, `createdAt`, `updatedAt`

Relationships come back slim: `project` → `{id, prefix}`; `team`, `milestone`, `createdBy`,
`updatedBy` → `{id, name}`; `blockedBy` → array of ticket IDs.

#### get_ticket
- `id` (string, required): the ticket ID — **not** `ticketId`

#### create_ticket
- `title` (string, required)
- `project` (string, required): the project ID — the parameter is `project`, **not** `projectId`
- `team` (string, optional): assignee — a team member (person) ID
- `description` (string, optional): supports HTML
- `status` (string, optional): any configured status key; omit to use the workspace default
- `priority` (string, optional)
- `startDate` (string, optional): `YYYY-MM-DD`
- `dueDate` (string, optional): `YYYY-MM-DD`
- `milestone` (string, optional): milestone ID
- `customFields` (array, optional): `{key, value}` pairs, keys matching `field-definitions`
- `labels` (array, optional): `{name, color}`
- `subtasks` (array, optional): `{title, completed}`
- `blockedBy` (string[], optional): ticket IDs that block this one

#### update_ticket
- `id` (string, required): the ticket ID — **not** `ticketId`
- Any of `title`, `description`, `team`, `status`, `priority`, `startDate`, `dueDate`,
  `milestone`, `customFields`, `labels`, `subtasks`, `blockedBy`

`labels`, `subtasks`, `customFields` and `blockedBy` **replace** the existing array. For a
single dependency edge use `link_tickets` / `unlink_tickets` instead.

#### move_ticket
- `id` (string, required), `status` (string, required): any configured status key

#### delete_ticket
- `id` (string, required)

### list_statuses
- `limit` (number, optional, default 100), `page` (number, optional)

Returns, in board order: `key` (the value stored on a ticket), `label`, `color`, `order`,
`isDefault` (where a ticket with no status lands), `isDone` (dependency logic reads this),
`isBlocked`.

### Milestones

#### list_milestones
- `projectId` (string, optional; alias `project`)
- `limit` (number, optional, default 50), `page` (number, optional)
- `include` (string[], optional): `description`, `createdAt`, `updatedAt`

#### create_milestone
- `name` (string, required), `date` (string, required, `YYYY-MM-DD`)
- `color`, `description` (optional)
- `project` (string, optional): the parameter is `project`, **not** `projectId`; omit for a
  milestone that applies across every project

#### update_milestone
- `id` (string, required) — **not** `milestoneId`; plus any of `name`, `date`, `color`,
  `description`, `project`

#### delete_milestone
- `id` (string, required)

### Dependencies

#### link_tickets
- `ticket` (string, required): the ticket that is blocked
- `blockedBy` (string[], required): ticket IDs to **add** as blockers

Reads the current `blockedBy`, unions the new IDs in and writes it back, so it is additive
and safe to repeat. The backend rejects an edge that would create a dependency cycle.

#### unlink_tickets
- `ticket` (string, required), `blockedBy` (string[], required): ticket IDs to **remove**

IDs that are not present are ignored; everything else on the list stays.

### get_board
- `projectId` (string, optional; alias `project`)
- `teamId` (string, optional; alias `team`)
- `milestoneId` (string, optional; alias `milestone`)
- `include` (string[], optional): same set as `list_tickets`

Returns `columns` — one entry per configured status (`key`, `label`, `color`, `isDone`,
`isBlocked`, `tickets`), in board order, plus an `UNKNOWN` column for any ticket whose status
matches no row. The legacy top-level `todo` / `in_progress` / `done` keys are still returned
for older callers, and `summary` carries `byStatus` counts alongside them.

### Subtasks

#### toggle_subtask
- `ticketId` (string, required) — this tool really does take `ticketId`, unlike the ticket
  CRUD tools, which take `id`
- `subtaskIndex` (number, required): 0-based

#### add_subtask
- `ticketId` (string, required), `title` (string, required)

## Development

```bash
# Watch mode for development
npm run dev

# Build for production
npm run build

# Start the server
npm start
```

## Troubleshooting

### "Connection refused" errors
Make sure Local PM is running at the configured URL (default: `http://localhost:3010`).

### Tools not appearing in Claude
1. Restart Claude Desktop/Claude Code after updating config
2. Check the config file path is correct for your OS
3. Verify the path to `dist/index.js` is absolute and correct

### Permission errors on Windows
Use forward slashes in paths even on Windows, or escape backslashes.

## License

MIT
