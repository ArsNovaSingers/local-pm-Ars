import type { AuthStrategy, AuthStrategyFunctionArgs } from 'payload'
import { OAuth2Client } from 'google-auth-library'

/**
 * Authenticate Team Members from Google Identity-Aware Proxy.
 *
 * When Local PM runs behind IAP, Google has already signed every request in before it reaches
 * us, and says who in a signed JWT (`x-goog-iap-jwt-assertion`). Verifying that JWT is enough to
 * know the caller — no passwords, no API keys to hand out.
 *
 * Two kinds of caller:
 *
 *   1. A person in a browser. The IAP email IS the person → the Team Member with that email.
 *   2. A trusted agent (the MCP server's service account, listed in LOCAL_PM_TRUSTED_AGENTS).
 *      It has signed the person in itself (Google OAuth, see mcp-server/src/oauth.ts) and names
 *      them in X-Local-PM-Acting-User. That header is honoured ONLY when the verified IAP
 *      identity is a trusted agent — anyone else sending it is ignored.
 *
 * Inactive or unknown people get no user; with LOCAL_PM_REQUIRE_AUTH=true that means no access.
 *
 * Config (all unset = strategy is a no-op, e.g. local `npm run dev`):
 *   LOCAL_PM_IAP_AUDIENCE     /projects/<number>/locations/<region>/services/<service>
 *   LOCAL_PM_TRUSTED_AGENTS   comma-separated service-account emails
 *
 * Never trust `x-goog-authenticated-user-email` on its own: it is unsigned, and only IAP's
 * absence of a bypass keeps it honest. The JWT is what makes this safe.
 */

const IAP_ISSUER = 'https://cloud.google.com/iap'
export const ACTING_USER_HEADER = 'x-local-pm-acting-user'

const verifier = new OAuth2Client()

function trustedAgents(): Set<string> {
  return new Set(
    (process.env.LOCAL_PM_TRUSTED_AGENTS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** Returns the verified IAP email, or null if absent/invalid/not configured. */
export async function verifiedIapEmail(headers: Headers): Promise<string | null> {
  const audience = process.env.LOCAL_PM_IAP_AUDIENCE
  const jwt = headers.get('x-goog-iap-jwt-assertion')
  if (!audience || !jwt) return null
  try {
    const { pubkeys } = await verifier.getIapPublicKeysAsync() // cached by the library
    const ticket = await verifier.verifySignedJwtWithCertsAsync(jwt, pubkeys, audience, [IAP_ISSUER])
    const email = ticket.getPayload()?.email
    return email ? email.toLowerCase() : null
  } catch (err) {
    // Log the (non-secret) audience the token was minted for: the expected format differs by
    // IAP backend type and a mismatch is the most likely misconfiguration.
    let aud = '?'
    try {
      aud = String(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).aud)
    } catch {}
    console.error(`IAP assertion rejected (token aud=${aud}, expected ${audience}):`, err instanceof Error ? err.message : err)
    return null
  }
}

export const iapStrategy: AuthStrategy = {
  name: 'iap',
  authenticate: async ({ headers, payload }: AuthStrategyFunctionArgs) => {
    // Local development only: act as the person named in the header without IAP. Hard-disabled
    // when NODE_ENV=production (every deployed image), whatever the env var says.
    const devActing =
      process.env.NODE_ENV !== 'production' && process.env.LOCAL_PM_DEV_TRUST_ACTING_HEADER === 'true'
        ? headers.get(ACTING_USER_HEADER)?.trim().toLowerCase()
        : undefined

    const iapEmail = devActing ? `dev:${devActing}` : await verifiedIapEmail(headers)
    if (!iapEmail) return { user: null }

    let email = devActing ?? iapEmail
    if (!devActing && trustedAgents().has(iapEmail)) {
      const acting = headers.get(ACTING_USER_HEADER)?.trim().toLowerCase()
      if (!acting) return { user: null } // an agent acting as nobody is nobody
      email = acting
    }

    const found = await payload.find({
      collection: 'teams',
      where: { email: { equals: email } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const member = found.docs[0]
    if (!member || member.active === false) return { user: null }

    return { user: { ...member, collection: 'teams', _strategy: 'iap' } as never }
  },
}
