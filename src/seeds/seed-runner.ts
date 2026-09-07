import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../payload.config'
import {
  DEFAULT_STATUSES,
  ProjectStatus,
  TeamMemberRole,
  TicketStatus,
  TicketPriority,
} from '../types/enums'

interface SeedProject {
  name: string
  prefix: string
  color: string
  icon: string
  status: ProjectStatus
}

/**
 * A PERSON, not a group. The Payload slug is still `teams` on purpose (see
 * collections/TeamMembers.ts) — only the meaning and the labels changed.
 *
 * `email` is required: the collection is auth-enabled, so Payload will not accept a
 * document without a unique address. `password` is likewise required at create time.
 */
interface SeedTeamMember {
  name: string
  email: string
  role: TeamMemberRole
  description: string | null
  color: string
  /** Omitted means active. Inactive people keep their history but drop out of pickers. */
  active?: boolean
}

interface SeedTicket {
  title: string
  /** A status `key`. These are the seeded defaults; a workspace may define others. */
  status: string
  priority: TicketPriority
  projectPrefix: string
  assigneeName: string | null
  labels: { name: string; color: string }[]
  blockedByTitles?: string[]
}

const SEED_PROJECTS: SeedProject[] = [
  {
    name: 'Website Redesign',
    prefix: 'WEB',
    color: '#6366f1',
    icon: 'rocket',
    status: ProjectStatus.ACTIVE,
  },
  {
    name: 'Mobile App v2',
    prefix: 'APP',
    color: '#8b5cf6',
    icon: 'zap',
    status: ProjectStatus.ACTIVE,
  },
  {
    name: 'Backend API',
    prefix: 'API',
    color: '#22c55e',
    icon: 'database',
    status: ProjectStatus.ACTIVE,
  },
  {
    name: 'Marketing Campaign 2024',
    prefix: 'MKT',
    color: '#eab308',
    icon: 'flag',
    status: ProjectStatus.ACTIVE,
  },
  {
    name: 'Cloud Infrastructure',
    prefix: 'OPS',
    color: '#06b6d4',
    icon: 'layers',
    status: ProjectStatus.ACTIVE,
  },
  {
    name: 'Customer Support Portal',
    prefix: 'CSP',
    color: '#ec4899',
    icon: 'briefcase',
    status: ProjectStatus.ACTIVE,
  },
]

/**
 * Fictional people, deliberately domain-neutral — this is sample data for anyone who
 * clones the tool, not a picture of any particular organization. Addresses use the
 * reserved `example.com` domain so nothing here can reach a real inbox.
 */
const SEED_TEAM_MEMBERS: SeedTeamMember[] = [
  {
    name: 'Dana Whitfield',
    email: 'dana.whitfield@example.com',
    role: TeamMemberRole.ADMIN,
    description: 'Runs the roadmap and keeps the board honest',
    color: '#8b5cf6',
  },
  {
    name: 'Alex Moreau',
    email: 'alex.moreau@example.com',
    role: TeamMemberRole.MEMBER,
    description: 'Web and mobile client work',
    color: '#3b82f6',
  },
  {
    name: 'Sam Okafor',
    email: 'sam.okafor@example.com',
    role: TeamMemberRole.MEMBER,
    description: 'APIs and data',
    color: '#10b981',
  },
  {
    name: 'Nina Kovacs',
    email: 'nina.kovacs@example.com',
    role: TeamMemberRole.MEMBER,
    description: 'Quality assurance and automated testing',
    color: '#f97316',
  },
  {
    name: 'Priya Raman',
    email: 'priya.raman@example.com',
    role: TeamMemberRole.MEMBER,
    description: 'Interface and brand design',
    color: '#ec4899',
  },
  {
    name: 'Luis Ferreira',
    email: 'luis.ferreira@example.com',
    role: TeamMemberRole.MEMBER,
    description: 'Growth and communications',
    color: '#f59e0b',
  },
  {
    name: 'Ravi Anand',
    email: 'ravi.anand@example.com',
    role: TeamMemberRole.MEMBER,
    description: 'Infrastructure and delivery pipelines',
    color: '#06b6d4',
  },
  {
    // An automated caller. Agents get their own identity and API key rather than sharing
    // one token, so every write the automation makes is attributable to it.
    name: 'Intake Agent',
    email: 'intake.agent@example.com',
    role: TeamMemberRole.AGENT,
    description: 'Automated caller that files incoming requests',
    color: '#14b8a6',
  },
  {
    // Kept to exercise the inactive path: history is preserved, assignment pickers hide them.
    name: 'Chris Lindqvist',
    email: 'chris.lindqvist@example.com',
    role: TeamMemberRole.MEMBER,
    description: 'Former team member — retained for history',
    color: '#64748b',
    active: false,
  },
]

