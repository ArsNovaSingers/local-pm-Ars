# Provenance and licence notice

## What this is

This repository is a fork of **[anaskasmi/local-pm](https://github.com/anaskasmi/local-pm)** by
Anas Kasmi, extended by Ars Nova Singers.

## Why this file exists

⚠️ **The upstream repository ships no `LICENSE` file.** Its `package.json` declares
`"license": "MIT"`, and GitHub therefore reports the licence as `null` for both the upstream
repository and this fork — a declaration in a manifest is not the licence text, and no copyright
holder is named anywhere in the original source.

The `LICENSE` file in this repository was added by us on 2026-09-07. It reproduces the MIT terms
the upstream project declares, and attributes the original work to its author alongside our own
modifications.

**Before this software, or anything built on it, is distributed to a third party, that should be
confirmed directly with the upstream author.** MIT is permissive and generally allows commercial
redistribution, but it is conditioned on retaining a copyright and licence notice — and the notice
we are retaining is one we reconstructed rather than one the upstream provided. This is a note from
engineers, not legal advice; treat it as a flag to resolve rather than a conclusion.

Upstream status as read on 2026-09-07: last pushed 2026-01-27. No fixes have come from upstream
since this fork was taken, and none are expected — this fork is maintained independently.

## What we changed

Substantive divergence from upstream, newest first:

- **Phase 0 foundations (2026-09-07)** — auth-enabled Team Members replacing the group-shaped
  "Teams"; workflow statuses moved out of a TypeScript enum into a configurable collection;
  generic Milestones; per-workspace custom-field definitions; `startDate`; actor tracking on
  writes; an atomic fix for the ticket-ID race; a cycle guard on task dependencies; a scope-wide
  fetch endpoint; and new MCP tools including additive dependency linking.
- **MCP server over HTTP** — the upstream server was stdio-only. Added a streamable-HTTP transport,
  bearer-token auth and a container image so it can run as a hosted service.
- **Service-to-service authentication** — the MCP server can mint a Google ID token to reach a
  backend sitting behind an identity-aware proxy.
- **Build fixes** — the root `tsconfig.json` swept `mcp-server/` into the Next.js type-check pass,
  which fails inside Docker where that package's dependencies are excluded from the build context.
