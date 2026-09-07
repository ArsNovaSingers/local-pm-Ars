'use client'

import { useState, useEffect } from 'react'
import { X, Minimize2, Users } from 'lucide-react'
import { PROJECT_COLORS, TEAM_MEMBER_ROLE_OPTIONS, TeamMemberRole } from '@/types/enums'
import { RichTextEditor } from '@/components/ui/RichTextEditor'
/**
 * `Team` is the generated type for the `teams` collection, which holds PEOPLE. Slug and
 * type name are unchanged on purpose — see collections/TeamMembers.ts.
 */
import type { Team } from '@/payload-types'

interface TeamMemberModalProps {
  isOpen: boolean
  onClose: () => void
  teamMember: Team | null
  onSave: (teamMember: Team) => void
}

export function TeamMemberModal({ isOpen, onClose, teamMember, onSave }: TeamMemberModalProps) {
  const team = teamMember
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>(TeamMemberRole.MEMBER)
  const [active, setActive] = useState(true)
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (team) {
      setName(team.name)
      setEmail(team.email || '')
      setRole(String(team.role || TeamMemberRole.MEMBER))
      setActive(team.active !== false)
      setDescription(team.description as unknown as string || '')
      setColor(team.color as string || '#6366f1')
    } else {
      setName('')
      setEmail('')
      setRole(TeamMemberRole.MEMBER)
      setActive(true)
      setDescription('')
      setColor('#6366f1')
    }
    setError(null)
    setIsFullScreen(true)
  }, [team, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return

    setIsSubmitting(true)
    setError(null)

    try {
      const payload = {
        name: name.trim(),
        // The collection is auth-enabled, so an email is required and must be unique.
        email: email.trim(),
        role,
        active,
        description: description || null,
        color,
      }

      // REST path stays /api/teams — the slug did not change.
      const url = team ? `/api/teams/${team.id}` : '/api/teams'
      const method = team ? 'PATCH' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.errors?.[0]?.message || 'Failed to save team member')
      }

      const savedTeamMember = await response.json()
      onSave(savedTeamMember.doc || savedTeamMember)
    } catch (err) {
      console.error('Failed to save team member:', err)
      setError(err instanceof Error ? err.message : 'Failed to save team member')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 ${isFullScreen ? '' : 'p-4 sm:p-6'}`}>
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className={`relative flex flex-col bg-card shadow-2xl overflow-hidden transition-all duration-300 ${
          isFullScreen
            ? 'w-full h-full max-w-none rounded-none'
            : 'w-full max-w-2xl mx-auto max-h-[90vh] rounded-xl border border-border/50'
        }`}
      >
        {/* Header */}
        <div className="flex-none flex items-center justify-between px-6 py-3 border-b border-border/30">
          <span className="text-sm text-muted-foreground">
            {team ? 'Edit Team Member' : 'New Team Member'}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-md transition-colors"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <form id="team-form" onSubmit={handleSubmit} className={`${isFullScreen ? 'max-w-4xl mx-auto' : ''}`}>
            <div className={`flex ${isFullScreen ? 'gap-0' : 'flex-col'}`}>
              {/* Main Content */}
              <div className={`flex-1 p-8 ${isFullScreen ? 'pr-0' : ''}`}>
                {/* Icon & Name */}
                <div className="flex items-start gap-4 mb-6">
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${color}20` }}
                  >
                    <Users className="w-7 h-7" style={{ color }} />
                  </div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name"
                    className="flex-1 bg-transparent text-2xl font-bold text-foreground placeholder:text-muted-foreground/40 border-none px-0 py-2 focus:ring-0 focus:outline-none"
                    autoFocus
                    required
                  />
                </div>

                {/* Email */}
                <div className="mb-6">
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full bg-secondary/40 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Required — this collection is auth-enabled, so every person needs a unique address.
                  </p>
                </div>

                {/* Description */}
                <div className="mb-8">
                  <RichTextEditor
                    value={description}
                    onChange={setDescription}
                    placeholder="What this person does, and anything worth knowing about their work..."
                  />
                </div>

                {error && (
                  <p className="text-sm text-destructive mb-4" role="alert">
                    {error}
                  </p>
                )}
              </div>

              {/* Sidebar */}
              <div className={`${isFullScreen ? 'w-72 border-l border-border/30 p-6 bg-secondary/10' : 'p-8 pt-0'}`}>
                <div className="space-y-6">
                  {/* Role */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">Role</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full bg-secondary/40 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                    >
                      {TEAM_MEMBER_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Active */}
                  <div>
                    <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) => setActive(e.target.checked)}
                        className="rounded border-border/50"
                      />
                      Active
                    </label>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Inactive people keep their history but drop out of assignment pickers.
                    </p>
                  </div>

                  {/* Color */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-3 block">Color</label>
                    <div className="grid grid-cols-6 gap-2">
                      {PROJECT_COLORS.map((colorOption) => (
                        <button
                          key={colorOption}
                          type="button"
                          onClick={() => setColor(colorOption)}
                          className={`w-7 h-7 rounded-full transition-all ${
                            color === colorOption ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card scale-110' : ''
                          }`}
                          style={{ backgroundColor: colorOption }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex-none flex justify-end gap-3 px-6 py-4 border-t border-border/30">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="team-form"
            disabled={isSubmitting || !name.trim() || !email.trim()}
            className="px-5 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-md transition-all disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : team ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
