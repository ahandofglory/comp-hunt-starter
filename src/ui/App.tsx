// src/ui/App.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Competition } from "../types";
import { CompetitionCard } from "./CompetitionCard";
import {
  MoreVertical,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Download,
  ChevronDown,
  Rss,
} from "lucide-react";

import { SourcesModal } from "./SourcesModal";

// ===== Types =====
type Flags = { saved?: boolean; submitted?: boolean };

// v3 adds firstSeenAt per competition id
type PersistState = {
  version: 3;
  flags: Record<string, Flags>;
  deleted: string[];
  firstSeenAt: Record<string, string>; // id -> ISO
};

type IngestionSummary = { pulledAtIso?: string; totals?: { all?: number; bySource?: Record<string, number> } };
type StatusFilter = "all" | "submitted" | "not_submitted" | "saved";

// ===== Storage / migration =====
const STORAGE_KEY = "parlay:v3";
const LEGACY_KEYS = ["parlay:v2", "parley:v2", "parley:v1", "comp-hunt:v1"];
const LAST_SEEN_KEY = "parlay:last_seen_v3";

function nowIso() {
  return new Date().toISOString();
}

function migrateFromOlder(parsed: any): PersistState {
  // v2 shape: { version:2, flags, deleted }
  // v1-ish shape: { statuses, deleted }
  const flags: Record<string, Flags> = {};
  const deleted: string[] = Array.isArray(parsed?.deleted) ? parsed.deleted : [];
  const firstSeenAt: Record<string, string> = {};

  if (parsed?.flags) {
    for (const [id, f] of Object.entries(parsed.flags as Record<string, Flags>)) {
      flags[id] = { saved: !!f?.saved, submitted: !!f?.submitted };
    }
  } else if (parsed?.statuses) {
    const oldStatuses: Record<string, string> = parsed.statuses || {};
    for (const [id, s] of Object.entries(oldStatuses)) {
      const status = String(s);
      flags[id] = {
        saved: status === "saved",
        submitted: status === "submitted" || status === "entered",
      };
    }
  }

// Do not manufacture firstSeenAt during migration.
// It will be derived from feed createdAt on first load.
  return { version: 3, flags, deleted, firstSeenAt };
}

function loadState(): PersistState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.version === 3 && parsed?.flags && parsed?.firstSeenAt && Array.isArray(parsed?.deleted)) {
        return parsed as PersistState;
      }
    } catch {}
  }

  for (const key of LEGACY_KEYS) {
    const legacyRaw = localStorage.getItem(key);
    if (!legacyRaw) continue;
    try {
      const parsed = JSON.parse(legacyRaw);
      const migrated = migrateFromOlder(parsed);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    } catch {}
  }

  return { version: 3, flags: {}, deleted: [], firstSeenAt: {} };
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

/**
 * Stable sort key:
 * 1) firstSeenAt (persisted) so items never jump around after first appearance
 * 2) createdAt (from feed) as fallback
 * 3) id tie-breaker
 */
function stableSort(items: Competition[], firstSeenAt: Record<string, string>) {
  const getT = (iso?: string | null) => {
    if (!iso) return 0;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  };

  return items.slice().sort((a, b) => {
    const af = getT(firstSeenAt[a.id]);
    const bf = getT(firstSeenAt[b.id]);
    if (bf !== af) return bf - af;

    const ac = getT(a.createdAt || null);
    const bc = getT(b.createdAt || null);
    if (bc !== ac) return bc - ac;

    return String(a.id).localeCompare(String(b.id));
  });
}

