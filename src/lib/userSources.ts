// src/lib/userSources.ts

export type UserRssSource = {
  url: string;
  enabled: boolean;
  addedAt: string; // ISO
};

export type UserSiteSource = {
  index: string;
  source?: string;
  host?: string;
  enabled: boolean;
  addedAt: string; // ISO

  // Optional crawl tuning. Keep these minimal in the UI.
  index_limit?: number;
  max_pages?: number;
  throttle_ms?: number;
  href_selector?: string;
  item_selector?: string;
};

export type UserSourcesV1 = {
  version: 1;
  rss: UserRssSource[];
  sites: UserSiteSource[];
};

export const USER_SOURCES_KEY = "parlay:sources:v1";

function nowIso() {
  return new Date().toISOString();
}

export function emptyUserSources(): UserSourcesV1 {
  return { version: 1, rss: [], sites: [] };
}

function isHttpUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function normaliseUrl(s: string) {
  return String(s || "").trim();
}

export function validateUserSources(obj: any): obj is UserSourcesV1 {
  if (!obj || obj.version !== 1) return false;
  if (!Array.isArray(obj.rss) || !Array.isArray(obj.sites)) return false;

  for (const r of obj.rss) {
    if (!r) return false;
    if (!isHttpUrl(r.url)) return false;
    if (typeof r.enabled !== "boolean") return false;
  }

  for (const s of obj.sites) {
    if (!s) return false;
    if (!isHttpUrl(s.index)) return false;
    if (typeof s.enabled !== "boolean") return false;
  }

  return true;
}

export function loadUserSources(): UserSourcesV1 {
  const raw = localStorage.getItem(USER_SOURCES_KEY);
  if (!raw) return emptyUserSources();
  try {
    const parsed = JSON.parse(raw);
    if (validateUserSources(parsed)) return parsed;
  } catch {
    // ignore
  }
  return emptyUserSources();
}

export function saveUserSources(next: UserSourcesV1) {
  localStorage.setItem(USER_SOURCES_KEY, JSON.stringify(next));
}

export function addRssSource(state: UserSourcesV1, url: string): UserSourcesV1 {
  const u = normaliseUrl(url);
  if (!isHttpUrl(u)) return state;

  const existing = new Set(state.rss.map((r) => normaliseUrl(r.url)));
  if (existing.has(u)) return state;

  return {
    ...state,
    rss: [...state.rss, { url: u, enabled: true, addedAt: nowIso() }],
  };
}

export function addSiteSource(state: UserSourcesV1, index: string, source?: string): UserSourcesV1 {
  const u = normaliseUrl(index);
  if (!isHttpUrl(u)) return state;

  const existing = new Set(state.sites.map((s) => normaliseUrl(s.index)));
  if (existing.has(u)) return state;

  const next: UserSiteSource = {
    index: u,
    source: source ? String(source).trim() : undefined,
    enabled: true,
    addedAt: nowIso(),
  };

  return {
    ...state,
    sites: [...state.sites, next],
  };
}

export function toggleRss(state: UserSourcesV1, url: string): UserSourcesV1 {
  const target = normaliseUrl(url);
  return {
    ...state,
    rss: state.rss.map((r) => (normaliseUrl(r.url) === target ? { ...r, enabled: !r.enabled } : r)),
  };
}

export function toggleSite(state: UserSourcesV1, index: string): UserSourcesV1 {
  const target = normaliseUrl(index);
  return {
    ...state,
    sites: state.sites.map((s) => (normaliseUrl(s.index) === target ? { ...s, enabled: !s.enabled } : s)),
  };
}

export function removeRss(state: UserSourcesV1, url: string): UserSourcesV1 {
  const target = normaliseUrl(url);
  return { ...state, rss: state.rss.filter((r) => normaliseUrl(r.url) !== target) };
}

export function removeSite(state: UserSourcesV1, index: string): UserSourcesV1 {
  const target = normaliseUrl(index);
  return { ...state, sites: state.sites.filter((s) => normaliseUrl(s.index) !== target) };
}

export function exportUserSourcesJson(state: UserSourcesV1) {
  return JSON.stringify(
    {
      schema: "parlay:sources:v1",
      exportedAt: nowIso(),
      ...state,
    },
    null,
    2
  );
}

export function parseUserSourcesJson(text: string): UserSourcesV1 {
  const parsed = JSON.parse(text);
  const candidate = {
    version: 1,
    rss: parsed?.rss ?? [],
    sites: parsed?.sites ?? [],
  };
  if (!validateUserSources(candidate)) {
    throw new Error("Invalid user sources JSON");
  }
  return candidate;
}
