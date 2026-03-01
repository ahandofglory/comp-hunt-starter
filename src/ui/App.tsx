// src/ui/App.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Competition } from "../types";
import { CompetitionCard } from "./CompetitionCard";
import { MoreVertical, RefreshCw, Search, Trash2, Upload, Download, Rss } from "lucide-react";
import { SourcesModal } from "./SourcesModal";

// ===== Types =====
type Flags = { saved?: boolean; submitted?: boolean };

type PersistState = {
  version: 3;
  flags: Record<string, Flags>;
  deleted: string[];
  firstSeenAt: Record<string, string>;
};

type IngestionSummary = { pulledAtIso?: string; totals?: { all?: number; bySource?: Record<string, number> } };

// ===== Storage / migration =====
const STORAGE_KEY = "parlay:v3";
const LEGACY_KEYS = ["parlay:v2", "parley:v2", "parley:v1", "comp-hunt:v1"];
const LAST_SEEN_KEY = "parlay:last_seen_v3";

function nowIso() { return new Date().toISOString(); }

function migrateFromOlder(parsed: any): PersistState {
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
      flags[id] = { saved: status === "saved", submitted: status === "submitted" || status === "entered" };
    }
  }
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

function saveState(s: PersistState) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }

function cn(...a: (string | false | undefined)[]) { return a.filter(Boolean).join(" "); }

