# syntax=docker/dockerfile:1
#
# Local PM MCP server — HTTP (Streamable HTTP) mode for Cloud Run.
# Not used for the stdio/Claude-Desktop mode — that runs `node dist/index.js` directly on a
# developer's machine, no container involved.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
# Using `npm install` (not `npm ci`) — no package-lock.json is committed for this package yet,
# since the express/SDK bump means the lockfile would need updating too. Fine for this evaluation
# build; switch to `npm ci` with a committed lockfile once this is more than a sandbox.
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS="--no-deprecation"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 mcp

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

USER mcp

# Cloud Run injects PORT at runtime (defaults to 8080); http.ts reads it directly.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/http.js"]
