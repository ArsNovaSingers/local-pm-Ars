#!/usr/bin/env node
// HTTP entry point — a persistent, cloud-hostable remote MCP connector (Streamable HTTP).
// Mirrors the arsnova-google per-user Cloud Run MCP pattern used elsewhere in the Ars Nova infra:
// deployed with --allow-unauthenticated, gated instead by a shared-secret token checked here
// (see claude/infra/Ars_Nova_Google_MCP_PerUser_Deploy.md in the Ars Nova Claude project).
//
// Authentication (2026-09): per-person OAuth via Google sign-in (oauth.ts) is the primary path.
// The old shared ?key= token still works while people migrate, and acts as LEGACY_KEY_ACTS_AS
// (one named person), never anonymously. Unset MCP_AUTH_TOKEN to retire it.
//
// Stateless by design: Local PM's real state lives in Payload/MongoDB behind LOCAL_PM_URL, not in
// the MCP session, so every request gets its own fresh Server + Transport pair
// (sessionIdGenerator: undefined) instead of tracking sessions across requests.

import express, { Request, Response, NextFunction } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import crypto from 'node:crypto';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createServer } from './server.js';
import { actorContext, Actor } from './context.js';
import { GoogleOAuthProvider, googleCallbackRouter, loadOAuthConfig } from './oauth.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
const LEGACY_KEY_ACTS_AS = process.env.LEGACY_KEY_ACTS_AS?.toLowerCase();
const oauthConfig = loadOAuthConfig();
const oauthProvider = oauthConfig ? new GoogleOAuthProvider(oauthConfig) : undefined;

if (!oauthProvider && !AUTH_TOKEN) {
  // Previously this only warned and then accepted every request. Refuse instead: an open
  // server with full read/write/delete is never what anyone meant.
  console.error('FATAL: neither OAuth (PUBLIC_URL, GOOGLE_OAUTH_CLIENT_ID/SECRET, OAUTH_SECRET, ' +
    'OAUTH_ALLOWED_DOMAIN) nor MCP_AUTH_TOKEN is configured. Refusing to start an open server.');
  process.exit(1);
}
if (AUTH_TOKEN && !LEGACY_KEY_ACTS_AS) {
  console.error('WARNING: MCP_AUTH_TOKEN is set without LEGACY_KEY_ACTS_AS — shared-key calls will be ' +
    'anonymous, which fails once Local PM requires auth.');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** The retiring shared key, from ?key= or a Bearer header. */
function legacyKeyMatches(req: Request): boolean {
  if (!AUTH_TOKEN) return false;
  const headerToken = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const queryToken = typeof req.query.key === 'string' ? req.query.key : undefined;
  return [headerToken, queryToken].some((t) => t !== undefined && timingSafeEqualStr(t, AUTH_TOKEN));
}

const app = express();
app.use(express.json());

if (oauthProvider && oauthConfig) {
  app.set('trust proxy', 1); // Cloud Run fronts us; the SDK's rate limiter keys on client IP
  app.use(mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: new URL(oauthConfig.publicUrl),
    resourceServerUrl: new URL(oauthProvider.resourceUrl),
    resourceName: 'Local PM',
    scopesSupported: ['localpm'],
    clientRegistrationOptions: { clientIdGeneration: false }, // oauth.ts seals the registration into the id
  }));
  app.use(googleCallbackRouter(oauthProvider));
} else {
  // Legacy-only mode: Claude probes these before falling back to ?key=. 401 (not 404) matches
  // the arsnova-google connectors — see Ars_Nova_Google_MCP_PerUser_Deploy.md.
  app.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource'], (_req: Request, res: Response) => {
    res.status(401).json({ error: 'not_supported' });
  });
}

app.get('/', (_req: Request, res: Response) => {
  res.status(200).send('Local PM MCP server is running. POST MCP requests to /mcp.');
});

const bearer = oauthProvider
  ? requireBearerAuth({
      verifier: oauthProvider,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(oauthProvider.resourceUrl)),
    })
  : undefined;

function unauthorized(res: Response) {
  res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
}

/** Resolves WHO is calling and stores it on res.locals.actor. */
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (legacyKeyMatches(req)) {
    res.locals.actor = LEGACY_KEY_ACTS_AS ? ({ email: LEGACY_KEY_ACTS_AS, via: 'legacy-key' } satisfies Actor) : undefined;
    next();
    return;
  }
  if (!bearer) {
    unauthorized(res);
    return;
  }
  // A ?key= that doesn't match must not reach the bearer check with a stale Authorization header.
  bearer(req, res, (err?: unknown) => {
    if (err) return next(err);
    const email = req.auth?.extra?.email;
    if (typeof email !== 'string') return unauthorized(res);
    res.locals.actor = { email, via: 'oauth' } satisfies Actor;
    next();
  });
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
    const actor = res.locals.actor as Actor | undefined;
    const handle = () => transport.handleRequest(req, res, req.body);
    await (actor ? actorContext.run(actor, handle) : handle());
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
  console.error(`Auth: OAuth ${oauthProvider ? 'ON' : 'off'} · legacy key ${AUTH_TOKEN ? `ON (acts as ${LEGACY_KEY_ACTS_AS ?? 'nobody'})` : 'off'}`);
  console.error(`Proxying to Local PM at ${process.env.LOCAL_PM_URL || 'http://localhost:3010'}`);
});
