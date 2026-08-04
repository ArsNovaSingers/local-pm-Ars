# Local PM MCP Server

A Model Context Protocol (MCP) server for Local PM - a lightweight project management system with Kanban boards.

## Features

This MCP server provides AI models with full access to Local PM functionality:

### Projects
- `list_projects` - List all projects with pagination
- `get_project` - Get project details by ID
- `create_project` - Create a new project
- `update_project` - Update an existing project
- `delete_project` - Delete a project

### Teams
- `list_teams` - List all teams with pagination
- `get_team` - Get team details by ID
- `create_team` - Create a new team
- `update_team` - Update an existing team
- `delete_team` - Delete a team

### Tickets
- `list_tickets` - List tickets with filtering by project, team, or status
- `get_ticket` - Get ticket details by ID (includes subtasks)
- `create_ticket` - Create a new ticket with optional subtasks
- `update_ticket` - Update ticket fields
- `move_ticket` - Move ticket between statuses (todo, in_progress, done)
- `delete_ticket` - Delete a ticket

### Board View
- `get_board` - Get Kanban board view for a project (tickets grouped by status)

### Subtasks
- `toggle_subtask` - Toggle a subtask's completion status
- `add_subtask` - Add a new subtask to a ticket

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

### list_projects
Lists all projects with optional pagination.

**Parameters:**
- `limit` (number, optional): Max results to return (default: 50)
- `page` (number, optional): Page number (default: 1)

### get_project
Gets a project by ID.

**Parameters:**
- `id` (string, required): Project ID

### create_project
Creates a new project.

**Parameters:**
- `name` (string, required): Project name
- `description` (string, optional): Project description
- `prefix` (string, optional): Ticket ID prefix (auto-generated if not provided)
- `color` (string, optional): Hex color code

### update_project
Updates an existing project.

**Parameters:**
- `id` (string, required): Project ID
- `name` (string, optional): New name
- `description` (string, optional): New description
- `color` (string, optional): New color

### delete_project
Deletes a project.

**Parameters:**
- `id` (string, required): Project ID

### list_teams
Lists all teams with optional pagination.

**Parameters:**
- `limit` (number, optional): Max results (default: 50)
- `page` (number, optional): Page number (default: 1)

### get_team
Gets a team by ID.

**Parameters:**
- `id` (string, required): Team ID

### create_team
Creates a new team.

**Parameters:**
- `name` (string, required): Team name
- `type` (string, optional): Team type (development, design, qa, devops, management, support, other)
- `description` (string, optional): Team description
- `color` (string, optional): Hex color code

### update_team
Updates an existing team.

**Parameters:**
- `id` (string, required): Team ID
- `name` (string, optional): New name
- `type` (string, optional): New type
- `description` (string, optional): New description
- `color` (string, optional): New color

### delete_team
Deletes a team.

**Parameters:**
- `id` (string, required): Team ID

### list_tickets
Lists tickets with optional filtering.

**Parameters:**
- `project` (string, optional): Filter by project ID
- `team` (string, optional): Filter by team ID
- `status` (string, optional): Filter by status (todo, in_progress, done)
- `limit` (number, optional): Max results (default: 50)
- `page` (number, optional): Page number (default: 1)

### get_ticket
Gets a ticket by ID with full details including subtasks.

**Parameters:**
- `id` (string, required): Ticket ID

### create_ticket
Creates a new ticket.

**Parameters:**
- `title` (string, required): Ticket title
- `project` (string, required): Project ID
- `description` (string, optional): Ticket description (supports markdown)
- `status` (string, optional): Initial status (todo, in_progress, done) - defaults to todo
- `team` (string, optional): Assigned team ID
- `subtasks` (array, optional): Array of subtask objects with `title` and optional `completed` fields

### update_ticket
Updates an existing ticket.

**Parameters:**
- `id` (string, required): Ticket ID
- `title` (string, optional): New title
- `description` (string, optional): New description
- `team` (string, optional): New team ID

### move_ticket
Moves a ticket to a different status.

**Parameters:**
- `id` (string, required): Ticket ID
- `status` (string, required): New status (todo, in_progress, done)

### delete_ticket
Deletes a ticket.

**Parameters:**
- `id` (string, required): Ticket ID

### get_board
Gets the Kanban board view for a project with tickets grouped by status.

**Parameters:**
- `project` (string, required): Project ID

### toggle_subtask
Toggles a subtask's completion status.

**Parameters:**
- `ticketId` (string, required): Parent ticket ID
- `subtaskIndex` (number, required): Index of subtask in array (0-based)

### add_subtask
Adds a new subtask to a ticket.

**Parameters:**
- `ticketId` (string, required): Parent ticket ID
- `title` (string, required): Subtask title

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
