import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../payload.config'
import { DEFAULT_STATUSES, TeamMemberRole } from '../types/enums'

/**
 * Phase 0 migration — run this ONCE against each existing deployment, at the same
 * time as the release that introduces auth-enabled Team Members.
 *
 * It does two things, both idempotent:
 *
 *   1. Seeds the `statuses` collection. Until it runs, the board has no columns to
 *      build from and falls back to the built-in defaults.
 *   2. Backfills `email` (and role/active) on existing Team Member records. This is
 *      the important one: the `teams` collection is now auth-enabled, and Payload
 *      requires a unique email on every document in an auth collection. Records
 *      created before this release have none.
 *
 * ⚠️ A DEPLOYMENT THAT ENABLES AUTH WITHOUT RUNNING THIS WILL HAVE TEAM MEMBER
 * RECORDS THAT CANNOT BE UPDATED OR LOGGED IN TO. Run it immediately after deploy —
 * or, better, against a copy of the database first.
 *
 * Usage:
 *   MEMBER_EMAIL_DOMAIN=example.org npm run migrate:phase0
 *   MEMBER_EMAIL_DOMAIN=example.org npm run migrate:phase0 -- --dry-run
 *
 * Explicit addresses win over the derived ones:
 *   MEMBER_EMAILS='{"Jon":"jon@example.org","Tom":"tom@example.org"}'
 */

const DRY_RUN = process.argv.includes('--dry-run')

function log(...args: unknown[]) {
  console.log(DRY_RUN ? '[dry-run]' : '[migrate]', ...args)
}

function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '') || 'member'
  )
}

async function seedStatuses(payload: Awaited<ReturnType<typeof getPayload>>) {
  const existing = await payload.find({ collection: 'statuses', limit: 200, depth: 0 })
  const byKey = new Map(existing.docs.map((d) => [String(d.key), d]))

  let created = 0
  for (const seed of DEFAULT_STATUSES) {
    if (byKey.has(seed.key)) {
      log(`status ${seed.key} already exists — left alone`)
      continue
    }
    log(`creating status ${seed.key} (${seed.label})`)
    if (!DRY_RUN) {
      await payload.create({
        collection: 'statuses',
        data: {
          key: seed.key,
          label: seed.label,
          color: seed.color,
          order: seed.order,
          isDefault: Boolean(seed.isDefault),
          isDone: Boolean(seed.isDone),
          isBlocked: Boolean(seed.isBlocked),
        },
      })
    }
    created += 1
  }
  log(`statuses: ${created} created, ${existing.totalDocs} already present`)

  // Every status key already in use by a ticket must exist, or those tickets become
  // unreachable from the board. Report rather than invent.
  const tickets = await payload.find({ collection: 'tickets', limit: 1000, depth: 0 })
  const known = new Set([...byKey.keys(), ...DEFAULT_STATUSES.map((s) => s.key)])
  const orphans = new Set(
    tickets.docs.map((t) => String((t as { status?: unknown }).status)).filter((s) => s && !known.has(s)),
  )
  if (orphans.size) {
    log(`⚠️  tickets use status keys with no Statuses row: ${[...orphans].join(', ')}`)
    log('    add a Status row for each, or those tickets will not appear in any board column.')
  } else {
    log('every status key in use has a Statuses row')
  }
}

async function backfillTeamMembers(payload: Awaited<ReturnType<typeof getPayload>>) {
  const domain = process.env.MEMBER_EMAIL_DOMAIN
  let explicit: Record<string, string> = {}
  if (process.env.MEMBER_EMAILS) {
    try {
      explicit = JSON.parse(process.env.MEMBER_EMAILS)
    } catch {
      throw new Error('MEMBER_EMAILS is not valid JSON')
    }
  }

  const members = await payload.find({ collection: 'teams', limit: 500, depth: 0 })
  const needing = members.docs.filter((m) => !(m as { email?: string }).email)

  if (!needing.length) {
    log(`team members: all ${members.totalDocs} already have an email — nothing to do`)
    return
  }

  if (!domain && !Object.keys(explicit).length) {
    throw new Error(
      `${needing.length} Team Member record(s) have no email and the collection is now auth-enabled.\n` +
        'Set MEMBER_EMAIL_DOMAIN (and optionally MEMBER_EMAILS) and run again.\n' +
        'Records without an email cannot be updated or logged in to.',
    )
  }

  const used = new Set(
    members.docs.map((m) => String((m as { email?: string }).email || '').toLowerCase()).filter(Boolean),
  )

  for (const member of needing) {
    const name = String((member as { name?: string }).name || 'member')
    let email = explicit[name]
    if (!email) {
      const base = slugifyName(name)
      email = `${base}@${domain}`
      let n = 2
      while (used.has(email.toLowerCase())) {
        email = `${base}${n}@${domain}`
        n += 1
      }
    }
    used.add(email.toLowerCase())

    log(`team member "${name}" -> ${email}`)
    if (!DRY_RUN) {
      await payload.update({
        collection: 'teams',
        id: member.id,
        data: {
          email,
          role: (member as { role?: TeamMemberRole }).role || TeamMemberRole.MEMBER,
          active: (member as { active?: boolean }).active ?? true,
        },
      })
    }
  }

  log(`team members: ${needing.length} backfilled`)
  log('NOTE: no passwords were set. Use Payload\'s forgot-password flow, or set one per member in the admin panel.')
}

async function run() {
  const payload = await getPayload({ config })
  log(DRY_RUN ? 'DRY RUN — nothing will be written' : 'applying changes')

  await seedStatuses(payload)
  await backfillTeamMembers(payload)

  log('done')
  process.exit(0)
}

run().catch((err) => {
  console.error('[migrate] FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