// ===== Component =====
export default function App() {
  const [persist, setPersist] = useState<PersistState>(() => loadState());
  useEffect(() => saveState(persist), [persist]);

  const [lastSeenMs, setLastSeenMs] = useState<number>(() => Number(localStorage.getItem(LAST_SEEN_KEY) || 0));
  useEffect(() => {
    const id = window.setTimeout(() => {
      localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
      setLastSeenMs(Date.now());
    }, 400);
    return () => clearTimeout(id);
  }, []);

  const [feedItems, setFeedItems] = useState<Competition[]>([]);
  const [ingestion, setIngestion] = useState<IngestionSummary | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [localUpdated, setLocalUpdated] = useState<Date | null>(null);

  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [statusOpen, setStatusOpen] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const kebabRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!(e.target instanceof Node)) return;
      if (kebabRef.current && !kebabRef.current.contains(e.target)) setMenuOpen(false);
      if (statusRef.current && !statusRef.current.contains(e.target)) setStatusOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function loadFeeds(showSpinner = true) {
    if (showSpinner) setIsReloading(true);
    setFeedError(null);
    try {
      const ts = Date.now();

      // Your repo for remote reads (works when repo is public)
      const REMOTE_BASE =
        "https://raw.githubusercontent.com/var-username-635074/comp-hunt-starter/main/public";

      async function tryFetch(urls: string[]) {
        for (const u of urls) {
          try {
            const res = await fetch(u, { cache: "no-store" });
            if (res.ok) return res;
          } catch {}
        }
        return null;
      }

      const preferLocal = Boolean(import.meta.env?.DEV);

      const feedsUrls = preferLocal
        ? [`/feeds.json?ts=${ts}`, `${REMOTE_BASE}/feeds.json?ts=${ts}`]
        : [`${REMOTE_BASE}/feeds.json?ts=${ts}`, `/feeds.json?ts=${ts}`];

      const feedsRes = await tryFetch(feedsUrls);
      if (!feedsRes) throw new Error("No feeds.json available");
      const arr = (await feedsRes.json()) as Competition[];

      setFeedItems(arr);
      setLocalUpdated(new Date());

      const ingestionUrls = preferLocal
        ? [`/ingestion.json?ts=${ts}`, `${REMOTE_BASE}/ingestion.json?ts=${ts}`]
        : [`${REMOTE_BASE}/ingestion.json?ts=${ts}`, `/ingestion.json?ts=${ts}`];

      const ingestionRes = await tryFetch(ingestionUrls);
      if (ingestionRes) {
        try {
          setIngestion((await ingestionRes.json()) as IngestionSummary);
        } catch {
          setIngestion(null);
        }
      } else {
        setIngestion(null);
      }
    } catch {
      setFeedError('Could not refresh data. If you’re local, run "npm run pull:feeds" or check the GitHub Action.');
    } finally {
      if (showSpinner) setIsReloading(false);
    }
  }

  useEffect(() => {
    loadFeeds(false);
  }, []);

  // Ensure firstSeenAt exists for every id we currently have
  useEffect(() => {
    if (!feedItems.length) return;

    setPersist((p) => {
      const next = { ...p, firstSeenAt: { ...p.firstSeenAt } };
      let changed = false;

      for (const item of feedItems) {
  if (!item?.id) continue;

  const createdAtMs =
    item.createdAt && Number.isFinite(Date.parse(item.createdAt))
      ? Date.parse(item.createdAt)
      : null;

  const existingIso = next.firstSeenAt[item.id] || null;
  const existingMs =
    existingIso && Number.isFinite(Date.parse(existingIso))
      ? Date.parse(existingIso)
      : null;

  // If missing, set firstSeenAt using createdAt when possible.
  if (!existingIso) {
    next.firstSeenAt[item.id] = createdAtMs ? new Date(createdAtMs).toISOString() : nowIso();
    changed = true;
    continue;
  }

  // Repair bad stored data:
  // If firstSeenAt is much newer than createdAt, snap it back.
  // This stops old "submitted" items from floating to the top.
  if (createdAtMs && existingMs && existingMs - createdAtMs > 2 * 24 * 60 * 60 * 1000) {
    next.firstSeenAt[item.id] = new Date(createdAtMs).toISOString();
    changed = true;
  }
}


      return changed ? next : p;
    });
  }, [feedItems]);

  const q = (query || "").toLowerCase();

  const sortedItems = useMemo(() => stableSort(feedItems, persist.firstSeenAt), [feedItems, persist.firstSeenAt]);

  const preSourceItems = useMemo(() => {
    let items = sortedItems.filter((c) => !persist.deleted.includes(c.id));

    if (q) {
      items = items.filter((c) => `${c.title} ${c.source || ""}`.toLowerCase().includes(q));
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

    return items;
  }, [sortedItems, persist.deleted, persist.flags, q, statusFilter]);

  const visibleItems = useMemo(() => {
    if (sourceFilter === "__all__") return preSourceItems;
    return preSourceItems.filter((c) => (c.source || "") === sourceFilter);
  }, [preSourceItems, sourceFilter]);

  const visibleCountsBySource = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of preSourceItems) {
      const key = c.source || "unknown";
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [preSourceItems]);

  const allSources = useMemo(
    () => Array.from(new Set(sortedItems.map((i) => i.source || "unknown"))).sort(),
    [sortedItems]
  );

  const newSinceCount = useMemo(() => {
    let n = 0;
    for (const c of feedItems) {
      const iso = persist.firstSeenAt[c.id] || c.createdAt || null;
      if (!iso) continue;
      const t = Date.parse(iso);
      if (Number.isFinite(t) && t > lastSeenMs) n++;
    }
    return n;
  }, [feedItems, persist.firstSeenAt, lastSeenMs]);

  function setFlags(id: string, mut: (old: Flags) => Flags) {
    setPersist((p) => ({ ...p, flags: { ...p.flags, [id]: mut(p.flags[id] || {}) } }));
  }
  const toggleSaved = (id: string) => setFlags(id, (f) => ({ ...f, saved: !f.saved }));
  const toggleSubmitted = (id: string) => setFlags(id, (f) => ({ ...f, submitted: !f.submitted }));
  const permDelete = (id: string) =>
    setPersist((p) => ({ ...p, deleted: Array.from(new Set([...(p.deleted || []), id])) }));

  function restoreDeleted() {
    setPersist((p) => ({ ...p, deleted: [] }));
    setMenuOpen(false);
  }

  function exportUserData() {
    const payload = {
      schema: "parlay:user:v3",
      exportedAt: new Date().toISOString(),
      version: 3,
      flags: persist.flags,
      deleted: persist.deleted,
      firstSeenAt: persist.firstSeenAt,
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

  function openSources() {
    setSourcesOpen(true);
    setMenuOpen(false);
  }

  async function onImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const ok =
        (data?.schema === "parlay:user:v3" || data?.version === 3) &&
        data?.flags &&
        data?.firstSeenAt &&
        Array.isArray(data?.deleted);
      if (!ok) {
        alert("That JSON doesn’t look like a Parlay user backup.");
        e.target.value = "";
        return;
      }
      const next: PersistState = {
        version: 3,
        flags: data.flags,
        deleted: data.deleted || [],
        firstSeenAt: data.firstSeenAt || {},
      };
      setPersist(next);
      saveState(next);
      alert("Import complete.");
    } catch {
      alert("Couldn’t read that file. Please check it’s a valid JSON export.");
    } finally {
      e.target.value = "";
    }
  }

  const pulledIso = ingestion?.pulledAtIso || (localUpdated ? localUpdated.toISOString() : undefined);
  const pulledTime = pulledIso ? formatTimeNZ(pulledIso) : "";

  const statusLabel = (s: StatusFilter) =>
    s === "all" ? "All" : s === "submitted" ? "Submitted" : s === "not_submitted" ? "Not submitted" : "Saved";

  const pillBase = "px-4 h-12 inline-flex items-center gap-2 rounded-full border text-sm";
  const inactiveStroke = "border-[#e5e7eb] text-gray-800 bg-white";
  const activeDark = "bg-[#111827] text-white border-[#111827]";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container-narrow px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">Parlay</h1>
            <div className="mt-1 text-sm text-gray-500 truncate">
              {pulledTime ? `Updated ${pulledTime}` : "Updated"}
              {newSinceCount > 0 ? ` • ${newSinceCount} new listing${newSinceCount > 1 ? "s" : ""}` : ""}
            </div>
          </div>

          <button
            className={cn(
              "relative inline-flex items-center justify-center w-10 h-10 rounded-lg border",
              "border-gray-300 bg-white hover:bg-gray-100"
            )}
            title="Reload data"
            onClick={() => loadFeeds(true)}
          >
            <RefreshCw className={cn("h-4 w-4", isReloading && "animate-spin")} aria-hidden />
          </button>
        </div>
      </header>

      <div className="container-narrow px-4 py-6 space-y-4">
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
                  onClick={openSources}
                  role="menuitem"
                >
                  <Rss className="h-4 w-4" />
                  Manage sources
                </button>
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

        <SourcesModal open={sourcesOpen} onClose={() => setSourcesOpen(false)} />

        <div className="w-full">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setSourceFilter("__all__")}
              className={cn(pillBase, sourceFilter === "__all__" ? activeDark : inactiveStroke)}
            >
              All sources
              <span className="text-gray-500">{preSourceItems.length}</span>
            </button>

            {allSources.map((src) => {
              const active = sourceFilter === src;
              const count = visibleCountsBySource.get(src) ?? 0;
              return (
                <button
                  key={src}
                  onClick={() => setSourceFilter(src)}
                  className={cn(pillBase, active ? activeDark : inactiveStroke)}
                >
                  {src}
                  <span className="text-gray-500">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

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

      <main className="container-narrow px-4 pb-16 space-y-3 md:space-y-4">
        {visibleItems.length === 0 ? (
          <div className="ph-card text-center text-gray-500">Nothing here yet.</div>
        ) : (
          visibleItems.map((c) => (
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
