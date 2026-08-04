#!/usr/bin/env node
// Stdio entry point — for Claude Desktop / Claude Code local config (unchanged behavior).
// For a cloud-hosted remote MCP connector (Cloud Run, works from desktop/phone/scheduled
// sessions), see http.ts instead.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Local PM MCP Server running on stdio');
}

main().catch(console.error);
