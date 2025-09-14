// src/ui/CompetitionCard.tsx
import React from "react";
import {
  Bookmark,
  BookmarkCheck,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Tag,
  Trash2,
} from "lucide-react";
import type { Competition } from "../types";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function formatPosted(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function CompetitionCard({
  item,
  flags,
  onToggleSave,
  onEnter,
  onToggleSubmitted,
  onDelete,
}: {
  item: Competition;
  flags: { saved?: boolean; submitted?: boolean };
  onToggleSave: () => void;
  onEnter: () => void;
  onToggleSubmitted: () => void;
  onDelete: () => void;
}) {
  const isSaved = !!flags.saved;
  const isSubmitted = !!flags.submitted;

  return (
    <article className="ph-card">
      {/* Top row: title left, posted date right */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 grow">
          {/* Title — clamp to 2/3 lines with ellipsis */}
          <div className="min-w-0">
            <a
              href={item.link}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline clamp-title"
              title={item.title}
              aria-label={item.title}
            >
              {item.title}
            </a>
          </div>

          {/* Meta (source, deadline, tags) */}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <span className="whitespace-nowrap">{item.source}</span>

            {item.prize && (
              <span className="text-xs bg-gray-100 rounded px-2 py-0.5">Prize: {item.prize}</span>
            )}

            {item.deadline && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Calendar className="h-3.5 w-3.5" />
                Due {formatPosted(item.deadline)}
              </span>
            )}

            {item.tags?.length
              ? item.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 text-xs text-gray-600">
                    <Tag className="h-3.5 w-3.5" />
                    {t}
                  </span>
                ))
              : null}
          </div>
        </div>

        <div className="text-xs text-gray-500 whitespace-nowrap">
          {item.createdAt ? `Posted ${formatPosted(item.createdAt)}` : ""}
        </div>
      </div>

      {/* Actions: left group (save/submitted/delete), right primary Enter */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`btn ${isSaved ? "btn-active" : "btn-muted"}`}
            onClick={onToggleSave}
          >
            {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
            {isSaved ? "Saved" : "Save"}
          </button>

          <button
            className={`btn ${isSubmitted ? "btn-active" : "btn-muted"}`}
            onClick={onToggleSubmitted}
          >
            {isSubmitted && <CheckCircle2 className="h-4 w-4" />}
            {isSubmitted ? "Submitted" : "Mark as submitted"}
          </button>

          <button className="btn btn-ghost" onClick={onDelete} title="Delete so it never comes back">
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>

        <button className="btn btn-primary" onClick={onEnter} title="Open link and mark Entered">
          <ExternalLink className="h-4 w-4" />
          Enter
        </button>
      </div>
    </article>
  );
}
