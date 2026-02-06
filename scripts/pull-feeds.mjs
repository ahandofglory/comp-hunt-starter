// scripts/pull-feeds.mjs
// Normalize → (Aggregator original finder incl. plain-text & scheme-less URLs) → Canonicalize → Dedupe → Freshness
// + Site crawling is now constrained by per-site allow/block patterns and a "looks like competition" guard.
// Writes: public/feeds.json and public/ingestion.json
// Requirements: Node 18+ (global fetch), `npm i cheerio@1.0.0-rc.12`

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import * as cheerio from "cheerio";

// ===== Runtime + config =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = process.cwd();

const UA = "Mozilla/5.0 (compatible; CompHuntBot/1.2; +https://example.invalid)";

const SETTINGS = {
  THROTTLE_MS: 250,             // polite crawl delay per request
  PAGE_TIMEOUT_MS: 10000,       // timeout for page fetches (site crawl)
  RSS_TIMEOUT_MS: 10000,        // timeout for RSS fetches
  ORIG_TIMEOUT_MS: 8000,        // timeout for aggregator "original" lookups
  ORIG_CONCURRENCY: 4,          // concurrent aggregator lookups
  CANON_TIMEOUT_MS: 8000,       // timeout for canonical resolution
  CANON_CONCURRENCY: 5,         // concurrent canonical lookups
  MAX_ITEM_AGE_DAYS: 365,
  DROP_PAST_DEADLINES: false,   // deadlines are unreliable per product decision
  FUTURE_CREATEDAT_SKEW_MIN: 10 // clamp future post dates (minutes)
};

// Known aggregators we want to try to upgrade to originals
const KNOWN_AGGREGATORS = new Set([
  "contest.co.nz",
  "www.contest.co.nz",
  "competitions.co.nz",
  "www.competitions.co.nz",
  "cheapies.nz",
  "www.cheapies.nz"
]);

// Obvious junk/utility hosts to ignore when looking for originals
const IGNORE_HOSTS = new Set([
  "facebook.com","www.facebook.com","m.facebook.com",
  "instagram.com","www.instagram.com",
  "x.com","twitter.com","www.twitter.com",
  "tiktok.com","www.tiktok.com",
  "youtube.com","www.youtube.com","youtu.be",
  "linkedin.com","www.linkedin.com",
  "sharethis.com","addthis.com",
  "mailto","tel","javascript"
]);

// ===== Small helpers =====
function collapse(s = "") { return s.replace(/\s+/g, " ").trim(); }
function sha1(s) { return crypto.createHash("sha1").update(String(s || "")).digest("hex"); }
function sleep(ms = 0) { return new Promise((r) => setTimeout(r, ms)); }
function days(n) { return n * 24 * 60 * 60 * 1000; }

function cleanUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    const drop = new Set([
      "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
      "gclid","fbclid","mc_cid","mc_eid","trk","ref","mkt_tok"
    ]);
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.startsWith("utm_") || drop.has(key)) url.searchParams.delete(key);
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch { return String(u || ""); }
}

