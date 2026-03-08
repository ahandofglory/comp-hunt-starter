// scripts/pull-feeds.mjs
// Normalize → Dedupe → Freshness filter + write per-run health to public/ingestion.json
// Requires: `npm i cheerio@1.0.0-rc.12`

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import * as cheerio from "cheerio";

// ===== Runtime + config =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = process.cwd();

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const SETTINGS = {
  MAX_ITEM_AGE_DAYS: 400,
  DROP_PAST_DEADLINES: true,
  FUTURE_CREATEDAT_SKEW_MIN: 10,
};

// ===== Small helpers =====
function collapse(s = "") {
  return s.replace(/\s+/g, " ").trim();
}
function sha1(s) {
  return crypto.createHash("sha1").update(String(s || "")).digest("hex");
}
function sleep(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}
function days(n) {
  return n * 24 * 60 * 60 * 1000;
}
function cleanUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    const drop = new Set([
      "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
      "gclid","fbclid","mc_cid","mc_eid","trk","ref","mkt_tok",
    ]);
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.startsWith("utm_") || drop.has(key)) url.searchParams.delete(key);
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return u || "";
  }
}
function sourceFromLink(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}
function normalizeSourceLabel(source, link) {
  const raw = (source || "").toLowerCase().trim();
  const fromLink = (() => {
    try {
      return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const host = (fromLink || raw).replace(/^www\./, "");
  if (host.endsWith("contest.co.nz")) return "contest.co.nz";
  if (host.endsWith("cheapies.nz")) return "cheapies.nz";
  if (host.endsWith("competitions.co.nz")) return "competitions.co.nz";
  if (host.endsWith("nzmcd.co.nz")) return "nzmcd.co.nz";
  if (host.endsWith("nowtolove.co.nz")) return "nowtolove.co.nz";
  if (host.endsWith("familytimes.co.nz")) return "familytimes.co.nz";
  if (/\.(html|php)$/i.test(raw)) return host || "unknown";
  return host || raw || "unknown";
}

function clampFutureISO(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const skew = SETTINGS.FUTURE_CREATEDAT_SKEW_MIN * 60 * 1000;
  const now = Date.now();
  return t > now + skew ? new Date(now).toISOString() : new Date(t).toISOString();
}

// ===== Deadline extraction from title text =====
// Handles patterns like:
//   "closes 7th March", "closes 4th March 2026", "drawn 26th February 2026",
//   "closes 26th March 2026", "3rd March 2026", "closes 27th February"
const ORDINAL = "(?:st|nd|rd|th)?";
const DAY = `\\d{1,2}${ORDINAL}`;
const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const YEAR = "(?:\\s+\\d{4})?";

// "closes/drawn/due/ends/closing + date"
const TITLE_DEADLINE_RE = new RegExp(
  `(?:clos(?:es?|ing)|drawn?|ends?|due)\\s+(?:on\\s+)?(${DAY}\\s+${MONTH}${YEAR}|${MONTH}\\s+${DAY}${YEAR})`,
  "i"
);

// Bare date at end of title: "Win a TV closes 3rd March 2026"
// Also catches "closes 3rd March 2026" anywhere
const BARE_DATE_RE = new RegExp(
  `(${DAY}\\s+${MONTH}\\s+\\d{4}|${MONTH}\\s+${DAY},?\\s+\\d{4})`,
  "i"
);

function extractDeadlineFromTitle(title) {
  if (!title) return null;

  // Try explicit close/drawn keyword first
  let m = title.match(TITLE_DEADLINE_RE);
  if (m) {
    const cleaned = m[1].replace(/(\d+)(?:st|nd|rd|th)/, "$1");
    const t = Date.parse(cleaned);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }

  // Fall back to bare date with year (less likely to be noisy)
  m = title.match(BARE_DATE_RE);
  if (m) {
    const cleaned = m[1].replace(/(\d+)(?:st|nd|rd|th)/, "$1");
    const t = Date.parse(cleaned);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }

  return null;
}

function normalizeItem(raw) {
  const link = cleanUrl(raw.link || "");
  const title = collapse(raw.title || "");
  const source = normalizeSourceLabel(raw.source, link);
  const createdAt = clampFutureISO(raw.createdAt || null);

  // Prefer explicit deadline field; fall back to title extraction
  let deadline = null;
  if (raw.deadline) {
    const d = Date.parse(raw.deadline);
    if (Number.isFinite(d)) deadline = new Date(d).toISOString();
  }
  if (!deadline) {
    deadline = extractDeadlineFromTitle(title);
  }

  const id = link || sha1(`${title}|${source}`);
  return {
    id,
    title,
    link,
    source,
    createdAt,
    deadline,
    prize: raw.prize || undefined,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
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
function dedupe(items) {
  const byLink = new Map();
  const score = (x) =>
    (x.deadline ? 3 : 0) + (x.createdAt ? 2 : 0) + (x.title?.length || 0) / 1000;
  for (const it of items) {
    if (!it.link) continue;
    const key = cleanUrl(it.link);
    const prev = byLink.get(key);
    byLink.set(key, !prev || score(it) >= score(prev) ? it : prev);
  }
  const withLinks = Array.from(byLink.values());
  const noLinks = items.filter((x) => !x.link);
  const final = [...withLinks];
  const sig = (x) => `${(x.title || "").toLowerCase()}|${(x.source || "").toLowerCase()}`;
  const seenSig = new Set(final.map(sig));
  for (const it of noLinks) {
    const s = sig(it);
    if (!seenSig.has(s)) {
      seenSig.add(s);
      final.push(it);
    }
  }
  return final;
}

// ===== Network helpers =====
async function fetchText(url, { as = "text" } = {}) {
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === "buffer" ? Buffer.from(await res.arrayBuffer()) : await res.text();
}
function toAbsolute(baseUrl, href) {
  try {
    if (!href) return null;
    if (href.startsWith("//")) return "https:" + href;
    if (href.startsWith("/")) {
      const u = new URL(baseUrl);
      return `${u.origin}${href}`;
    }
    new URL(href);
    return href;
  } catch {
    return null;
  }
}

function fixRssLink(feedUrl, link) {
  if (!link) return null;
  if (link.startsWith("/") || link.startsWith("./") || link.startsWith("../")) {
    try {
      return new URL(link, feedUrl).toString();
    } catch {
      return link;
    }
  }
  try {
    const u = new URL(link);
    const host = (u.hostname || "").toLowerCase();
    const hostLooksLikeFile = host.endsWith(".html") || host.endsWith(".php");
    if (hostLooksLikeFile) {
      const base = new URL(feedUrl);
      const rebuilt = new URL(`/${host}${u.pathname === "/" ? "" : u.pathname}`, base.origin);
      rebuilt.search = u.search;
      rebuilt.hash = "";
      return rebuilt.toString();
    }
    return link;
  } catch {
    try {
      return new URL(link, feedUrl).toString();
    } catch {
      return link;
    }
  }
}

// ===== Page parsing =====
function extractPublished($) {
  const candidates = [
    "meta[property='article:published_time']",
    "meta[name='article:published_time']",
    "meta[property='og:updated_time']",
    "meta[name='date']",
    "time[datetime]",
  ];
  for (const sel of candidates) {
    const el = $(sel).first();
    if (!el.length) continue;
    const iso = el.attr("content") || el.attr("datetime");
    if (iso) {
      const t = Date.parse(iso);
      if (!isNaN(t)) return new Date(t).toISOString();
    }
  }
  const bodyText = $("main").text() || $("article").text() || $("body").text() || "";
  const m = bodyText.match(
    /\b(?:\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{4})?|[A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?)\b/
  );
  if (m) {
    const t = Date.parse(m[0]);
    if (!isNaN(t)) return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

function extractDeadlineText($, site) {
  const sourceText = $("main").text() || $("article").text() || $("body").text() || "";
  let regex = null;
  if (site?.deadline_text_regex) {
    try {
      regex = new RegExp(site.deadline_text_regex, "i");
    } catch {
      regex = null;
    }
  }
  const generic =
    /(Entries?\s+close|Closes?|Closing|Ends?|End[s]?)(?:\s*[:\-]|\s+on)?\s+([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i;
  const use = regex || generic;
  const m = sourceText.match(use);
  if (!m) return null;
  const dateCandidate = m[2] || m[1] || m[0];
  const t = Date.parse(dateCandidate);
  return !isNaN(t) ? new Date(t).toISOString() : null;
}

function toCompetition({ title, link, source, createdAt, deadline }) {
  return {
    id: link || sha1(`${title}|${link}`),
    title: collapse(title),
    link,
    source,
    createdAt,
    deadline,
    tags: [],
    prize: undefined,
  };
}

// ===== RSS (XML) =====
async function parseRSSFeed(url) {
  try {
    const xml = await fetchText(url);
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
        node.find("link").first().attr("href") || collapse(node.find("link").first().text());
      if (!link) link = collapse(node.find("guid").first().text());
      if (!link) link = collapse(node.find("id").first().text());
      link = link.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
      link = fixRssLink(url, link);

      const pub =
        collapse(node.find("pubDate").first().text()) ||
        collapse(node.find("updated").first().text()) ||
        collapse(node.find("published").first().text());
      const createdAt = pub && !isNaN(Date.parse(pub)) ? new Date(pub).toISOString() : null;
      const host = sourceFromLink(link);
      const source = host || new URL(url).hostname.replace(/^www\./, "");

      // Extract deadline from title for RSS items (no page visit)
      const deadline = extractDeadlineFromTitle(title);

      if (title && link) out.push(toCompetition({ title, link, createdAt, source, deadline }));
    });
    console.log(`[RSS] ${url} -> ${out.length} items`);
    return out;
  } catch (e) {
    console.log(`Failed feed: ${url} ${(e && e.message) || e}`);
    return [];
  }
}

// ===== Site crawling =====
async function crawlSite(site) {
  const baseHost = (site.host || site.site || "").replace(/^https?:\/\//, "").replace(/^www\./, "");
  const indexUrl = site.index;
  const throttle = Number(site.throttle_ms || 0);
  const hostLabel = baseHost || (indexUrl ? new URL(indexUrl).hostname.replace(/^www\./, "") : "site");

  console.log(`[${hostLabel}] crawl start: ${indexUrl}`);

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

  const seenIndexHrefs = new Set();
  const selFromConfig = site.href_selector || site.item_selector;

  for (let i = 0; i < indexPages.length; i++) {
    const pageUrl = indexPages[i];
    let html;
    try {
      if (throttle > 0 && i > 0) await sleep(throttle);
      html = await fetchText(pageUrl);
    } catch (e) {
      console.log(`[${hostLabel}] index fetch failed (${pageUrl}): ${e && e.message}`);
      continue;
    }

    const $ = cheerio.load(html);
    let $as = selFromConfig ? $(selFromConfig) : $("a[href]");
    if ($as.length === 0) {
      $as = $("a[href]").filter((_, a) => {
        const href = $(a).attr("href") || "";
        if (!href.startsWith("/")) return false;
        return /win|prize|competitions?|giveaway|contest/i.test(href);
      });
    }

    let found = 0;
    $as.each((_, a) => {
      const raw = $(a).attr("href");
      const abs = toAbsolute(pageUrl, raw);
      if (!abs) return;
      try {
        const u = new URL(abs);
        const hostNoW = u.hostname.replace(/^www\./, "");
        if (baseHost && hostNoW !== baseHost) return;
        const key = cleanUrl(u.href);
        if (!seenIndexHrefs.has(key)) {
          seenIndexHrefs.add(key);
          found++;
        }
      } catch {
        // ignore
      }
    });

    console.log(`[${hostLabel}] index page ${i + 1}/${indexPages.length} -> ${found} new link(s)`);
  }

  let hrefs = Array.from(seenIndexHrefs);
  const cap = Number(site.index_limit || site.max_items);
  if (Number.isFinite(cap) && cap > 0) hrefs = hrefs.slice(0, cap);

  console.log(`[${hostLabel}] total indexed -> ${hrefs.length} link(s)${cap ? " (limited)" : ""}`);

  const items = [];
  for (const href of hrefs) {
    try {
      if (throttle > 0) await sleep(throttle);
      const pageHtml = await fetchText(href);
      const $$ = cheerio.load(pageHtml);

      let title =
        collapse($$("h1").first().text()) ||
        collapse($$("meta[property='og:title']").attr("content") || "");
      if (!title) title = href;

      const createdAt = extractPublished($$);

      // Try page body first; fall back to title extraction
      let deadline = extractDeadlineText($$, site);
      if (!deadline) deadline = extractDeadlineFromTitle(title);

      const looksLikeListing =
        /competitions?|giveaways?/i.test(title) && (!deadline || deadline === null) && title.length <= 40;
      if (looksLikeListing) continue;

      const src = site.source || baseHost || sourceFromLink(href);
      items.push(toCompetition({ title, link: href, source: src, createdAt, deadline }));
      console.log(`[${hostLabel}] parsed: ${title}`);
    } catch (e) {
      console.log(`[${hostLabel}] parse fail ${href} -> ${(e && e.message) || e}`);
    }
  }

  console.log(`[${hostLabel}] done: ${items.length} item(s)`);
  return { label: hostLabel, indexed: hrefs.length, pages: indexPages.length, items };
}

// ===== main =====
async function main() {
  console.log("Pull started…");

  let sources = null;
  const sourcesPath = path.resolve(ROOT, "sources.json");
  try {
    sources = JSON.parse(await fs.readFile(sourcesPath, "utf8"));
  } catch {
    console.log("[sources.json] not found or invalid — exiting.");
    process.exit(1);
  }

  const rss = Array.isArray(sources.rss) ? sources.rss : [];
  const sites = Array.isArray(sources.sites) ? sources.sites : [];
  console.log(`[sources.json] loaded (${rss.length} RSS, ${sites.length} sites)`);

  const startedAt = new Date().toISOString();
  const rssStats = {};
  const siteStats = {};

  const rssResults = [];
  for (const r of rss) {
    const arr = await parseRSSFeed(r);
    rssResults.push(...arr);
    rssStats[r] = { items: arr.length };
  }

  const siteResults = [];
  for (const s of sites) {
    const { label, indexed, pages, items } = await crawlSite(s);
    siteStats[label] = { items: items.length, indexed, pages };
    siteResults.push(...items);
  }

  let existingItems = [];
  const outPath = path.resolve(ROOT, "public", "feeds.json");
  try {
    const existing = JSON.parse(await fs.readFile(outPath, "utf8"));
    if (Array.isArray(existing)) existingItems = existing;
    console.log(`[accumulate] loaded ${existingItems.length} existing items`);
  } catch {
    console.log("[accumulate] no existing feeds.json — starting fresh");
  }

  const raw = [...rssResults, ...siteResults];
  const normalized = raw.map(normalizeItem);
  const combined = [...existingItems, ...normalized];
  const deduped = dedupe(combined);
  const filtered = deduped.filter(freshnessFilter);

  console.log(
    `Totals: raw=${raw.length}, normalized=${normalized.length}, existing=${existingItems.length}, combined=${combined.length}, deduped=${deduped.length}, kept=${filtered.length}`
  );

  const perSource = {};
  for (const it of filtered) {
    const key = it.source || "unknown";
    perSource[key] = (perSource[key] || 0) + 1;
  }

  filtered.sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    return (tb || 0) - (ta || 0);
  });

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(filtered, null, 2), "utf8");
  console.log(`Wrote public/feeds.json with ${filtered.length} item(s)`);

  const ingestPath = path.resolve(ROOT, "public", "ingestion.json");
  const finishedAt = new Date().toISOString();
  const health = {
    startedAt,
    finishedAt,
    pulledAtIso: finishedAt,
    counts: {
      raw: raw.length,
      normalized: normalized.length,
      deduped: deduped.length,
      kept: filtered.length,
    },
    sources: {
      rssCount: Object.keys(rssStats).length,
      siteCount: Object.keys(siteStats).length,
      rss: rssStats,
      sites: siteStats,
    },
    perSource,
  };
  await fs.writeFile(ingestPath, JSON.stringify(health, null, 2), "utf8");
  console.log(`Wrote public/ingestion.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});