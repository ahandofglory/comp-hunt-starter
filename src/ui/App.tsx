// src/ui/App.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Competition } from "../types";
import { demoCompetitions } from "../data/demo";
import { CompetitionCard } from "./CompetitionCard";
import {
  MoreVertical,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Download,
  ChevronDown,
} from "lucide-react";

// ===== Types =====
type Flags = { saved?: boolean; submitted?: boolean };
type PersistState = { version: number; flags: Record<string, Flags>; deleted: string[] };
type IngestionSummary = { pulledAtIso?: string; totals?: { all?: number; bySource?: Record<string, number> } };
type StatusFilter = "all" | "submitted" | "not_submitted" | "saved";

// ===== Storage / migration =====
const STORAGE_KEY = "parlay:v2";
const LAST_SEEN_KEY = "parlay:last_seen_v2";

function migrateFromV1(parsed: any): PersistState {
  const flags: Record<string, Flags> = {};
  const oldStatuses: Record<string, string> = parsed?.statuses || {};
  for (const [id, s] of Object.entries(oldStatuses)) {
    const status = String(s);
    flags[id] = {
      saved: status === "saved",
      submitted: status === "submitted" || status === "entered",
    };
  }
  return { version: 2, flags, deleted: parsed?.deleted || [] };
}
function loadState(): PersistState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const oldRaw =
      localStorage.getItem("parley:v2") ||
      localStorage.getItem("parley:v1") ||
      localStorage.getItem("comp-hunt:v1");
    if (oldRaw) {
      try {
        const parsed = JSON.parse(oldRaw);
        const migrated =
          parsed?.version === 2 && parsed?.flags
            ? ({ ...parsed, version: 2 } as PersistState)
            : migrateFromV1(parsed);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      } catch {}
    }
    return { version: 2, flags: {}, deleted: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version === 2 && parsed.flags) return parsed as PersistState;
    if (parsed.statuses) return migrateFromV1(parsed);
  } catch {}
  return { version: 2, flags: {}, deleted: [] };
}
function saveState(s: PersistState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

// ===== Small utils =====
function cn(...a: (string | false | undefined)[]) {
  return a.filter(Boolean).join(" ");
}
function formatTimeNZ(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-NZ", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}
function byNewest(a: Competition, b: Competition) {
  const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
  const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
  return (tb || 0) - (ta || 0);
}
const statusLabel = (s: StatusFilter) =>
  s === "all" ? "All" : s === "submitted" ? "Submitted" : s === "not_submitted" ? "Not submitted" : "Saved";

// ===== Component =====
export default function App() {
  // persistence
  const [persist, setPersist] = useState<PersistState>(() => loadState());
  useEffect(() => saveState(persist), [persist]);

  // last-seen for "new" counts
  const [lastSeenMs, setLastSeenMs] = useState<number>(() => Number(localStorage.getItem(LAST_SEEN_KEY) || 0));
  useEffect(() => {
    const id = window.setTimeout(() => {
      localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
      setLastSeenMs(Date.now());
    }, 400);
    return () => clearTimeout(id);
  }, []);

  // data
  const [feedItems, setFeedItems] = useState<Competition[]>([]);
  const [ingestion, setIngestion] = useState<IngestionSummary | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [localUpdated, setLocalUpdated] = useState<Date | null>(null);

  // ui state
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [statusOpen, setStatusOpen] = useState(false);

  // menus
  const [menuOpen, setMenuOpen] = useState(false);
  const kebabRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // close dropdowns on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!(e.target instanceof Node)) return;
      if (kebabRef.current && !kebabRef.current.contains(e.target)) setMenuOpen(false);
      if (statusRef.current && !statusRef.current.contains(e.target)) setStatusOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // loader
  async function loadFeeds(showSpinner = true) {
    if (showSpinner) setIsReloading(true);
    setFeedError(null);
    try {
      const ts = Date.now();
      const [fRes, iRes] = await Promise.all([
        fetch(`/feeds.json?ts=${ts}`, { cache: "no-store" }),
        fetch(`/ingestion.json?ts=${ts}`, { cache: "no-store" }),
      ]);
      if (!fRes.ok) throw new Error(`HTTP ${fRes.status}`);
      const arr = (await fRes.json()) as Competition[];
      setFeedItems(arr.sort(byNewest));
      setLocalUpdated(new Date());
      if (iRes.ok) {
        try {
          setIngestion((await iRes.json()) as IngestionSummary);
        } catch {
          setIngestion(null);
        }
      } else {
        setIngestion(null);
      }
    } catch {
      setFeedError('Could not refresh local data. Run "npm run pull:feeds" to pull new items.');
    } finally {
      if (showSpinner) setIsReloading(false);
    }
  }
  useEffect(() => {
    loadFeeds(false);
  }, []);

  // counts by source
  const liveSourceCounts = useMemo(() => {
    const by: Record<string, number> = {};
    for (const c of feedItems) {
      const s = c.source || "unknown";
      by[s] = (by[s] || 0) + 1;
    }
    return by;
  }, [feedItems]);

  const sources = useMemo(() => {
    const names = Object.keys(liveSourceCounts).sort((a, b) => a.localeCompare(b));
    return ["__all__", ...names];
  }, [liveSourceCounts]);

  // "new since last seen"
  const newSinceCount = useMemo(() => {
    let n = 0;
    for (const c of feedItems) {
      if (!c.createdAt) continue;
      const t = Date.parse(c.createdAt);
      if (Number.isFinite(t) && t > lastSeenMs) n++;
    }
    return n;
  }, [feedItems, lastSeenMs]);

  // filtering
  const visible = useMemo(() => {
    let items = feedItems.filter((c) => !persist.deleted.includes(c.id));
    if (query.trim()) {
      const q = query.toLowerCase();
      items = items.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.source || "").toLowerCase().includes(q)
      );
    }
    if (sourceFilter !== "__all__") {
      items = items.filter((c) => (c.source || "") === sourceFilter);
    }
    if (statusFilter !== "all") {
      items = items.filter((c) => {
        const f = persist.flags[c.id] || {};
        if (statusFilter === "submitted") return !!f.submitted;
        if (statusFilter === "not_submitted") return !f.submitted;
        if (statusFilter === "saved") return !!f.saved;
        return true;
      });
    }
    return items.sort(byNewest);
  }, [feedItems, persist, query, sourceFilter, statusFilter]);

  // flag helpers
  function setFlags(id: string, mut: (old: Flags) => Flags) {
    setPersist((p) => ({ ...p, flags: { ...p.flags, [id]: mut(p.flags[id] || {}) } }));
  }
  const toggleSaved = (id: string) => setFlags(id, (f) => ({ ...f, saved: !f.saved }));
  const toggleSubmitted = (id: string) => setFlags(id, (f) => ({ ...f, submitted: !f.submitted }));
  const permDelete = (id: string) =>
    setPersist((p) => ({ ...p, deleted: Array.from(new Set([...(p.deleted || []), id])) }));

  // kebab actions
  function restoreDeleted() {
    setPersist((p) => ({ ...p, deleted: [] }));
    setMenuOpen(false);
  }
  function exportUserData() {
    const payload = {
      schema: "parlay:user:v2",
      exportedAt: new Date().toISOString(),
      version: 2,
      flags: persist.flags,
      deleted: persist.deleted,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `parlay-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
    setMenuOpen(false);
  }
  function triggerImport() {
    fileRef.current?.click();
    setMenuOpen(false);
  }
  async function onImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const ok =
        (data?.schema === "parlay:user:v2" || data?.version === 2) &&
        data?.flags &&
        Array.isArray(data?.deleted);
      if (!ok) {
        alert("That JSON doesn’t look like a Parlay user backup.");
        e.target.value = "";
        return;
      }
      const next: PersistState = { version: 2, flags: data.flags, deleted: data.deleted || [] };
      setPersist(next);
      saveState(next);
      alert("Import complete.");
    } catch {
      alert("Couldn’t read that file. Please check it’s a valid JSON export.");
    } finally {
      e.target.value = "";
    }
  }

  // header summary
  const pulledIso = ingestion?.pulledAtIso || (localUpdated ? localUpdated.toISOString() : undefined);
  const pulledTime = pulledIso ? formatTimeNZ(pulledIso) : "";

  // styles
  const pillBase = "px-4 h-12 inline-flex items-center gap-2 rounded-full border text-base";
  const inactiveStroke = "border-[#e5e7eb] text-gray-800 bg-white";
  const activeDark = "bg-[#111827] text-white border-[#111827]";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container-narrow px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">Parlay</h1>
            <div className="mt-1 text-sm text-gray-500 truncate">
              {pulledTime ? `Updated ${pulledTime}` : "Updated —"}
              {newSinceCount > 0 ? ` • ${newSinceCount} new listing${newSinceCount > 1 ? "s" : ""}` : ""}
            </div>
          </div>

          <button
            className={cn(
              "relative inline-flex items-center justify-center w-10 h-10 rounded-lg border",
              "border-gray-300 bg-white hover:bg-gray-100"
            )}
            title="Reload local data"
            onClick={() => loadFeeds(true)}
          >
            <RefreshCw className={cn("h-4 w-4", isReloading && "animate-spin")} aria-hidden />
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="container-narrow px-4 py-6 space-y-4">
        {/* Search + kebab row */}
        <div className="flex items-center gap-2">
          <div className="relative grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-3 rounded-lg border border-gray-300 bg-white outline-none focus:ring-2"
              placeholder="Search competitions…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* Kebab (icon only) */}
          <div className="relative" ref={kebabRef}>
            <button
              className="p-2 rounded-md text-gray-700 hover:text-gray-900 hover:bg-gray-100"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="More actions"
            >
              <MoreVertical className="h-5 w-5" />
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 mt-2 w-64 rounded-lg border border-gray-200 bg-white shadow-lg p-1 z-20"
                role="menu"
              >
                <button
                  className="w-full px-3 py-2 rounded-md text-left hover:bg-gray-50 inline-flex items-center gap-2"
                  onClick={restoreDeleted}
                  role="menuitem"
                >
                  <Trash2 className="h-4 w-4" />
                  Restore deleted
                </button>
                <button
                  className="w-full px-3 py-2 rounded-md text-left hover:bg-gray-50 inline-flex items-center gap-2"
                  onClick={exportUserData}
                  role="menuitem"
                >
                  <Download className="h-4 w-4" />
                  Export data (JSON)
                </button>
                <button
                  className="w-full px-3 py-2 rounded-md text-left hover:bg-gray-50 inline-flex items-center gap-2"
                  onClick={triggerImport}
                  role="menuitem"
                >
                  <Upload className="h-4 w-4" />
                  Import data (JSON)
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={onImportFileChange}
                />
              </div>
            )}
          </div>
        </div>

        {/* Source chips — full-width own row */}
        <div className="w-full">
          <div className="flex flex-wrap items-center gap-2">
            {sources.map((s) => {
              const isAll = s === "__all__";
              const label = isAll ? "All sources" : s;
              const active = sourceFilter === s;
              return (
                <button
                  key={s}
                  onClick={() => setSourceFilter(s)}
                  className={cn(pillBase, active ? activeDark : inactiveStroke)}
                >
                  {label}
                  {!isAll && <span className="text-gray-500">{liveSourceCounts[s as string] || 0}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Status dropdown — full-width row, right-aligned, fixed gap before cards */}
        <div className="w-full flex justify-end mb-5" ref={statusRef}>
          <div className="relative">
            <button
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 text-gray-900"
              onClick={() => setStatusOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={statusOpen}
              title="Filter by status"
            >
              <span className="font-medium">Filter by:</span>
              <span>{statusLabel(statusFilter)}</span>
              <ChevronDown className="h-4 w-4 opacity-70" />
            </button>

            {statusOpen && (
              <div
                className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-gray-200 bg-white shadow-lg p-1"
                role="listbox"
              >
                {(
                  [
                    ["all", "All"],
                    ["submitted", "Submitted"],
                    ["not_submitted", "Not submitted"],
                    ["saved", "Saved"],
                  ] as [StatusFilter, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => {
                      setStatusFilter(value);
                      setStatusOpen(false);
                    }}
                    className={cn(
                      "w-full px-3 py-2 rounded-md text-left hover:bg-gray-50",
                      value === statusFilter && "bg-gray-100"
                    )}
                    role="option"
                    aria-selected={value === statusFilter}
                  >
                    {`Filter by: ${label}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {feedError && <div className="text-sm text-red-600">{feedError}</div>}
      </div>

      {/* Feed */}
      <main className="container-narrow px-4 pb-16 space-y-3 md:space-y-4">
        {visible.length === 0 ? (
          <div className="ph-card text-center text-gray-500">Nothing here yet.</div>
        ) : (
          visible.map((c) => (
            <CompetitionCard
              key={c.id}
              item={c}
              flags={persist.flags[c.id] || {}}
              onToggleSave={() => toggleSaved(c.id)}
              onEnter={() => window.open(c.link, "_blank")}
              onToggleSubmitted={() => toggleSubmitted(c.id)}
              onDelete={() => permDelete(c.id)}
            />
          ))
        )}
      </main>
    </div>
  );
}