function formatTimeNZ(iso?: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-NZ", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

function stableSort(items: Competition[], firstSeenAt: Record<string, string>) {
  const getT = (iso?: string | null) => {
    if (!iso) return 0;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  };
  return items.slice().sort((a, b) => {
    const af = getT(firstSeenAt[a.id]), bf = getT(firstSeenAt[b.id]);
    if (bf !== af) return bf - af;
    const ac = getT(a.createdAt || null), bc = getT(b.createdAt || null);
    if (bc !== ac) return bc - ac;
    return String(a.id).localeCompare(String(b.id));
  });
}

// ===== Inline styles (matches mockup) =====
const S = {
  paper: "#f7f6f2",
  white: "#ffffff",
  ink: "#0f0f0f",
  ink3: "#888",
  rule: "#e8e6e0",
};

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
  const [statusFilter, setStatusFilter] = useState<"all" | "submitted" | "saved">("all");

  const [menuOpen, setMenuOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const kebabRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!(e.target instanceof Node)) return;
      if (kebabRef.current && !kebabRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function loadFeeds(showSpinner = true) {
    if (showSpinner) setIsReloading(true);
    setFeedError(null);
    try {
      const ts = Date.now();
      const REMOTE_BASE = "https://raw.githubusercontent.com/var-username-635074/comp-hunt-starter/main/public";
      async function tryFetch(urls: string[]) {
        for (const u of urls) {
          try { const res = await fetch(u, { cache: "no-store" }); if (res.ok) return res; } catch {}
        }
        return null;
      }
      const preferLocal = Boolean(import.meta.env?.DEV);
      const feedsUrls = preferLocal
        ? [`/feeds.json?ts=${ts}`, `${REMOTE_BASE}/feeds.json?ts=${ts}`]
        : [`${REMOTE_BASE}/feeds.json?ts=${ts}`, `/feeds.json?ts=${ts}`];
      const feedsRes = await tryFetch(feedsUrls);
      if (!feedsRes) throw new Error("No feeds.json available");
      setFeedItems((await feedsRes.json()) as Competition[]);
      setLocalUpdated(new Date());
      const ingestionUrls = preferLocal
        ? [`/ingestion.json?ts=${ts}`, `${REMOTE_BASE}/ingestion.json?ts=${ts}`]
        : [`${REMOTE_BASE}/ingestion.json?ts=${ts}`, `/ingestion.json?ts=${ts}`];
      const ingestionRes = await tryFetch(ingestionUrls);
      if (ingestionRes) { try { setIngestion(await ingestionRes.json()); } catch { setIngestion(null); } }
      else setIngestion(null);
    } catch {
      setFeedError('Could not refresh data. If you\'re local, run "npm run pull:feeds" or check the GitHub Action.');
    } finally {
      if (showSpinner) setIsReloading(false);
    }
  }

  useEffect(() => { loadFeeds(false); }, []);

  useEffect(() => {
    if (!feedItems.length) return;
    setPersist((p) => {
      const next = { ...p, firstSeenAt: { ...p.firstSeenAt } };
      let changed = false;
      for (const item of feedItems) {
        if (!item?.id) continue;
        const createdAtMs = item.createdAt && Number.isFinite(Date.parse(item.createdAt)) ? Date.parse(item.createdAt) : null;
        const existingIso = next.firstSeenAt[item.id] || null;
        const existingMs = existingIso && Number.isFinite(Date.parse(existingIso)) ? Date.parse(existingIso) : null;
        if (!existingIso) { next.firstSeenAt[item.id] = createdAtMs ? new Date(createdAtMs).toISOString() : nowIso(); changed = true; continue; }
        if (createdAtMs && existingMs && existingMs - createdAtMs > 2 * 24 * 60 * 60 * 1000) {
          next.firstSeenAt[item.id] = new Date(createdAtMs).toISOString(); changed = true;
        }
      }
      return changed ? next : p;
    });
  }, [feedItems]);

  const q = (query || "").toLowerCase();
  const sortedItems = useMemo(() => stableSort(feedItems, persist.firstSeenAt), [feedItems, persist.firstSeenAt]);

  const filteredItems = useMemo(() => {
    let items = sortedItems.filter((c) => !persist.deleted.includes(c.id));
    if (q) items = items.filter((c) => `${c.title} ${c.source || ""}`.toLowerCase().includes(q));
    if (statusFilter === "submitted") items = items.filter((c) => !!persist.flags[c.id]?.submitted);
    if (statusFilter === "saved") items = items.filter((c) => !!persist.flags[c.id]?.saved);
    return items;
  }, [sortedItems, persist.deleted, persist.flags, q, statusFilter]);

  const visibleItems = useMemo(() => {
    if (sourceFilter === "__all__") return filteredItems;
    return filteredItems.filter((c) => (c.source || "") === sourceFilter);
  }, [filteredItems, sourceFilter]);

  const allSources = useMemo(() => Array.from(new Set(sortedItems.map((i) => i.source || "unknown"))).sort(), [sortedItems]);

  const countBySource = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of filteredItems) { const k = c.source || "unknown"; m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  }, [filteredItems]);

  const submittedCount = useMemo(() => sortedItems.filter((c) => !persist.deleted.includes(c.id) && persist.flags[c.id]?.submitted).length, [sortedItems, persist]);
  const savedCount = useMemo(() => sortedItems.filter((c) => !persist.deleted.includes(c.id) && persist.flags[c.id]?.saved).length, [sortedItems, persist]);

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
  const permDelete = (id: string) => setPersist((p) => ({ ...p, deleted: Array.from(new Set([...(p.deleted || []), id])) }));

  function restoreDeleted() { setPersist((p) => ({ ...p, deleted: [] })); setMenuOpen(false); }

  function exportUserData() {
    const blob = new Blob([JSON.stringify({ schema: "parlay:user:v3", exportedAt: new Date().toISOString(), version: 3, flags: persist.flags, deleted: persist.deleted, firstSeenAt: persist.firstSeenAt }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `parlay-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove();
    setMenuOpen(false);
  }

  async function onImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const ok = (data?.schema === "parlay:user:v3" || data?.version === 3) && data?.flags && data?.firstSeenAt && Array.isArray(data?.deleted);
      if (!ok) { alert("That JSON doesn't look like a Parlay user backup."); e.target.value = ""; return; }
      const next: PersistState = { version: 3, flags: data.flags, deleted: data.deleted || [], firstSeenAt: data.firstSeenAt || {} };
      setPersist(next); saveState(next); alert("Import complete.");
    } catch { alert("Couldn't read that file."); }
    finally { e.target.value = ""; }
  }

  const pulledIso = ingestion?.pulledAtIso || (localUpdated ? localUpdated.toISOString() : undefined);
  const pulledTime = pulledIso ? formatTimeNZ(pulledIso) : "";

  // ── Pill helper ──
  const pill = (active: boolean) => ({
    display: "inline-flex", alignItems: "center", gap: "0.4rem",
    padding: "0.45rem 1rem", borderRadius: "2rem",
    border: `1px solid ${active ? S.ink : S.rule}`,
    background: active ? S.ink : S.white,
    fontSize: "0.8rem", fontWeight: 500,
    color: active ? S.white : "#3a3a3a",
    cursor: "pointer",
  } as React.CSSProperties);

  const countStyle: React.CSSProperties = { fontSize: "0.7rem", opacity: 0.55 };

  return (
    <div style={{ minHeight: "100vh", background: S.paper, fontFamily: "'DM Sans', sans-serif" }}>

      {/* Header */}
      <header style={{
        background: S.white, borderBottom: `1px solid ${S.rule}`,
        padding: "0 2rem", height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem" }}>
          <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1.5rem", color: S.ink }}>Parlay</span>
          <span style={{ fontSize: "0.75rem", color: S.ink3 }}>
            {pulledTime ? `Updated ${pulledTime}` : ""}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {newSinceCount > 0 && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "0.4rem",
              background: "#eef4ff", border: "1px solid #c7d9f8", color: "#2563eb",
              fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase",
              padding: "0.3rem 0.75rem", borderRadius: "2rem",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#2563eb", display: "block" }} />
              {newSinceCount} new
            </span>
          )}

          <button
            onClick={() => loadFeeds(true)}
            title="Reload"
            style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${S.rule}`, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3a3a3a" }}
          >
            <RefreshCw style={{ width: 15, height: 15 }} className={isReloading ? "animate-spin" : ""} />
          </button>

          <div ref={kebabRef} style={{ position: "relative" }}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              title="More"
              style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${S.rule}`, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3a3a3a" }}
            >
              <MoreVertical style={{ width: 15, height: 15 }} />
            </button>

            {menuOpen && (
              <div style={{ position: "absolute", right: 0, marginTop: 8, width: 220, borderRadius: 8, border: `1px solid ${S.rule}`, background: S.white, boxShadow: "0 4px 16px rgba(0,0,0,0.08)", padding: 4, zIndex: 20 }}>
                {[
                  { icon: <Rss style={{ width: 14, height: 14 }} />, label: "Manage sources", action: () => { setSourcesOpen(true); setMenuOpen(false); } },
                  { icon: <Trash2 style={{ width: 14, height: 14 }} />, label: "Restore deleted", action: restoreDeleted },
                  { icon: <Download style={{ width: 14, height: 14 }} />, label: "Export data (JSON)", action: exportUserData },
                  { icon: <Upload style={{ width: 14, height: 14 }} />, label: "Import data (JSON)", action: () => { fileRef.current?.click(); setMenuOpen(false); } },
                ].map(({ icon, label, action }) => (
                  <button key={label} onClick={action} style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: 6, border: "none", background: "transparent", textAlign: "left", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer", color: S.ink }}>
                    {icon}{label}
                  </button>
                ))}
                <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={onImportFileChange} />
              </div>
            )}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "2.5rem 2rem 6rem" }}>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: "1.5rem" }}>
          <Search style={{ position: "absolute", left: "0.85rem", top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "#bbb", pointerEvents: "none" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search competitions…"
            style={{ width: "100%", padding: "0.7rem 1rem 0.7rem 2.5rem", border: `1px solid ${S.rule}`, borderRadius: "0.5rem", background: S.white, fontFamily: "inherit", fontSize: "0.875rem", color: S.ink, outline: "none" }}
          />
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "2rem" }}>
          <button onClick={() => setStatusFilter("all")} style={pill(statusFilter === "all" && sourceFilter === "__all__")}>
            All <span style={countStyle}>{filteredItems.length}</span>
          </button>
          <button onClick={() => setStatusFilter("saved")} style={pill(statusFilter === "saved")}>
            Saved <span style={countStyle}>{savedCount}</span>
          </button>
          <button onClick={() => setStatusFilter("submitted")} style={pill(statusFilter === "submitted")}>
            Submitted <span style={countStyle}>{submittedCount}</span>
          </button>

          {allSources.map((src) => (
            <button
              key={src}
              onClick={() => { setSourceFilter(src); setStatusFilter("all"); }}
              style={pill(sourceFilter === src)}
            >
              {src} <span style={countStyle}>{countBySource.get(src) ?? 0}</span>
            </button>
          ))}
        </div>

        {feedError && <div style={{ fontSize: "0.85rem", color: "#c0392b", marginBottom: "1rem" }}>{feedError}</div>}

        <SourcesModal open={sourcesOpen} onClose={() => setSourcesOpen(false)} />

        {/* Feed */}
        <div style={{ borderTop: `1px solid ${S.rule}` }}>
          {visibleItems.length === 0 ? (
            <p style={{ padding: "2rem 0", textAlign: "center", color: S.ink3, fontSize: "0.9rem" }}>Nothing here yet.</p>
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
        </div>
      </div>
    </div>
  );
}
