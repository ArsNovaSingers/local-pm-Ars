// Per-request context: WHO this MCP call is acting for.
//
// The HTTP entry point resolves a person (from their OAuth token, or from the legacy shared key)
// and runs the whole MCP request inside actorContext.run(). apiRequest() in server.ts reads it and
// forwards it to Local PM as X-Local-PM-Acting-User, where the IAP auth strategy turns it into
// req.user — so every write is stamped with the real person, and their role governs deletes.
//
// AsyncLocalStorage rather than threading a parameter through ~60 handlers in server.ts: the
// stdio entry point (index.ts) never sets it, and then no header is sent at all — unchanged
// behaviour for local use.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface Actor {
  /** Lower-cased email of the Team Member this request acts for. */
  email: string;
  /** How they authenticated — logged, never trusted for anything. */
  via: 'oauth' | 'legacy-key';
}

export const actorContext = new AsyncLocalStorage<Actor>();

export const ACTING_USER_HEADER = 'X-Local-PM-Acting-User';

export function currentActorHeaders(): Record<string, string> {
  const actor = actorContext.getStore();
  return actor ? { [ACTING_USER_HEADER]: actor.email } : {};
}

/**
 * MCP tool annotations. Clients use destructiveHint to ask the human before calling a tool;
 * without it Claude treats delete_project (which by default also deletes every ticket in the
 * project) exactly like list_projects.
 */
export function annotateTool(tool: Tool): Tool {
  if (tool.name.startsWith('delete_')) {
    return { ...tool, annotations: { ...tool.annotations, destructiveHint: true, readOnlyHint: false } };
  }
  if (/^(list_|get_)/.test(tool.name)) {
    return { ...tool, annotations: { ...tool.annotations, readOnlyHint: true } };
  }
  return tool;
}
