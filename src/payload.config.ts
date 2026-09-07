import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { FieldDefinitions } from './collections/FieldDefinitions'
import { Milestones } from './collections/Milestones'
import { Projects } from './collections/Projects'
import { Statuses } from './collections/Statuses'
import { TeamMembers } from './collections/TeamMembers'
import { Tickets } from './collections/Tickets'
import { viewsScopeEndpoint } from './lib/endpoints'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    // Team Members is the auth collection: it is what lets Local PM run anywhere
    // rather than only behind a network-level gate, and what gives writes an actor.
    user: TeamMembers.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Projects, TeamMembers, Tickets, Statuses, Milestones, FieldDefinitions],
  endpoints: [viewsScopeEndpoint],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DATABASE_URI || '',
  }),
})
