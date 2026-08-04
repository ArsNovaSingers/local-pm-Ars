#!/usr/bin/env node
// HTTP entry point — a persistent, cloud-hostable remote MCP connector (Streamable HTTP).
// Mirrors the arsnova-google per-user Cloud Run MCP pattern used elsewhere in the Ars Nova infra:
// deployed with --allow-unauthenticated, gated instead by a shared-secret token checked here
// (see claude/infra/Ars_Nova_Google_MCP_PerUser_Deploy.md in the Ars Nova Claude project).
//
// Stateless by design: Local PM's real state lives in Payload/MongoDB behind LOCAL_PM_URL, not in
// the MCP session, so every request gets its own fresh Server + Transport pair
// (sessionIdGenerator: undefined) instead of tracking sessions across requests.

import express, { Request, Response, NextFunction } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

if (!AUTH_TOKEN) {
  // Not fatal — useful for local `npm run start:http` testing — but never deploy without one.
  console.error(
    'WARNING: MCP_AUTH_TOKEN is not set. This server will accept UNAUTHENTICATED requests. ' +
    'Set MCP_AUTH_TOKEN before deploying anywhere reachable from the internet.'
  );
}

function checkAuth(req: Request): boolean {
  if (!AUTH_TOKEN) return true;
  const headerToken = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const queryToken = typeof req.query.key === 'string' ? req.query.key : undefined;
  return headerToken === AUTH_TOKEN || queryToken === AUTH_TOKEN;
}

const app = express();
app.use(express.json());

// Claude probes these before falling back to the ?key= param on the connector URL. Gating them
// with 401 (rather than a bare 404) matches the working arsnova-google connectors already in use
// — Claude retries once past the "couldn't register with sign-in service" error and connects fine
// via ?key=. See the "Add it in Claude" gotcha in Ars_Nova_Google_MCP_PerUser_Deploy.md.
app.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource'], (_req: Request, res: Response) => {
  res.status(401).json({ error: 'not_supported' });
});

app.get('/', (_req: Request, res: Response) => {
  res.status(200).send('Local PM MCP server is running. POST MCP requests to /mcp.');
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!checkAuth(req)) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: null,
    });
    return;
  }
  next();
}

app.post('/mcp', requireAuth, async (req: Request, res: Response) => {
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — see file header
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// Stateless mode doesn't support server-initiated SSE streams (GET) or explicit session
// termination (DELETE) — respond the way the SDK's own stateless examples do.
app.get('/mcp', requireAuth, (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
});
app.delete('/mcp', requireAuth, (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
});

app.listen(PORT, () => {
  console.error(`Local PM MCP HTTP server listening on port ${PORT}`);
  console.error(`Proxying to Local PM at ${process.env.LOCAL_PM_URL || 'http://localhost:3010'}`);
});
