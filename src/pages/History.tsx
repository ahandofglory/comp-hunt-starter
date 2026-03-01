// src/pages/History.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Competition } from "../types";
import { Download, Upload, Trash2 } from "lucide-react";
import {
  readArchive,
  exportArchive,
  importArchive,
  setNotes,
  setOutcome,
  remove,
  type ArchiveItem,
} from "../lib/archive";

type Tab = "all" | "active" | "expired" | "entered" | "saved" | "won";

export default function HistoryPage({ currentFeed }: { currentFeed?: Competition[] }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [items, setItems] = useState<ArchiveItem[]>(() => readArchive());
  const fileRef = useRef<HTMLInputElement | null>(null);

  // simple poll to keep in sync if other pages modify archive
  useEffect(() => {
    const id = setInterval(() => setItems(readArchive()), 1000);
    return () => clearInterval(id);
  }, []);

  const q = query.toLowerCase();

  const filtered = useMemo(() => {
    let list = items;

    if (q) {
      list = list.filter((i) => `${i.title} ${i.source ?? ""}`.toLowerCase().includes(q));
    }

    if (tab !== "all") {
      list = list.filter((i) => {
        if (tab === "saved") return !!i.saved;
        if (tab === "entered") return !!i.entered;
        if (tab === "won") return i.outcome === "won";
        if (tab === "active") return !!i.createdAt;
        if (tab === "expired") return !i.createdAt;
        return true;
      });
    }
    return list;
  }, [items, q, tab]);

  function onExport() {
    const blob = exportArchive();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `parlay-history-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importArchive(file);
      setItems(readArchive());
      alert("Import complete.");
    } catch {
      alert("Couldn’t import that file.");
    } finally {
      e.target.value = "";
    }
  }

  const pill = "px-4 h-12 inline-flex items-center gap-2 rounded-full border text-sm";
  const inactive = "border-[#e5e7eb] text-gray-800 bg-white";
  const active = "bg-[#111827] text-white border-[#111827]";

  return (
    <div className="space-y-6">
      {/* top controls */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold">Your competition history</h2>
          <p className="text-gray-600">
            Archived snapshots of items you saved or entered, even if they’re no longer in the feed.
          </p>
        </div>

        <div className="flex items-center gap-2 whitespace-nowrap">
          <button
            onClick={onExport}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-100"
          >
            <Download className="h-4 w-4" />
            Export JSON
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-100"
          >
            <Upload className="h-4 w-4" />
            Import
          </button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onImportFile} />
        </div>
      </div>

      {/* search + filter pills */}
      <div className="space-y-4">
        <div className="relative">
          <input
            className="w-full pl-3 pr-3 py-3 rounded-lg border border-gray-300 bg-white outline-none focus:ring-2"
            placeholder="Search history…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["all", "All"],
              ["active", "Active"],
              ["expired", "Expired"],
              ["entered", "Entered"],
              ["saved", "Saved"],
              ["won", "Won"],
            ] as [Tab, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`${pill} ${tab === value ? active : inactive}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* results */}
      <div className="space-y-3 md:space-y-4">
        {filtered.length === 0 ? (
          <div className="ph-card text-center text-gray-500">No items yet.</div>
        ) : (
          filtered.map((it) => <HistoryRow key={it.id} item={it} />)
        )}
      </div>
    </div>
  );
}

function HistoryRow({ item }: { item: ArchiveItem }) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotesLocal] = useState(item.notes ?? "");
  const won = item.outcome === "won";

  function saveNotes() {
    setNotes(item.id, notes.trim());
    setEditing(false);
  }
  function markWon() {
    setOutcome(item.id, "won");
  }
  function doDelete() {
    remove(item.id);
  }

  return (
    <article className="ph-card">
      {/* header row: left title/source; right actions (Delete → Add note → Mark as won) */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{item.title}</div>
          <div className="mt-1 text-sm text-gray-600">{item.source ?? ""}</div>

          {/* chips row */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {item.entered && <Chip>Entered</Chip>}
            {item.saved && <Chip>Saved</Chip>}
            {item.createdAt ? (
              <Chip className="bg-green-100 text-green-800">Active</Chip>
            ) : (
              <Chip className="bg-gray-200 text-gray-700">Expired</Chip>
            )}
            {won && <Chip className="bg-yellow-100 text-yellow-800">Won 🎉</Chip>}
          </div>
        </div>

        {/* actions on the same line, in required order */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="btn btn-ghost text-red-600 hover:text-red-800 inline-flex items-center gap-1"
            onClick={doDelete}
            title="Delete from history"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>

          <button
            className="btn btn-muted"
            onClick={() => setEditing(true)}
            title={notes ? "Edit note" : "Add note"}
          >
            {notes ? "Edit note" : "Add note"}
          </button>

          {!won && (
            <button className="btn btn-primary" onClick={markWon} title="Mark as won">
              Mark as won
            </button>
          )}
        </div>
      </div>

      {/* notes editor (appears below header when editing) */}
      <div className="mt-3">
        {!editing ? (
          <p className="text-sm text-gray-800 whitespace-pre-wrap">
            {notes || <span className="text-gray-400 italic">No notes yet</span>}
          </p>
        ) : (
          <div className="space-y-2">
            <textarea
              className="w-full rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm outline-none focus:ring-2"
              rows={3}
              placeholder="Add a note (e.g., what you submitted)"
              value={notes}
              onChange={(e) => setNotesLocal(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <button
                className="btn btn-primary"
                onClick={saveNotes}
                disabled={notes.trim().length === 0}
              >
                Save note
              </button>
              <button className="btn btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
        className || "bg-gray-100 text-gray-700"
      }`}
    >
      {children}
    </span>
  );
}
