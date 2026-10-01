'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { NET_STATE_LABEL, type NetNode } from './network-model'
import styles from './network.module.css'

interface TicketPickerProps {
  candidates: NetNode[]
  placeholder: string
  onPick: (id: string) => void
  /** Optional note shown on a row (e.g. "would loop"); rows stay selectable. */
  annotate?: (id: string) => string | null
  ariaLabel: string
  autoFocus?: boolean
  className?: string
  /** Dropdown opens upward (for inputs near the bottom of the screen). */
  dropUp?: boolean
}

const MAX_RESULTS = 8

/** Keyboard-first ticket search by key ("LPM-5", "lpm5", "5") or title. */
export function TicketPicker({ candidates, placeholder, onPick, annotate, ariaLabel, autoFocus, className = '', dropUp }: TicketPickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const compact = q.replace(/[\s-]/g, '')
    const scored: { n: NetNode; score: number }[] = []
    for (const n of candidates) {
      const ref = n.info.ref.toLowerCase()
      const refCompact = ref.replace(/[\s-]/g, '')
      const title = n.info.title.toLowerCase()
      let score = -1
      if (ref === q || refCompact === compact) score = 0
      else if (refCompact.startsWith(compact)) score = 1
      else if (/^\d+$/.test(compact) && refCompact.endsWith(compact)) score = 2
      else if (title.startsWith(q)) score = 3
      else if (title.includes(q)) score = 4
      else if (refCompact.includes(compact)) score = 5
      if (score >= 0) scored.push({ n, score })
    }
    scored.sort((a, b) => a.score - b.score || a.n.info.ref.length - b.n.info.ref.length || a.n.info.ref.localeCompare(b.n.info.ref))
    return scored.slice(0, MAX_RESULTS).map((s) => s.n)
  }, [candidates, query])

  const pick = (id: string) => {
    onPick(id)
    setQuery('')
    setOpen(false)
    setActive(0)
  }

  return (
    <div className={`relative ${className}`} data-no-pan>
      <div className="flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-secondary/30 px-2 focus-within:border-primary">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const r = results[active] ?? results[0]
              if (r) pick(r.id)
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              setQuery('')
              setOpen(false)
              inputRef.current?.blur()
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className={`absolute left-0 right-0 z-50 max-h-72 min-w-[280px] overflow-y-auto rounded-md border border-border bg-card p-1 shadow-2xl ${
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {results.map((n, i) => {
            const note = annotate?.(n.id) ?? null
            return (
              <li key={n.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(n.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                    i === active ? 'bg-secondary text-foreground' : 'text-foreground/90'
                  }`}
                >
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{n.info.ref}</span>
                  <span className={`min-w-0 flex-1 truncate ${n.state === 'done' ? 'line-through text-muted-foreground' : ''}`}>{n.info.title}</span>
                  {note ? (
                    <span className="shrink-0 rounded bg-orange-500/15 px-1 text-[10px] font-semibold text-orange-300">{note}</span>
                  ) : (
                    <span className={`shrink-0 rounded px-1 text-[10px] font-medium ${styles[`chip-${n.state}`]}`}>{NET_STATE_LABEL[n.state]}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