const SEED_TICKETS: SeedTicket[] = [
  // Website Redesign (WEB)
  {
    title: 'Finalize new brand guidelines',
    status: TicketStatus.DONE,
    priority: TicketPriority.HIGH,
    projectPrefix: 'WEB',
    assigneeName: 'Priya Raman',
    labels: [{ name: 'design', color: '#ec4899' }],
  },
  {
    title: 'Design homepage wireframes',
    status: TicketStatus.DONE,
    priority: TicketPriority.HIGH,
    projectPrefix: 'WEB',
    assigneeName: 'Priya Raman',
    labels: [{ name: 'design', color: '#ec4899' }],
    blockedByTitles: ['Finalize new brand guidelines'],
  },
  {
    title: 'Implement responsive navigation',
    status: TicketStatus.IN_PROGRESS,
    priority: TicketPriority.MEDIUM,
    projectPrefix: 'WEB',
    assigneeName: 'Alex Moreau',
    labels: [{ name: 'frontend', color: '#3b82f6' }],
    blockedByTitles: ['Design homepage wireframes'],
  },
  {
    title: 'Hero section implementation',
    status: TicketStatus.TODO,
    priority: TicketPriority.MEDIUM,
    projectPrefix: 'WEB',
    assigneeName: 'Alex Moreau',
    labels: [{ name: 'frontend', color: '#3b82f6' }],
    blockedByTitles: ['Design homepage wireframes'],
  },

  // Mobile App v2 (APP)
  {
    title: 'Define API contract for Auth',
    status: TicketStatus.DONE,
    priority: TicketPriority.URGENT,
    projectPrefix: 'APP',
    assigneeName: 'Dana Whitfield',
    labels: [{ name: 'planning', color: '#64748b' }],
  },
  {
    title: 'Audit current React Native performance',
    status: TicketStatus.DONE,
    priority: TicketPriority.MEDIUM,
    projectPrefix: 'APP',
    assigneeName: 'Nina Kovacs',
    labels: [{ name: 'qa', color: '#f97316' }],
  },
  {
    title: 'Implement OAuth logic',
    status: TicketStatus.IN_PROGRESS,
    priority: TicketPriority.HIGH,
    projectPrefix: 'APP',
    assigneeName: 'Sam Okafor',
    labels: [{ name: 'auth', color: '#ef4444' }, { name: 'api', color: '#10b981' }],
    blockedByTitles: ['Define API contract for Auth'],
  },
  {
    title: 'Biometric authentication integration',
    status: TicketStatus.TODO,
    priority: TicketPriority.MEDIUM,
    projectPrefix: 'APP',
    assigneeName: 'Alex Moreau',
    labels: [{ name: 'mobile', color: '#8b5cf6' }],
    blockedByTitles: ['Implement OAuth logic'],
  },

  // Marketing (MKT)
  {
    title: 'Identify target audience for Q1',
    status: TicketStatus.DONE,
    priority: TicketPriority.HIGH,
    projectPrefix: 'MKT',
    assigneeName: 'Luis Ferreira',
    labels: [{ name: 'strategy', color: '#f59e0b' }],
  },
  {
    title: 'Create social media assets',
    status: TicketStatus.IN_PROGRESS,
    priority: TicketPriority.MEDIUM,
    projectPrefix: 'MKT',
    assigneeName: 'Priya Raman',
    labels: [{ name: 'design', color: '#ec4899' }],
    blockedByTitles: ['Identify target audience for Q1'],
  },
  {
    title: 'Setup ad campaigns on LinkedIn',
    status: TicketStatus.TODO,
    priority: TicketPriority.HIGH,
    projectPrefix: 'MKT',
    assigneeName: 'Luis Ferreira',
    labels: [{ name: 'ads', color: '#3b82f6' }],
    blockedByTitles: ['Create social media assets'],
  },

  // DevOps (OPS)
  {
    title: 'Migrate DB to new cluster',
    status: TicketStatus.IN_PROGRESS,
    priority: TicketPriority.URGENT,
    projectPrefix: 'OPS',
    assigneeName: 'Ravi Anand',
    labels: [{ name: 'infrastructure', color: '#06b6d4' }],
  },
  {
    title: 'Optimize Docker build times',
    status: TicketStatus.TODO,
    priority: TicketPriority.LOW,
    projectPrefix: 'OPS',
    assigneeName: 'Ravi Anand',
    labels: [{ name: 'ci/cd', color: '#8b5cf6' }],
  },
  {
    title: 'Implement auto-scaling for API',
    status: TicketStatus.TODO,
    priority: TicketPriority.MEDIUM,
    projectPrefix: 'OPS',
    assigneeName: 'Ravi Anand',
    labels: [{ name: 'reliability', color: '#10b981' }],
    blockedByTitles: ['Migrate DB to new cluster'],
  },
]

