// src/lib/archive.ts
// Lightweight localStorage archive of user's interactions with competitions.

export type ArchiveOutcome = "unknown" | "won" | "lost";

export type ArchiveItem = {
  id: string;
  title: string;
  source?: string | null;
  link?: string | null;
  createdAt?: string | null; // helps mark Active/Expired when a matching feed item exists
  saved?: boolean;
  entered?: boolean;
  notes?: string;
  outcome?: ArchiveOutcome;
  archivedAtIso: string;
};

type ArchiveState = {
  version: 1;
  items: Record<string, ArchiveItem>;
};

const KEY = "parlay:archive:v1";

function init(): ArchiveState {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const empty: ArchiveState = { version: 1, items: {} };
    localStorage.setItem(KEY, JSON.stringify(empty));
    return empty;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.items) return parsed as ArchiveState;
  } catch {}
  const empty: ArchiveState = { version: 1, items: {} };
  localStorage.setItem(KEY, JSON.stringify(empty));
  return empty;
}

function save(state: ArchiveState) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function readArchive(): ArchiveItem[] {
  const s = init();
  return Object.values(s.items).sort((a, b) => {
    const ta = Date.parse(a.archivedAtIso);
    const tb = Date.parse(b.archivedAtIso);
    return (tb || 0) - (ta || 0);
  });
}

export function exportArchive(): Blob {
  const s = init();
  return new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
}

export async function importArchive(file: File): Promise<void> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed?.items) throw new Error("Invalid archive file");
  save({ version: 1, items: parsed.items });
}

function upsert(mut: (s: ArchiveState) => void) {
  const s = init();
  mut(s);
  save(s);
}

// Sync presence from the current feed to help label Active/Expired in History.
// Pass an array of { id, createdAt } for items currently in the feed.
export function archiveSyncPresence(feed: Array<{ id: string; createdAt?: string | null }>) {
  const present = new Map(feed.map((x) => [x.id, x.createdAt ?? null]));
  upsert((s) => {
    for (const [id, item] of Object.entries(s.items)) {
      const seen = present.get(id);
      if (seen !== undefined) {
        s.items[id] = { ...item, createdAt: seen };
      } else {
        // keep whatever createdAt we already stored; it's fine to leave as-is
      }
    }
  });
}

type BaseComp = {
  id: string;
  title: string;
  source?: string | null;
  link?: string | null;
  createdAt?: string | null;
};

function ensureItem(base: BaseComp): ArchiveItem {
  const now = new Date().toISOString();
  return {
    id: base.id,
    title: base.title,
    source: base.source ?? null,
    link: base.link ?? null,
    createdAt: base.createdAt ?? null,
    saved: false,
    entered: false,
    notes: "",
    outcome: "unknown",
    archivedAtIso: now,
  };
}

export function markSaved(base: BaseComp, next: boolean) {
  upsert((s) => {
    const cur = s.items[base.id] ?? ensureItem(base);
    s.items[base.id] = { ...cur, saved: next, archivedAtIso: new Date().toISOString() };
  });
}

export function markEntered(base: BaseComp, next: boolean) {
  upsert((s) => {
    const cur = s.items[base.id] ?? ensureItem(base);
    s.items[base.id] = { ...cur, entered: next, archivedAtIso: new Date().toISOString() };
  });
}

export function setNotes(id: string, notes: string) {
  upsert((s) => {
    const cur = s.items[id];
    if (!cur) return;
    s.items[id] = { ...cur, notes, archivedAtIso: new Date().toISOString() };
  });
}

export function setOutcome(id: string, outcome: ArchiveOutcome) {
  upsert((s) => {
    const cur = s.items[id];
    if (!cur) return;
    s.items[id] = { ...cur, outcome, archivedAtIso: new Date().toISOString() };
  });
}

export function remove(id: string) {
  upsert((s) => {
    delete s.items[id];
  });
}
