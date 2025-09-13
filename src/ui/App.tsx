// src/ui/App.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { Filter, Inbox, Search, Trash2, Upload } from 'lucide-react'
import { Competition } from '../types'
import { demoCompetitions } from '../data/demo'
import { CompetitionCard } from './CompetitionCard'

// ===== Flags-based persistence =====
type Flags = { saved?: boolean; entered?: boolean; submitted?: boolean }

type PersistState = {
  version: number // 2
  flags: Record<string, Flags>
  deleted: string[]
}

const STORAGE_KEY = 'parlay:v2' // brand-aligned key

function migrateFromV1(parsed: any): PersistState {
  const flags: Record<string, Flags> = {}
  const oldStatuses: Record<string, string> = parsed?.statuses || {}
  for (const [id, s] of Object.entries(oldStatuses)) {
    const status = String(s)
    flags[id] = {
      saved: status === 'saved',
      entered: status === 'entered',
      submitted: status === 'submitted',
    }
  }
  return { version: 2, flags, deleted: parsed?.deleted || [] }
}

function loadState(): PersistState {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    // migrate from older keys if found
    const oldRaw =
      localStorage.getItem('parley:v2') || // previous brand key
      localStorage.getItem('parley:v1') ||
      localStorage.getItem('comp-hunt:v1')
    if (oldRaw) {
      try {
        const parsed = JSON.parse(oldRaw)
        const migrated =
          parsed?.version === 2 && parsed?.flags
            ? ({ ...parsed, version: 2 } as PersistState)
            : migrateFromV1(parsed)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
        return migrated
      } catch {
        /* ignore */
      }
    }
    return { version: 2, flags: {}, deleted: [] }
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed.version === 2 && parsed.flags) return parsed as PersistState
    if (parsed.statuses) return migrateFromV1(parsed)
  } catch {
    /* ignore */
  }
  return { version: 2, flags: {}, deleted: [] }
}