async function seed() {
  console.log('Starting seed...')

  const payload = await getPayload({ config })

  // Clear existing data
  console.log('Clearing existing data...')
  await payload.delete({ collection: 'tickets', where: {} })
  await payload.delete({ collection: 'projects', where: {} })
  // Slug is `teams`; the documents are Team Members (people). Deliberate — see
  // collections/TeamMembers.ts.
  await payload.delete({ collection: 'teams', where: {} })
  await payload.delete({ collection: 'statuses', where: {} })

  /**
   * Statuses are DATA, so the board has no columns until these rows exist. Seed them
   * first: every ticket below is created with one of these keys.
   */
  console.log('Creating statuses...')
  for (const status of DEFAULT_STATUSES) {
    await payload.create({
      collection: 'statuses',
      data: {
        key: status.key,
        label: status.label,
        color: status.color,
        order: status.order,
        isDefault: Boolean(status.isDefault),
        isDone: Boolean(status.isDone),
        isBlocked: Boolean(status.isBlocked),
      },
    })
  }

  /**
   * The `teams` collection is auth-enabled, so a unique email and a password are
   * required on every document. This is sample data — override the password with
   * SEED_PASSWORD before pointing this at anything you care about.
   */
  console.log('Creating team members...')
  const seedPassword = process.env.SEED_PASSWORD || 'local-pm-seed-password'
  const memberMap = new Map<string, string>()
  for (const member of SEED_TEAM_MEMBERS) {
    const created = await payload.create({
      collection: 'teams',
      data: {
        name: member.name,
        email: member.email,
        password: seedPassword,
        role: member.role,
        active: member.active ?? true,
        description: member.description,
        color: member.color,
      },
    })
    memberMap.set(member.name, created.id)
  }

  // Create projects
  console.log('Creating projects...')
  const projectMap = new Map<string, string>()
  for (const project of SEED_PROJECTS) {
    const created = await payload.create({
      collection: 'projects',
      data: project as any,
    })
    projectMap.set(project.prefix, created.id)
  }

  // Create tickets (first pass)
  console.log('Creating tickets (first pass)...')
  const ticketMap = new Map<string, string>()

  for (const ticket of SEED_TICKETS) {
    const projectId = projectMap.get(ticket.projectPrefix)
    const assigneeId = ticket.assigneeName ? memberMap.get(ticket.assigneeName) : null

    if (!projectId) {
      console.error(`Project not found: ${ticket.projectPrefix}`)
      continue
    }

    const created = await payload.create({
      collection: 'tickets',
      data: {
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        project: projectId,
        team: assigneeId,
        labels: ticket.labels,
      },
    })

    // Store in map so we can reference for blockedBy
    // Using title as key (assume unique titles in seed data for simplicity)
    ticketMap.set(ticket.title, created.id)
  }

  // Second pass: link dependencies
  console.log('Linking dependencies...')
  for (const ticket of SEED_TICKETS) {
    if (ticket.blockedByTitles && ticket.blockedByTitles.length > 0) {
      const ticketId = ticketMap.get(ticket.title)
      if (!ticketId) continue

      const blockedByIDs = ticket.blockedByTitles
        .map(title => ticketMap.get(title))
        .filter((id): id is string => !!id)

      if (blockedByIDs.length > 0) {
        await payload.update({
          collection: 'tickets',
          id: ticketId,
          data: {
            blockedBy: blockedByIDs,
          },
        })
      }
    }
  }

  console.log('Seed completed!')
  process.exit(0)
}

seed().catch((error) => {
  console.error('Seed failed:', JSON.stringify(error, null, 2))
  if (error.data && error.data.errors) {
    console.error('Validation errors:', JSON.stringify(error.data.errors, null, 2))
  }
  process.exit(1)
})
