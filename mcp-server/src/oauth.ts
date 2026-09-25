// OAuth 2.1 for the remote connector: each person signs in with their own Google account.
//
// Flow (all standard MCP authorization; the SDK's mcpAuthRouter serves the endpoints):
//
//   Claude ──/register (DCR)──▶ here            client_id = sealed blob, nothing stored
//   Claude ──/authorize──────▶ here ──302──▶ Google sign-in (hd = our Workspace domain)
//   Google ──/oauth/google/callback──▶ here     verify ID token, email → active Team Member
//          ──302──▶ Claude redirect_uri?code=…  code = sealed blob (PKCE challenge inside)
//   Claude ──/token──────────▶ here             access token (1h) + refresh token (30d)
//   Claude ──/mcp  Bearer …──▶ here             token → email → X-Local-PM-Acting-User
//
// STATELESS ON PURPOSE. Cloud Run scales to N instances and to zero; there is no shared memory
// and this service has no database. Every artefact (client registration, pending authorization,
// auth code, refresh token) is an A256GCM-encrypted JWE under OAUTH_SECRET, so it is opaque to
// the holder and can be verified by any instance. Access tokens are HS256 JWTs under a key
// derived from the same secret.
//
// Revocation, in order of reach:
//   - Mark the Team Member inactive (or remove them) in Local PM: every token and refresh stops
//     working within MEMBER_CACHE_MS, because each check re-asks Local PM who this person is.
//   - Rotate OAUTH_SECRET: every token for everyone is dead; people click Connect again.
//
// Known limit of statelessness: an auth code is replayable until it expires (5 minutes). PKCE
// makes a stolen code useless without the verifier, which never leaves the client.