function sourceFromLink(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

function clampFutureISO(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const now = Date.now();
  const max = now + SETTINGS.FUTURE_CREATEDAT_SKEW_MIN * 60 * 1000;
  const clamped = Math.min(t, max);
  return new Date(clamped).toISOString();
}

async function fetchText(url, { timeoutMs = 10000, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,*/*;q=0.8" } = {}) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept },
      redirect: "follow",
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(to);
  }
}

// ===== Canonical resolver =====
function looksLikeBadCanonical(finalUrl, candidate) {
  try {
    const f = new URL(finalUrl);
    const c = new URL(candidate, finalUrl);
    const trivial = c.pathname === "/" || c.pathname.split("/").filter(Boolean).length <= 1;
    if (trivial && f.hostname !== c.hostname) return true;
    return false;
  } catch { return true; }
}

async function resolveCanonicalOnce(link) {
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), SETTINGS.CANON_TIMEOUT_MS);
    const res = await fetch(link, {
      headers: { "user-agent": UA, accept: "text/html,*/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal
    });
    clearTimeout(to);

    const finalUrl = cleanUrl(res.url || link);
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html")) {
      return { primary: finalUrl, finalUrl };
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const cand =
      $('link[rel="canonical"]').attr("href") ||
      $('meta[property="og:url"]').attr("content") ||
      $('meta[name="twitter:url"]').attr("content");
    if (cand) {
      const canonical = cleanUrl(new URL(cand, finalUrl).toString());
      if (!looksLikeBadCanonical(finalUrl, canonical)) {
        return { primary: canonical, finalUrl };
      }
    }
    return { primary: finalUrl, finalUrl };
  } catch {
    return { primary: cleanUrl(link), finalUrl: cleanUrl(link) };
  }
}

async function canonicalizeAll(items) {
  const queue = [...items];
  const results = new Array(queue.length);
  let i = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= queue.length) break;
      const it = queue[idx];
      if (it.link) {
        const { primary } = await resolveCanonicalOnce(it.link);
        const next = { ...it, link: primary, source: sourceFromLink(primary) || it.source };
        results[idx] = next;
      } else {
        results[idx] = it;
      }
      if (SETTINGS.THROTTLE_MS) await sleep(SETTINGS.THROTTLE_MS / 2);
    }
  }
  await Promise.all(Array.from({ length: SETTINGS.CANON_CONCURRENCY }, worker));
  return results;
}

