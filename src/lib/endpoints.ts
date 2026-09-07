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
