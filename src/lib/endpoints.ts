import type { Endpoint, PayloadRequest } from 'payload'
import { getScopeData } from './scope'

/**
 * Served by Payload's own router at `/api/views/scope`, rather than as a Next.js route
 * handler, because `/api/*` already belongs to Payload's catch-all — adding a parallel
 * Next route under the same prefix is how you get a build-time route conflict.
 */
export const viewsScopeEndpoint: Endpoint = {
  path: '/views/scope',
  method: 'get',
  handler: async (req: PayloadRequest) => {
    const params = req.searchParams ?? new URL(req.url ?? 'http://localhost/', 'http://localhost').searchParams

    const data = await getScopeData(req.payload, {
      projectId: params.get('project'),
      teamId: params.get('team'),
      milestoneId: params.get('milestone'),
    })

    return Response.json(data)
  },
}

/**
 * `/api/views/whoami` — the Team Member this request is authenticated as, or `{ user: null }`.
 * The MCP server uses it at sign-in and on every token check to ask "is this email an active
 * Team Member?" without needing read access to the whole people list.
 */
export const viewsWhoamiEndpoint: Endpoint = {
  path: '/views/whoami',
  method: 'get',
  handler: async (req: PayloadRequest) => {
    const u = req.user as { id?: string; email?: string; name?: string; role?: string; active?: boolean } | null
    if (!u) return Response.json({ user: null })
    return Response.json({
      user: { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active !== false },
    })
  },
}
