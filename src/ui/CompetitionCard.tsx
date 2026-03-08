// src/ui/CompetitionCard.tsx
import React from "react";
import { ArrowRight, Bookmark, BookmarkCheck, Check, Trash2 } from "lucide-react";
import { EnterButton } from "./EnterButton";
import type { Competition } from "../types";
import { markSaved, markEntered } from "../lib/archive";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function cn(...a: (string | false | undefined)[]) {
  return a.filter(Boolean).join(" ");
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

  const handleToggleSave = () => {
    onToggleSave();
    try { markSaved(item, !isSaved); } catch {}
  };

  const handleToggleSubmitted = () => {
    onToggleSubmitted();
    try { markEntered(item, !isSubmitted); } catch {}
  };

  const days = daysUntil(item.deadline);
  const isUrgentRed = days !== null && days <= 3;
  const isUrgentAmber = days !== null && days > 3 && days <= 7;

  return (
    <article
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: "1rem",
        padding: "1.25rem 0",
        borderBottom: "1px solid #e8e6e0",
      }}
    >
      {/* Left */}
      <div style={{ minWidth: 0 }}>
        <a
          href={item.link}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: "1.1rem",
            fontWeight: 500,
            lineHeight: 1.4,
            color: "#0f0f0f",
            textDecoration: "none",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical" as const,
            overflow: "hidden",
          }}
          title={item.title}
        >
          {item.title}
        </a>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", marginTop: "0.45rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#888" }}>{item.source}</span>

          {isUrgentRed && days !== null && (
            <>
              <span style={{ width: 3, height: 3, borderRadius: "50%", background: "#bbb", display: "inline-block" }} />
              <span style={{
                display: "inline-flex", alignItems: "center",
                padding: "0.2rem 0.6rem", borderRadius: "0.25rem",
                fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" as const,
                background: "#fde8e8", color: "#c0392b",
              }}>
                {days <= 0 ? "Today" : `${days} day${days === 1 ? "" : "s"} left`}
              </span>
            </>
          )}

          {isUrgentAmber && days !== null && (
            <>
              <span style={{ width: 3, height: 3, borderRadius: "50%", background: "#bbb", display: "inline-block" }} />
              <span style={{
                display: "inline-flex", alignItems: "center",
                padding: "0.2rem 0.6rem", borderRadius: "0.25rem",
                fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" as const,
                background: "#fdf3dc", color: "#b07d2a",
              }}>
                {days} days left
              </span>
            </>
          )}

          {!isUrgentRed && !isUrgentAmber && item.deadline && (
            <>
              <span style={{ width: 3, height: 3, borderRadius: "50%", background: "#bbb", display: "inline-block" }} />
              <span style={{ fontSize: "0.75rem", color: "#888" }}>Due {formatDate(item.deadline)}</span>
            </>
          )}
        </div>
      </div>

      {/* Right */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "space-between", gap: "0.75rem", flexShrink: 0 }}>
        <span style={{ fontSize: "0.7rem", color: "#bbb", whiteSpace: "nowrap" }}>
          {formatDate(item.createdAt)}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {/* Save */}
          <button
            onClick={handleToggleSave}
            title={isSaved ? "Saved" : "Save"}
            style={{
              width: 32, height: 32, borderRadius: "0.4rem",
              border: `1px solid ${isSaved ? "#c7d9f8" : "#e8e6e0"}`,
              background: isSaved ? "#eef4ff" : "transparent",
              color: isSaved ? "#2563eb" : "#888",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            {isSaved
              ? <BookmarkCheck style={{ width: 13, height: 13 }} />
              : <Bookmark style={{ width: 13, height: 13 }} />}
          </button>

          {/* Submitted */}
          <button
            onClick={handleToggleSubmitted}
            title={isSubmitted ? "Submitted" : "Mark as submitted"}
            style={{
              width: 32, height: 32, borderRadius: "0.4rem",
              border: `1px solid ${isSubmitted ? "#b3e6cc" : "#e8e6e0"}`,
              background: isSubmitted ? "#edfaf3" : "transparent",
              color: isSubmitted ? "#1a7a45" : "#888",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Check style={{ width: 13, height: 13 }} />
          </button>

          {/* Delete */}
          <button
            onClick={onDelete}
            title="Delete"
            style={{
              width: 32, height: 32, borderRadius: "0.4rem",
              border: "1px solid #e8e6e0", background: "transparent",
              color: "#888", display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer",
            }}
          >
            <Trash2 style={{ width: 13, height: 13 }} />
          </button>

          {/* Enter */}
          <EnterButton label="Enter" icon={<ArrowRight size={12} />} onClick={onEnter} />
        </div>
      </div>
    </article>
  );
}