import crypto from 'node:crypto';
import express, { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { EncryptJWT, jwtDecrypt, SignJWT, jwtVerify } from 'jose';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { actorContext } from './context.js';
import { apiRequest } from './server.js';

export interface OAuthConfig {
  /** Public base URL of this service, e.g. https://local-pm-mcp-xxxx.a.run.app (no trailing slash). */
  publicUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  /** Workspace domain people must sign in with, e.g. arsnovasingers.org. */
  allowedDomain: string;
  /** ≥32 random bytes, base64. Encrypts and signs everything this module issues. */
  secret: string;
}

const ACCESS_TTL_S = 60 * 60;            // 1 hour
const REFRESH_TTL_S = 30 * 24 * 60 * 60; // 30 days
const CODE_TTL_S = 5 * 60;
const PENDING_TTL_S = 10 * 60;           // time allowed on Google's sign-in page
const MEMBER_CACHE_MS = 60 * 1000;
const SCOPE = 'localpm';

export const GOOGLE_CALLBACK_PATH = '/oauth/google/callback';

type Sealed = Record<string, unknown>;

export function loadOAuthConfig(): OAuthConfig | undefined {
  // Trimmed: values mounted from Secret Manager often carry the newline they were pasted with.
  const env = (k: string) => process.env[k]?.trim() || undefined;
  const PUBLIC_URL = env('PUBLIC_URL');
  const GOOGLE_OAUTH_CLIENT_ID = env('GOOGLE_OAUTH_CLIENT_ID');
  const GOOGLE_OAUTH_CLIENT_SECRET = env('GOOGLE_OAUTH_CLIENT_SECRET');
  const OAUTH_SECRET = env('OAUTH_SECRET');
  const OAUTH_ALLOWED_DOMAIN = env('OAUTH_ALLOWED_DOMAIN');
  if (!PUBLIC_URL || !GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !OAUTH_SECRET || !OAUTH_ALLOWED_DOMAIN) {
    return undefined;
  }
  return {
    publicUrl: PUBLIC_URL.replace(/\/+$/, ''),
    googleClientId: GOOGLE_OAUTH_CLIENT_ID,
    googleClientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
    allowedDomain: OAUTH_ALLOWED_DOMAIN.toLowerCase(),
    secret: OAUTH_SECRET,
  };
}

// ---------------------------------------------------------------------------------------------
// Member lookup — the single place that decides whether an email may use Local PM.
// ---------------------------------------------------------------------------------------------

interface Member { id: string; email: string; name?: string; role?: string; active?: boolean }

const memberCache = new Map<string, { member: Member | null; at: number }>();

/** Asks Local PM who this email is, acting as them. null = not an active Team Member. */
export async function lookupActiveMember(email: string): Promise<Member | null> {
  const key = email.toLowerCase();
  const hit = memberCache.get(key);
  if (hit && Date.now() - hit.at < MEMBER_CACHE_MS) return hit.member;

  let member: Member | null = null;
  try {
    const me = (await actorContext.run({ email: key, via: 'oauth' }, () =>
      apiRequest('/views/whoami')
    )) as { user?: Member | null };
    const u = me?.user;
    if (u && u.active !== false && String(u.email).toLowerCase() === key) member = u;
  } catch (err) {
    // A backend outage must not be cached as "not a member" for a minute.
    console.error('member lookup failed:', err instanceof Error ? err.message : err);
    throw err;
  }
  memberCache.set(key, { member, at: Date.now() });
  return member;
}

// ---------------------------------------------------------------------------------------------

export class GoogleOAuthProvider implements OAuthServerProvider {
  private readonly encKey: Uint8Array;
  private readonly sigKey: Uint8Array;
  private readonly google: OAuth2Client;

  constructor(private readonly cfg: OAuthConfig) {
    const root = Buffer.from(cfg.secret, 'base64');
    if (root.length < 32) throw new Error('OAUTH_SECRET must be at least 32 bytes, base64-encoded');
    this.encKey = new Uint8Array(crypto.hkdfSync('sha256', root, Buffer.alloc(0), 'local-pm-mcp/enc', 32));
    this.sigKey = new Uint8Array(crypto.hkdfSync('sha256', root, Buffer.alloc(0), 'local-pm-mcp/sig', 32));
    this.google = new OAuth2Client(cfg.googleClientId, cfg.googleClientSecret, this.callbackUrl);
  }

  get callbackUrl(): string {
    return `${this.cfg.publicUrl}${GOOGLE_CALLBACK_PATH}`;
  }

  get resourceUrl(): string {
    return `${this.cfg.publicUrl}/mcp`;
  }

  // ---- sealing ------------------------------------------------------------------------------

  private async seal(typ: string, payload: Sealed, ttlS: number): Promise<string> {
    return new EncryptJWT({ ...payload, typ })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuedAt()
      .setExpirationTime(`${ttlS}s`)
      .encrypt(this.encKey);
  }

  private async unseal(typ: string, token: string): Promise<Sealed> {
    try {
      const { payload } = await jwtDecrypt(token, this.encKey);
      if (payload.typ !== typ) throw new Error('wrong type');
      return payload as Sealed;
    } catch {
      throw new InvalidGrantError(`invalid or expired ${typ}`);
    }
  }

  /** Tokens carry a short fingerprint of the client, not its (long) sealed client_id. */
  private fingerprint(clientId: string): string {
    return crypto.createHash('sha256').update(clientId).digest('base64url').slice(0, 22);
  }

  // ---- dynamic client registration, stateless ----------------------------------------------

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      registerClient: async (client) => {
        // clientIdGeneration is off (see http.ts), so we mint the id: the registration itself,
        // sealed. getClient() unseals it. No expiry — Claude keeps a registration for months.
        const body = { ...client, client_id_issued_at: Math.floor(Date.now() / 1000) };
        const client_id = await new EncryptJWT({ typ: 'client', c: body })
          .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
          .encrypt(this.encKey);
        return { ...body, client_id } as OAuthClientInformationFull;
      },
      getClient: async (clientId) => {
        try {
          const { payload } = await jwtDecrypt(clientId, this.encKey);
          if (payload.typ !== 'client') return undefined;
          return { ...(payload.c as object), client_id: clientId } as OAuthClientInformationFull;
        } catch {
          return undefined;
        }
      },
    };
  }

  // ---- authorization ------------------------------------------------------------------------

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const pending = await this.seal('pending', {
      cid: client.client_id,
      redirectUri: params.redirectUri,
      state: params.state,
      codeChallenge: params.codeChallenge,
      scopes: params.scopes ?? [SCOPE],
      resource: params.resource?.href,
    }, PENDING_TTL_S);

    const url = this.google.generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      state: pending,
      hd: this.cfg.allowedDomain,      // a hint only; enforced again in the callback
      prompt: 'select_account',
    });
    res.redirect(302, url);
  }

  /** Express handler for Google's redirect back to us. */
  googleCallback = async (req: Request, res: Response): Promise<void> => {
    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (!state) { res.status(400).send('Missing state.'); return; }

    let pending: Sealed;
    try {
      pending = await this.unseal('pending', state);
    } catch {
      res.status(400).send('This sign-in link has expired. Go back to Claude and click Connect again.');
      return;
    }

    const back = (params: Record<string, string>) => {
      const u = new URL(String(pending.redirectUri));
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (pending.state) u.searchParams.set('state', String(pending.state));
      res.redirect(302, u.href);
    };

    if (!code) {
      back({ error: 'access_denied', error_description: String(req.query.error ?? 'Google sign-in was cancelled') });
      return;
    }

    let email: string;
    try {
      const { tokens } = await this.google.getToken(code);
      const ticket = await this.google.verifyIdToken({ idToken: tokens.id_token!, audience: this.cfg.googleClientId });
      const p = ticket.getPayload();
      if (!p?.email || !p.email_verified) throw new Error('Google did not return a verified email');
      if ((p.hd ?? '').toLowerCase() !== this.cfg.allowedDomain) {
        throw new Error(`Sign in with your @${this.cfg.allowedDomain} account`);
      }
      email = p.email.toLowerCase();
    } catch (err) {
      back({ error: 'access_denied', error_description: err instanceof Error ? err.message : 'Google sign-in failed' });
      return;
    }

    let member: Member | null;
    try {
      member = await lookupActiveMember(email);
    } catch {
      back({ error: 'temporarily_unavailable', error_description: 'Local PM did not answer. Try again in a minute.' });
      return;
    }
    if (!member) {
      back({ error: 'access_denied', error_description: `${email} is not an active Local PM Team Member` });
      return;
    }

    console.error(`oauth: ${email} signed in`);
    const authCode = await this.seal('code', {
      cid: this.fingerprint(String(pending.cid)),
      email,
      codeChallenge: pending.codeChallenge,
      redirectUri: pending.redirectUri,
      scopes: pending.scopes,
      resource: pending.resource,
    }, CODE_TTL_S);
    back({ code: authCode });
  };

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const c = await this.unseal('code', authorizationCode);
    if (c.cid !== this.fingerprint(client.client_id)) throw new InvalidGrantError('code was issued to another client');
    return String(c.codeChallenge);
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,   // PKCE is checked by the SDK's token handler before this runs
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const c = await this.unseal('code', authorizationCode);
    if (c.cid !== this.fingerprint(client.client_id)) throw new InvalidGrantError('code was issued to another client');
    if (redirectUri && redirectUri !== c.redirectUri) throw new InvalidGrantError('redirect_uri mismatch');
    return this.issueTokens(String(c.cid), String(c.email), (c.scopes as string[]) ?? [SCOPE]);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const r = await this.unseal('refresh', refreshToken);
    if (r.cid !== this.fingerprint(client.client_id)) throw new InvalidGrantError('refresh token was issued to another client');
    const member = await lookupActiveMember(String(r.email));
    if (!member) throw new InvalidGrantError('no longer an active Local PM Team Member');
    return this.issueTokens(String(r.cid), String(r.email), (r.scopes as string[]) ?? [SCOPE]);
  }

  private async issueTokens(cid: string, email: string, scopes: string[]): Promise<OAuthTokens> {
    const access_token = await new SignJWT({ typ: 'access', cid, scope: scopes.join(' ') })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(email)
      .setAudience(this.resourceUrl)
      .setIssuer(this.cfg.publicUrl)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_S}s`)
      .sign(this.sigKey);
    const refresh_token = await this.seal('refresh', { cid, email, scopes }, REFRESH_TTL_S);
    return { access_token, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token, scope: scopes.join(' ') };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.sigKey, { audience: this.resourceUrl, issuer: this.cfg.publicUrl }));
    } catch {
      throw new InvalidTokenError('invalid or expired access token');
    }
    if (payload.typ !== 'access' || !payload.sub) throw new InvalidTokenError('not an access token');
    const member = await lookupActiveMember(payload.sub);
    if (!member) throw new InvalidTokenError('no longer an active Local PM Team Member');
    return {
      token,
      clientId: String(payload.cid),
      scopes: String(payload.scope ?? SCOPE).split(' '),
      expiresAt: payload.exp,
      resource: new URL(this.resourceUrl),
      extra: { email: payload.sub },
    };
  }
}

export function googleCallbackRouter(provider: GoogleOAuthProvider): express.Router {
  const r = express.Router();
  r.get(GOOGLE_CALLBACK_PATH, provider.googleCallback);
  return r;
}
