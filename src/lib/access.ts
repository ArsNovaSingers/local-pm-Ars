import type { Access } from 'payload'

/**
 * Local PM ships with open access so that a fresh `docker compose up` works with no
 * setup, and so that the MCP server (which authenticates at the network edge rather
 * than as a Payload user) keeps working.
 *
 * Set LOCAL_PM_REQUIRE_AUTH=true to require a logged-in Team Member for every
 * operation. Do that only once every caller — including any MCP server — holds an
 * API key, or you will lock out your own automation.
 */
export const requireAuthEnabled = (): boolean =>
  process.env.LOCAL_PM_REQUIRE_AUTH === 'true'

export const readAccess: Access = ({ req }) =>
  requireAuthEnabled() ? Boolean(req.user) : true

export const writeAccess: Access = ({ req }) =>
  requireAuthEnabled() ? Boolean(req.user) : true

/** Destructive operations can be held to a higher bar than ordinary writes. */
export const deleteAccess: Access = ({ req }) => {
  if (!requireAuthEnabled()) return true
  const role = (req.user as { role?: string } | undefined)?.role
  return role === 'admin'
}

export const collectionAccess = {
  read: readAccess,
  create: writeAccess,
  update: writeAccess,
  delete: deleteAccess,
}