function saveState(s: PersistState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

// ===== Config =====
const AUTO_REFRESH_MS = 5 * 60 * 1000 // 5 minutes; set to 0 to disable

export default function App() {
  // Last-seen marker (for a possible “New since last visit” divider)
  const LAST_SEEN_KEY = 'parlay_last_seen_v1'
  const [lastSeenMs, setLastSeenMs] = React.useState(0)
  React.useEffect(() => {
    const v = Number(localStorage.getItem(LAST_SEEN_KEY) || 0)
    setLastSeenMs(v)
  }, [])

  const [persist, setPersist] = useState<PersistState>(() => loadState())
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'all'|'saved'|'entered'|'submitted'>('all')
  const [sort, setSort] = useState<'newest'|'deadline'>('newest')

  // NEW: Source chip filter
  const [sourceChip, setSourceChip] = useState<'all' | string>('all')

  // NEW: Open-only toggle (hide past-deadline items)
  const [openOnly, setOpenOnly] = useState(false)

  // demo vs feeds
  const [source, setSource] = useState<'demo'|'feeds'>('demo')
  const [feedItems, setFeedItems] = useState<Competition[]>([])
  const [loadingFeeds, setLoadingFeeds] = useState(false)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => saveState(persist), [persist])

  const data: Competition[] = source === 'feeds' ? feedItems : demoCompetitions

  // Build the visible list (search → tab → source chip → (optional) open-only → sort)
  const visible = useMemo(() => {
    const q = query.toLowerCase().trim()
    const now = Date.now()

    let items = data.filter(c => !persist.deleted.includes(c.id))

    // Search
    if (q) {
      items = items.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.source.toLowerCase().includes(q) ||
        (c.tags||[]).some(t => t.toLowerCase().includes(q))
      )
    }

    // Tabs
    if (tab !== 'all') {
      items = items.filter(c => {
        const f = persist.flags[c.id] || {}
        if (tab === 'saved') return !!f.saved
        if (tab === 'entered') return !!f.entered
        if (tab === 'submitted') return !!f.submitted
        return true
      })
    }

    // Source chip
    if (sourceChip !== 'all') {
      items = items.filter(c => c.source === sourceChip)
    }

    // NEW: Open-only (hide past deadlines; keep items with no deadline)
    if (openOnly) {
      items = items.filter(c => {
        if (!c.deadline) return true
        const t = Date.parse(c.deadline)
        return Number.isFinite(t) && t >= now
      })
    }

    // Sort
    items.sort((a,b) => {
      if (sort === 'newest') return +new Date(b.createdAt || 0) - +new Date(a.createdAt || 0)
      const da = a.deadline ? +new Date(a.deadline) : Number.POSITIVE_INFINITY
      const db = b.deadline ? +new Date(b.deadline) : Number.POSITIVE_INFINITY
      return da - db
    })

    return items
  }, [query, tab, sort, persist, data, sourceChip, openOnly])

  // Counts for the tab pills
  const counts = useMemo(() => {
    const filtered = data.filter(c => !persist.deleted.includes(c.id))
    let saved = 0, entered = 0, submitted = 0
    for (const c of filtered) {
      const f = persist.flags[c.id] || {}
      if (f.saved) saved++
      if (f.entered) entered++
      if (f.submitted) submitted++
    }
    return {
      all: filtered.length,
      saved,
      entered,
      submitted,
    }
  }, [data, persist])

  // Build the list of sources for chips (after deletion filter)
  const sourceChips = useMemo(() => {
    const filtered = data.filter(c => !persist.deleted.includes(c.id))
    const map = new Map<string, number>()
    for (const it of filtered) {
      const key = it.source || '(unknown)'
      map.set(key, (map.get(key) || 0) + 1)
    }
    // Sort alphabetically for stability
    return Array.from(map.entries()).sort((a,b) => a[0].localeCompare(b[0]))
  }, [data, persist])

  // Save last-seen after we actually render some items
  React.useEffect(() => {
    if (!visible || visible.length === 0) return
    const id = window.setTimeout(() => {
      localStorage.setItem(LAST_SEEN_KEY, String(Date.now()))
    }, 300)
    return () => window.clearTimeout(id)
  }, [visible])

  // Flag helpers
  function setFlags(id: string, mut: (old: Flags) => Flags) {
    setPersist(p => {
      const old = p.flags[id] || {}
      const next = mut(old)
      return { ...p, flags: { ...p.flags, [id]: next } }
    })
  }

  const toggleSaved = (id: string) => setFlags(id, f => ({ ...f, saved: !f.saved }))
  const toggleSubmitted = (id: string) => setFlags(id, f => ({ ...f, submitted: !f.submitted }))
  const markEntered = (id: string) => setFlags(id, f => ({ ...f, entered: true }))
  const permDelete = (id: string) =>
    setPersist(p => ({ ...p, deleted: Array.from(new Set([...(p.deleted || []), id])) }))

  // Feeds loading
  async function loadFeeds(silent = false) {
    if (!silent) { setLoadingFeeds(true); setFeedError(null) }
    try {
      const res = await fetch('/feeds.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const items = (await res.json()) as Competition[]
      setFeedItems(items)
      setSource('feeds')
      setLastUpdated(new Date())
      if (!silent) setFeedError(null)
    } catch (e: any) {
      if (!silent) setFeedError('Could not load feeds.json. Did you run "npm run pull:feeds"?')
    } finally {
      if (!silent) setLoadingFeeds(false)
    }
  }

  // Load once on mount
  useEffect(() => { loadFeeds(true) }, [])

  // Auto-refresh feeds
  useEffect(() => {
    if (AUTO_REFRESH_MS <= 0 || source !== 'feeds') return
    const id = setInterval(() => loadFeeds(true), AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [source])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container-narrow px-4 py-3 flex items-center gap-3">
          <div
            className="h-9 w-9 rounded-xl grid place-items-center font-bold"
            style={{ backgroundColor: '#3671CF', color: '#ffffff' }}
          >
            P
          </div>
          <h1 className="text-lg font-semibold">Parlay</h1>
          <span className="ml-auto text-sm text-gray-500">
            {source === 'feeds' ? 'RSS & site feeds' : 'Demo data'}
            {source === 'feeds' && lastUpdated ? ` • Updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
        </div>
      </header>

      {/* Toolbar */}
      <div className="container-narrow px-4 py-8 flex flex-col gap-6">
        {/* Row 1: Search */}
        <div className="flex items-center gap-2">
          <div className="relative grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 bg-white outline-none focus:ring-2"
              placeholder="Search competitions…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Row 2: Tabs left, controls right */}
        <div className="flex items-center gap-2">
          <nav className="flex flex-wrap items-center gap-2 text-sm grow">
            {(['all','saved','entered','submitted'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-full border ${
                  tab === t
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                {t[0].toUpperCase() + t.slice(1)} {t === 'all' ? `(${counts.all})`
                  : t === 'saved' ? `(${counts.saved})`
                  : t === 'entered' ? `(${counts.entered})`
                  : `(${counts.submitted})`}
              </button>
            ))}
          </nav>

          {/* Right-side controls: Restore, Sort, Open-only */}
          <div className="flex items-center gap-2">
            <button
              className="btn btn-ghost"
              onClick={() => setPersist(p => ({ ...p, deleted: [] }))}
              title="Restore any deleted items"
            >
              <Trash2 className="h-4 w-4" />
              Restore Deleted
            </button>

            <button
              className="btn btn-muted"
              onClick={() => setSort(s => (s === 'newest' ? 'deadline' : 'newest'))}
            >
              <Filter className="h-4 w-4" />
              Sort: {sort === 'newest' ? 'Newest' : 'Deadline'}
            </button>

            {/* NEW: tiny Open-only toggle */}
            <button
              className={`px-3 py-1.5 rounded-full border text-sm ${
                openOnly
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setOpenOnly(v => !v)}
              title="Hide items whose deadline has passed"
            >
              {openOnly ? 'Open only: On' : 'Open only: Off'}
            </button>
          </div>
        </div>

        {/* Row 3: Source chips */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-gray-500 mr-1">Source:</span>

          {/* "All sources" chip */}
          <button
            onClick={() => setSourceChip('all')}
            className={`px-3 py-1.5 rounded-full border ${
              sourceChip === 'all'
                ? 'bg-brand-600 text-white border-brand-600'
                : 'border-gray-200 text-gray-700 hover:bg-gray-100'
            }`}
          >
            All
          </button>

          {/* One chip per source */}
          {sourceChips.map(([name, count]) => (
            <button
              key={name}
              onClick={() => setSourceChip(name)}
              className={`px-3 py-1.5 rounded-full border ${
                sourceChip === name
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-100'
              }`}
              title={`${name} • ${count} item${count === 1 ? '' : 's'}`}
            >
              {name} ({count})
            </button>
          ))}
        </div>

        {/* Soft error (if we explicitly tried and failed) */}
        {feedError && <div className="text-sm text-red-600">{feedError}</div>}
      </div>

      {/* Feed */}
      <main className="container-narrow px-4 pb-12 space-y-3">
        {visible.length === 0 ? (
          <div className="ph-card text-center text-gray-500">
            <Inbox className="mx-auto h-10 w-10 mb-2" />
            <p>No items here yet. Try “Save”, different tab/source, toggle Open-only, or check your feeds.json.</p>
          </div>
        ) : visible.map(c => (
          <CompetitionCard
            key={c.id}
            item={c}
            flags={persist.flags[c.id] || {}}
            onToggleSave={() => toggleSaved(c.id)}
            onEnter={() => { window.open(c.link, '_blank'); markEntered(c.id) }}
            onToggleSubmitted={() => toggleSubmitted(c.id)}
            onDelete={() => permDelete(c.id)}
          />
        ))}
      </main>

      {/* Footer */}
      <footer className="border-t bg-white">
        <div className="container-narrow px-4 py-6 text-sm text-gray-600 flex items-center gap-4">
          <span>Next up: auto-tagging, email integration.</span>
          <a className="ml-auto inline-flex items-center gap-2 underline" href="https://github.com/" target="_blank" rel="noreferrer">
            <Upload className="h-4 w-4" /> Push to GitHub
          </a>
        </div>
      </footer>
    </div>
  )
}
