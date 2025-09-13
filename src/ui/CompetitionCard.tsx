import { Bookmark, BookmarkCheck, Calendar, CheckCircle2, ExternalLink, Tag, Trash2 } from 'lucide-react'
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
  flags: { saved?: boolean; entered?: boolean; submitted?: boolean }
  onToggleSave: () => void
  onEnter: () => void
  onToggleSubmitted: () => void
  onDelete: () => void
}) {
  const isSaved = !!flags.saved
  const isSubmitted = !!flags.submitted

  return (
    <article className="ph-card">
      <div className="min-w-0">
        {/* Title / meta */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 grow">
            <div className="flex flex-wrap items-center gap-2">
              <a href={item.link} target="_blank" rel="noreferrer" className="font-medium hover:underline truncate">
                {item.title}
              </a>
              {item.source && <span className="text-xs text-gray-500">• {item.source}</span>}
              {item.prize && <span className="text-xs bg-gray-100 rounded px-2 py-0.5">Prize: {item.prize}</span>}
              {item.deadline && (
                <span className="text-xs text-gray-600 inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" /> Due {new Date(item.deadline).toLocaleDateString()}
                </span>
              )}
            </div>

            {item.tags?.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {item.tags.map((t) => (
                  <span key={t} className="text-xs text-gray-600 inline-flex items-center gap-1">
                    <Tag className="h-3.5 w-3.5" /> {t}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="text-xs text-gray-500 whitespace-nowrap">
            Posted {fmtDate(item.createdAt)}
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
            {/* always render the icon so spacing is consistent enough */}
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