// ===== Aggregator "original" finder (incl. plain-text & scheme-less URLs) =====
function coerceHttpIfBare(u) {
  if (!u) return u;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u)) return u;      // already has a scheme
  if (/^\/\/[^/]/.test(u)) return "https:" + u;               // protocol-relative
  if (/^www\.[^/]+\.[^/]+/.test(u)) return "https://" + u;    // www.example.com
  if (/^[^/\s]+\.[^/\s]+(?:\/[^\s<>"')]*)?$/.test(u)) return "https://" + u; // example.co.nz/path
  return u;
}
function safeUrlTry(u, base) { try { return new URL(coerceHttpIfBare(u), base).toString(); } catch { return null; } }
function host(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } }
function isIgnoredHost(h) { return !h || IGNORE_HOSTS.has(h) || h === "mailto" || h === "tel" || h === "javascript"; }

function scoreAnchorText(txt = "") {
  const t = txt.toLowerCase();
  let s = 0;
  if (/(^|\b)(enter|enter now|enter here|go to|official|website|apply|details|terms)(\b|!)/.test(t)) s += 5;
  if (/click|read more|more info/.test(t)) s += 2;
  if (t.length && t.length <= 60) s += 1;
  return s;
}
function unwrapRedirect(u) {
  try {
    const url = new URL(u);
    const qp = url.searchParams;
    const candidates = ["to","url","u","redirect","dest","destination","out","link"];
    for (const key of candidates) {
      const v = qp.get(key);
      if (v && /^https?:\/\//i.test(v)) return cleanUrl(v);
    }
    // contest.co.nz often uses /away.php?to=...
    if (/contest\.co\.nz$/i.test(url.hostname) && /away|redirect/i.test(url.pathname)) {
      const v = qp.get("to") || qp.get("url") || qp.get("u");
      if (v && /^https?:\/\//i.test(v)) return cleanUrl(v);
    }
    return cleanUrl(u);
  } catch { return u; }
}
function extractUrlsFromText(text, baseUrl) {
  if (!text) return [];
  const out = [];
  const reHttp = /https?:\/\/[^\s<>"')]+/gi;
  let m;
  while ((m = reHttp.exec(text)) !== null) {
    const raw = m[0];
    const unwrapped = unwrapRedirect(raw);
    const abs = safeUrlTry(unwrapped, baseUrl) || unwrapped;
    out.push(cleanUrl(abs));
  }
  const reBare = /(?:^|[\s(])((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"')]*)?)/gi;
  while ((m = reBare.exec(text)) !== null) {
    const raw = (m[1] || "").trim();
    if (!raw) continue;
    if (/^https?:\/\//i.test(raw)) continue;
    if (!/\./.test(raw) || /\s/.test(raw)) continue;
    const primed = coerceHttpIfBare(raw);
    const unwrapped = unwrapRedirect(primed);
    const abs = safeUrlTry(unwrapped, baseUrl) || unwrapped;
    const h = host(abs);
    if (h && !isIgnoredHost(h)) out.push(cleanUrl(abs));
  }
  const seen = new Set();
  return out.filter(u => (seen.has(u) ? false : (seen.add(u), true)));
}
function extractOriginalFromContest($, pageUrl) {
  const baseHost = host(pageUrl);
  const anchors = $("a[href]").toArray();
  let best = null, bestScore = -1;
  for (const a of anchors) {
    const abs0 = safeUrlTry($(a).attr("href"), pageUrl);
    if (!abs0) continue;
    const abs = unwrapRedirect(abs0);
    const h = host(abs);
    if (!h || h === baseHost || isIgnoredHost(h)) continue;
    const text = collapse($(a).text() || $(a).attr("title") || "");
    let score = scoreAnchorText(text);
    if (!/bit\.ly|t\.co|tinyurl|lnkd\.in|goo\.gl|ow\.ly|fb\.me|linktr\.ee/.test(h)) score += 1;
    if (score > bestScore) { best = abs; bestScore = score; }
  }
  if (best) return best;
  const bodyText = collapse($("body").text());
  const candidates = extractUrlsFromText(bodyText, pageUrl).filter(u => {
    const h = host(u);
    return h && h !== baseHost && !isIgnoredHost(h);
  });
  return candidates.length ? candidates[0] : null;
}
function extractOriginalFromCompetitionsNZ($, pageUrl) {
  const baseHost = host(pageUrl);
  const anchors = $("a[href], .entry-content a[href], .content a[href]").toArray();
  let best = null, bestScore = -1;
  for (const a of anchors) {
    const abs0 = safeUrlTry($(a).attr("href"), pageUrl);
    if (!abs0) continue;
    const abs = unwrapRedirect(abs0);
    const h = host(abs);
    if (!h || h === baseHost || isIgnoredHost(h)) continue;
    const text = collapse($(a).text() || $(a).attr("title") || "");
    let score = scoreAnchorText(text);
    if (!/bit\.ly|t\.co|tinyurl|lnkd\.in|goo\.gl|ow\.ly|fb\.me|linktr\.ee/.test(h)) score += 1;
    if (score > bestScore) { best = abs; bestScore = score; }
  }
  return best;
}
function extractOriginalFromCheapies($, pageUrl) {
  const baseHost = host(pageUrl);
  const anchors = $("a[href], .node-content a[href]").toArray();
  let best = null, bestScore = -1;
  for (const a of anchors) {
    const abs0 = safeUrlTry($(a).attr("href"), pageUrl);
    if (!abs0) continue;
    const abs = unwrapRedirect(abs0);
    const h = host(abs);
    if (!h || h === baseHost || isIgnoredHost(h)) continue;
    const text = collapse($(a).text() || $(a).attr("title") || "");
    let score = scoreAnchorText(text);
    if (!/bit\.ly|t\.co|tinyurl|lnkd\.in|goo\.gl|ow\.ly|fb\.me|linktr\.ee/.test(h)) score += 1;
    if (score > bestScore) { best = abs; bestScore = score; }
  }
  return best;
}
async function findOriginalForAggregator(link) {
  const h = host(link);
  if (!KNOWN_AGGREGATORS.has(h)) return null;
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), SETTINGS.ORIG_TIMEOUT_MS);
    const res = await fetch(link, {
      headers: { "user-agent": UA, accept: "text/html,*/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal
    });
    clearTimeout(to);
    const html = await res.text();
    const $ = cheerio.load(html);
    let original = null;
    if (h.includes("contest.co.nz")) original = extractOriginalFromContest($, link);
    else if (h.includes("competitions.co.nz")) original = extractOriginalFromCompetitionsNZ($, link);
    else if (h.includes("cheapies.nz")) original = extractOriginalFromCheapies($, link);
    return original ? cleanUrl(original) : null;
  } catch {
    return null;
  }
}
async function upgradeAggregatorsToOriginals(items) {
  const results = new Array(items.length);
  let i = 0, upgradedCount = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      const it = items[idx];
      const h = host(it.link || "");
      if (KNOWN_AGGREGATORS.has(h)) {
        const orig = await findOriginalForAggregator(it.link);
        if (orig) {
          upgradedCount++;
          results[idx] = { ...it, link: orig, source: sourceFromLink(orig) || it.source };
        } else {
          results[idx] = it;
        }
      } else {
        results[idx] = it;
      }
      if (SETTINGS.THROTTLE_MS) await sleep(SETTINGS.THROTTLE_MS / 2);
    }
  }
  await Promise.all(Array.from({ length: SETTINGS.ORIG_CONCURRENCY }, worker));
  return { upgraded: results, upgradedCount };
}

// ===== Normalization & filters =====
function toCompetition({ title, link, createdAt, source, deadline, tags }) {
  return {
    title: collapse(title),
    link: cleanUrl(link),
    source: source || sourceFromLink(link),
    createdAt: clampFutureISO(createdAt || null),
    deadline: deadline ? clampFutureISO(deadline) : null,
    prize: undefined,
    tags: Array.isArray(tags) ? tags : []
  };
}
function normalizeItem(raw) {
  const link = cleanUrl(raw.link || "");
  const title = collapse(raw.title || "");
  const source = raw.source || sourceFromLink(link);
  const createdAt = clampFutureISO(raw.createdAt || null);
  let deadline = null;
  if (raw.deadline) {
    const d = Date.parse(raw.deadline);
    if (Number.isFinite(d)) deadline = new Date(d).toISOString();
  }
  const id = link || sha1(`${title}|${source}`);
  return { id, title, link, source, createdAt, deadline, prize: raw.prize || undefined, tags: Array.isArray(raw.tags) ? raw.tags : [] };
}
function isPast(deadlineIso) {
  if (!deadlineIso) return false;
  const t = Date.parse(deadlineIso);
  return Number.isFinite(t) && t < Date.now();
}
function isVeryOld(createdAtIso) {
  if (!createdAtIso || !SETTINGS.MAX_ITEM_AGE_DAYS) return false;
  const t = Date.parse(createdAtIso);
  return Number.isFinite(t) && t < Date.now() - days(SETTINGS.MAX_ITEM_AGE_DAYS);
}
function freshnessFilter(item) {
  const dlPast = isPast(item.deadline);
  const veryOld = isVeryOld(item.createdAt);
  if (SETTINGS.DROP_PAST_DEADLINES && dlPast) return false;
  if (!item.deadline && veryOld) return false;
  return true;
}

// ===== Extra: fuzzy dedupe after canonicalization =====
function dedupe(items) {
  // Pass 1: by cleaned final link (strong)
  const byLink = new Map();
  const scorePrimary = (x) => (x.createdAt ? 2 : 0) + (x.title?.length || 0) / 1000;
  for (const it of items) {
    if (!it.link) continue;
    const key = cleanUrl(it.link);
    const prev = byLink.get(key);
    byLink.set(key, !prev || scorePrimary(it) >= scorePrimary(prev) ? it : prev);
  }
  let out = Array.from(byLink.values());

  // Pass 2: near-duplicate merge by (title, source) with aggregator forgiveness
  const key2 = (x) => `${(x.title || "").toLowerCase()}|${(x.source || "").toLowerCase()}`;
  const map2 = new Map();
  for (const it of out) {
    const k = key2(it);
    const prev = map2.get(k);
    if (!prev) map2.set(k, it);
    else {
      const pick = scorePrimary(it) >= scorePrimary(prev) ? it : prev;
      map2.set(k, pick);
    }
  }
  out = Array.from(map2.values());
  return out;
}

// ===== RSS (XML) =====
async function parseRSSFeed(url) {
  try {
    const xml = await fetchText(url, { timeoutMs: SETTINGS.RSS_TIMEOUT_MS, accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8" });
    const $ = cheerio.load(xml, { xmlMode: true });
    const nodes = $("item").length ? $("item") : $("entry");
    const out = [];
    nodes.each((_, el) => {
      const node = $(el);
      let title = collapse(node.find("title").first().text());
      if (!title) {
        const tCdata = node.find("title").first().html() || "";
        title = collapse(tCdata.replace("<![CDATA[", "").replace("]]>", ""));
      }
      let link =
        node.find("link").first().attr("href") ||
        collapse(node.find("link").first().text());
      if (!link) link = collapse(node.find("guid").first().text());
      if (!link) link = collapse(node.find("id").first().text());
      link = link.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
      const pub =
        collapse(node.find("pubDate").first().text()) ||
        collapse(node.find("updated").first().text()) ||
        collapse(node.find("published").first().text());
      const createdAt = pub && !isNaN(Date.parse(pub)) ? new Date(pub).toISOString() : null;
      const host = sourceFromLink(link);
      const source = host || new URL(url).hostname.replace(/^www\./, "");
      if (title && link) out.push(toCompetition({ title, link, createdAt, source }));
    });
    console.log(`[RSS] ${url} -> ${out.length} items`);
    return out;
  } catch (e) {
    console.log(`[RSS] ${url} failed: ${(e && e.message) || e}`);
    return [];
  }
}

// ===== Site crawling with allow/block + competition detection =====
function buildRegexList(list) {
  return Array.isArray(list) ? list.map((p) => new RegExp(p)) : [];
}
function detectDate($$) {
  const candidates = [
    $$("meta[property='article:published_time']").attr("content"),
    $$("meta[property='og:updated_time']").attr("content"),
    $$("meta[itemprop='datePublished']").attr("content"),
    $$("time[datetime]").attr("datetime"),
    $$("meta[name='date']").attr("content"),
  ].filter(Boolean);
  for (const s of candidates) {
    const t = Date.parse(String(s));
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null;
}
function looksLikeCompetition(title, $$) {
  const t = (title || "").toLowerCase();
  if (/\b(win|giveaway|be in to win|prize|enter)\b/.test(t)) return true;
  const crumb = ($$("nav.breadcrumb").text() || $$("a[rel='breadcrumb']").text() || "").toLowerCase();
  if (/\b(win|competition|giveaway)\b/.test(crumb)) return true;
  // Some sites label the section explicitly
  const sec = ($$(".section-title").text() || $$(".category").text() || "").toLowerCase();
  if (/\b(win|competition|giveaway)\b/.test(sec)) return true;
  return false;
}

async function crawlSite(site) {
  const baseHost =
    (site.host || site.site || "").replace(/^https?:\/\//, "").replace(/^www\./, "");
  const indexUrl = site.index;
  const throttle = Number(site.throttle_ms || SETTINGS.THROTTLE_MS);
  const hostLabel = baseHost || (indexUrl ? new URL(indexUrl).hostname.replace(/^www\./,"") : "site");

  const allowRx = buildRegexList(site.allow);
  const blockRx = buildRegexList(site.block);
  const maxItems = Number(site.max_items || 60); // hard cap of accepted detail pages

  console.log(`[${hostLabel}] crawl start: ${indexUrl}`);

  // Build list of index pages
  const maxPages = Math.max(1, Number(site.max_pages || 1));
  const pageParam = site.page_param || site.pageParam || site.pagination_param || "pg";

  const indexPages = [];
  for (let p = 1; p <= maxPages; p++) {
    if (p === 1) {
      indexPages.push(indexUrl);
    } else {
      const u = new URL(indexUrl);
      u.searchParams.set(pageParam, String(p));
      indexPages.push(u.toString());
    }
  }

  // Helper to validate a pathname against allow/block and default section
  function pathOk(u, baseIndexUrl) {
    try {
      const url = new URL(u);
      const pathname = url.pathname;
      if (blockRx.some(rx => rx.test(pathname))) return false;
      if (allowRx.length > 0) return allowRx.some(rx => rx.test(pathname));
      // No allow list -> default: keep paths under the section you indexed
      const section = new URL(baseIndexUrl).pathname.replace(/\/+$/, "");
      return pathname.startsWith(section + "/") || pathname === section;
    } catch {
      return false;
    }
  }

  // Collect links from all index pages (but only those that pass pathOk)
  const seenIndexHrefs = new Set();
  const candidateHrefs = [];

  for (const page of indexPages) {
    try {
      const html = await fetchText(page, { timeoutMs: SETTINGS.PAGE_TIMEOUT_MS });
      const $ = cheerio.load(html);
      $("a[href]").each((_, a) => {
        const href = $(a).attr("href");
        if (!href || href.startsWith("#")) return;
        try {
          const abs = new URL(href, page).toString();
          const u = new URL(abs);
          if (baseHost && u.hostname.replace(/^www\./, "") !== baseHost) return;
          if (!pathOk(abs, page)) return;
          const key = cleanUrl(abs);
          if (!seenIndexHrefs.has(key)) {
            seenIndexHrefs.add(key);
            candidateHrefs.push(key);
          }
        } catch { /* ignore */ }
      });
      console.log(`[${hostLabel}] indexed page: ${page} (${candidateHrefs.length} links so far)`);
    } catch (e) {
      console.log(`[${hostLabel}] index fetch fail ${page} -> ${(e && e.message) || e}`);
    }
    if (throttle) await sleep(throttle);
  }

  // Visit each candidate page and extract a Competition (guarded)
  const items = [];
  for (const href of candidateHrefs) {
    if (items.length >= maxItems) break;
    try {
      const pageHtml = await fetchText(href, { timeoutMs: SETTINGS.PAGE_TIMEOUT_MS });
      const $$ = cheerio.load(pageHtml);

      // title
      let title =
        collapse($$("h1").first().text()) ||
        collapse($$("meta[property='og:title']").attr("content") || "");
      if (!title) title = href;

      // discard if it doesn't resemble a competition
      if (!looksLikeCompetition(title, $$)) {
        // console.log(`[${hostLabel}] skip (not a comp): ${title}`);
        continue;
      }

      // published (best-effort; fallback to crawl time to stabilize sort)
      const createdAt = detectDate($$) || new Date().toISOString();

      const deadline = null; // intentionally not inferred here

      // Prefer per-page canonical if present
      const rawCanon =
        $$("link[rel='canonical']").attr("href") ||
        $$("meta[property='og:url']").attr("content") ||
        $$("meta[name='twitter:url']").attr("content") || "";
      const resolvedCanon = rawCanon ? cleanUrl(new URL(rawCanon, href).toString()) : null;
      const primaryLink = resolvedCanon && !looksLikeBadCanonical(href, resolvedCanon)
        ? resolvedCanon
        : href;

      const src = site.source || baseHost || sourceFromLink(primaryLink);
      items.push(toCompetition({ title, link: primaryLink, source: src, createdAt, deadline }));
      console.log(`[${hostLabel}] parsed: ${title}`);
    } catch (e) {
      console.log(`[${hostLabel}] parse fail ${href} -> ${(e && e.message) || e}`);
    }
    if (throttle) await sleep(throttle);
  }

  console.log(`[${hostLabel}] done: ${items.length} accepted item(s)`);
  return { label: hostLabel, indexed: candidateHrefs.length, pages: indexPages.length, items };
}

// ===== Main =====
async function main() {
  console.log("Pull started…");

  // load sources.json
  let sources = null;
  const sourcesPath = path.resolve(ROOT, "sources.json");
  try { sources = JSON.parse(await fs.readFile(sourcesPath, "utf8")); }
  catch { console.log("[sources.json] not found or invalid — exiting."); process.exit(1); }

  const rss = Array.isArray(sources.rss) ? sources.rss : [];
  const sites = Array.isArray(sources.sites) ? sources.sites : [];
  console.log(`[sources.json] loaded (${rss.length} RSS, ${sites.length} sites)`);

  // ---- stats skeleton
  const startedAt = new Date().toISOString();
  const rssStats = {};   // url -> { items }
  const siteStats = {};  // host -> { items, indexed, pages }

  // parse RSS feeds
  const rssResults = [];
  for (const r of rss) {
    const arr = await parseRSSFeed(r);
    rssResults.push(...arr);
    rssStats[r] = { items: arr.length };
  }

  // crawl sites
  const siteResults = [];
  for (const s of sites) {
    const { label, indexed, pages, items } = await crawlSite(s);
    siteStats[label] = { items: items.length, indexed, pages };
    siteResults.push(...items);
  }

  // normalize
  const raw = [...rssResults, ...siteResults];
  const normalized = raw.map(normalizeItem);

  // ➜ Upgrade known aggregators to originals (now with plain-text & scheme-less URL fallback)
  console.log(`Upgrading ${normalized.length} link(s) from known aggregators where possible…`);
  const { upgraded, upgradedCount } = await upgradeAggregatorsToOriginals(normalized);
  console.log(`Upgraded ${upgradedCount} item(s) from aggregators`);

  // canonicalize (brand pages)
  console.log(`Canonicalizing ${upgraded.length} link(s)…`);
  const canonicalized = await canonicalizeAll(upgraded);

  // dedupe → freshness
  const deduped = dedupe(canonicalized);
  const filtered = deduped.filter(freshnessFilter);

  console.log(`Totals: raw=${raw.length}, normalized=${normalized.length}, upgraded=${upgraded.length}, canonical=${canonicalized.length}, deduped=${deduped.length}, kept=${filtered.length}`);

  // perSource counts (after filtering)
  const perSource = {};
  for (const it of filtered) {
    const key = it.source || "unknown";
    perSource[key] = (perSource[key] || 0) + 1;
  }

  // sort newest with deterministic tiebreaker
  filtered.sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    if (tb !== ta) return tb - ta;
    return (a.title || "").localeCompare(b.title || "");
  });

  // write feeds.json
  const outPath = path.resolve(ROOT, "public", "feeds.json");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(filtered, null, 2), "utf8");
  console.log(`Wrote public/feeds.json with ${filtered.length} item(s)`);

  // write ingestion.json (health)
  const ingestPath = path.resolve(ROOT, "public", "ingestion.json");
  const finishedAt = new Date().toISOString();
  const health = {
    startedAt,
    finishedAt,
    counts: {
      raw: raw.length,
      normalized: normalized.length,
      upgraded: upgraded.length,
      canonicalized: canonicalized.length,
      deduped: deduped.length,
      kept: filtered.length
    },
    sources: {
      rssCount: Object.keys(rssStats).length,
      siteCount: Object.keys(siteStats).length,
      rss: rssStats,
      sites: siteStats
    },
    perSource
  };
  await fs.writeFile(ingestPath, JSON.stringify(health, null, 2), "utf8");
  console.log(`Wrote public/ingestion.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
