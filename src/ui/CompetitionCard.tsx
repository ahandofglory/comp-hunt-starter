import { Bookmark, BookmarkCheck, Calendar, CheckCircle2, ExternalLink, Tag, Trash2 } from 'lucide-react'
import React from 'react'
import { Competition } from '../types'

function fmtDate(iso?: string) {
  try {
    return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
  } catch {
    return ''
  }
}

export function CompetitionCard({
  item,
  flags,
  onToggleSave,
  onEnter,
  onToggleSubmitted,
  onDelete,
}: {
  item: Competition
  flags: { saved?: boolean; submitted?: boolean }
  onToggleSave: () => void
  onEnter: () => void
  onToggleSubmitted: () => void
  onDelete: () => void
}) {
  const isSaved = !!flags.saved
  const isSubmitted = !!flags.submitted

  // Build meta parts that render on their OWN line under the title
  const metaParts: React.ReactNode[] = []
  if (item.source) metaParts.push(<span key="src" className="text-gray-600">{item.source}</span>)
  if (item.prize) metaParts.push(
    <span key="prize" className="text-xs bg-gray-100 rounded px-2 py-0.5">Prize: {item.prize}</span>
  )
  if (item.deadline) metaParts.push(
    <span key="due" className="text-gray-600 inline-flex items-center gap-1">
      <Calendar className="h-3.5 w-3.5" /> Due {new Date(item.deadline).toLocaleDateString()}
    </span>
  )

  return (
    <article className="ph-card">
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          <div className="min-w-0 grow">
            {/* Title always on its own line */}
            <a
              href={item.link}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline block truncate"
              title={item.title}
            >
              {item.title}
            </a>

            {/* Meta ALWAYS on a NEW line; bullets only between items (no leading bullet) */}
            {metaParts.length > 0 && (
              <div className="mt-1 text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
                {metaParts.map((node, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-gray-300">•</span>}
                    {node}
                  </React.Fragment>
                ))}
              </div>
            )}

            {/* Optional tags block (kept separate from the meta row) */}
            {item.tags?.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {item.tags.map(t => (
                  <span key={t} className="text-xs text-gray-600 inline-flex items-center gap-1">
                    <Tag className="h-3.5 w-3.5" /> {t}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="text-xs text-gray-500 whitespace-nowrap">
            {item.createdAt ? <>Posted {fmtDate(item.createdAt)}</> : null}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" onClick={onEnter}>
            <ExternalLink className="h-4 w-4" /> Enter
          </button>

          <button className={`btn ${isSaved ? 'btn-active' : 'btn-muted'}`} onClick={onToggleSave}>
            {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
            {isSaved ? 'Saved' : 'Save'}
          </button>

          <button className={`btn ${isSubmitted ? 'btn-active' : 'btn-muted'}`} onClick={onToggleSubmitted}>
            <CheckCircle2 className="h-4 w-4" />
            {isSubmitted ? 'Submitted' : 'Mark as submitted'}
          </button>

          <button className="btn btn-ghost" onClick={onDelete} title="Delete so it never comes back">
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      </div>
    </article>
  )
}
