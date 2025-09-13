// scripts/pull-feeds.mjs
// Build a single JSON feed from RSS feeds and selector-based sites.
// Usage: node scripts/pull-feeds.mjs
// Output: public/feeds.json

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cheerio from 'cheerio'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.join(__dirname, '..')

// ------------------------ small helpers ------------------------

const DEBUG = !!process.env.DEBUG

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const decodeEntities = (s = '') =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

const stripCDATA = (s = '') =>
  s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim()

const cleanText = (s = '') =>
  decodeEntities(stripCDATA(String(s))).replace(/\s+/g, ' ').trim()

function toISO(s) {
  if (!s) return null
  const t = Date.parse(s)
  if (Number.isFinite(t)) return new Date(t).toISOString()
  return null
}

function normalizeHref(href, baseUrl) {
  if (!href) return ''
  if (href.startsWith('//')) href = 'https:' + href
  if (href.startsWith('/')) href = new URL(baseUrl).origin + href
  if (!/^https?:\/\//i.test(href)) href = new URL(href, baseUrl).href
  return href
}

async function fetchText(url, kind = 'html') {
  const headers = {
    'user-agent': 'parlay-pull/1.0 (+https://example.invalid)',
    accept:
      kind === 'xml'
        ? 'application/rss+xml, application/xml;q=0.9, */*;q=0.8'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

function extractBySelector($$, spec) {
  if (!spec) return ''
  const [sel, attr] = spec.split('@')
  const el = $$(sel.trim()).first()
  if (!el.length) return ''
  return attr ? (el.attr(attr.trim()) || '').trim() : el.text().trim()
}

// ------------------------ RSS / Atom / JSON-Feed ------------------------

async function fetchRSS(url) {
  try {
    const text = await fetchText(url, 'xml')
    const host = new URL(url).hostname
    const trimmed = text.trim()

    // JSON Feed (simple check)
    if (trimmed.startsWith('{')) {
      const j = JSON.parse(trimmed)
      const items = (j.items || []).map((it) => ({
        id: it.id || it.url || it.guid || `json:${Math.random().toString(36).slice(2)}`,
        title: cleanText(it.title || '(untitled)'),
        link: it.url || it.external_url || '',
        source: host,
        createdAt: it.date_published || it.published || it.date_modified || null,
        deadline: null,
        prize: null,
        tags: [],
      }))
      return items
    }

    // Parse XML with cheerio
    const $ = cheerio.load(trimmed, { xmlMode: true })

    // Atom
    if ($('feed').length && $('entry').length) {
      const items = []
      $('entry').each((_, e) => {
        const entry = $(e)
        const title = cleanText(entry.find('title').first().text())
        const link =
          entry.find('link[href]').first().attr('href') ||
          entry.find('id').first().text() ||
          ''
        const updated = entry.find('updated').first().text()
        items.push({
          id: link || `atom:${Math.random().toString(36).slice(2)}`,
          title: title || '(untitled)',
          link,
          source: host,
          createdAt: updated || null,
          deadline: null,
          prize: null,
          tags: [],
        })
      })
      return items
    }

    // RSS 2.0
    const items = []
    $('item').each((_, el) => {
      const it = $(el)
      const rawTitle = it.find('title').first().text()
      const title = cleanText(rawTitle) || '(untitled)'
      const link = (it.find('link').first().text() || '').trim()
      const pubDate = (it.find('pubDate').first().text() || '').trim()
      const guid = (it.find('guid').first().text() || '').trim()
      items.push({
        id: guid || link || `rss:${Math.random().toString(36).slice(2)}`,
        title,
        link,
        source: host,
        createdAt: pubDate ? toISO(pubDate) : null,
        deadline: null,
        prize: null,
        tags: [],
      })
    })
    return items
  } catch (e) {
    console.warn(`Failed feed: ${url} ${e.message}`)
    return []
  }
}

// ------------------------ selector-based site crawler ------------------------

async function crawlSiteCard(site) {
  const start = site.index || site.start
  const host = new URL(start).hostname
  console.log(`[${host}] crawl start: ${start}`)

  const indexHtml = await fetchText(start, 'html')
  const $ = cheerio.load(indexHtml)

  // Collect detail-page links from the index using the site's selector
  let hrefs = []
  if (site.item_selector) {
    $(site.item_selector).each((_, a) => {
      const abs = normalizeHref($(a).attr('href') || '', start)
      if (abs) hrefs.push(abs)
    })
  }

  // De-dupe while preserving order
  const seen = new Set()
  hrefs = hrefs.filter((h) => {
    if (seen.has(h)) return false
    seen.add(h)
    return true
  })

  // --- Fallback for Now to Love (if selector finds nothing) ---
  if (hrefs.length === 0 && /(^|\.)nowtolove\.co\.nz$/i.test(host)) {
    console.log(`[${host}] no matches for "${site.item_selector}". Using smart fallback…`)
    const candidates = []
    $('a[href]').each((_, a) => {
      const abs = normalizeHref($(a).attr('href') || '', start)
      if (!abs) return
      try {
        const u = new URL(abs)
        // Only this host, real comp pages under /win/ (not listing/puzzles/pagination/tag/category)
        const okHost = u.hostname.endsWith('nowtolove.co.nz')
        const p = u.pathname
        const okPath =
          p.startsWith('/win/') &&
          p !== '/win/' &&
          !p.startsWith('/win/competitions') &&
          !p.startsWith('/win/puzzles') &&
          !p.includes('/page/') &&
          !p.includes('/tag/') &&
          !p.includes('/category/')
        if (okHost && okPath) candidates.push(abs)
      } catch { /* ignore bad URLs */ }
    })
    // unique, preserve order
    const seen2 = new Set()
    hrefs = candidates.filter((h) => {
      if (seen2.has(h)) return false
      seen2.add(h)
      return true
    })
  }

  // ✨ Limit how many we follow from this index (if provided in sources.json)
  const limit = Number(site.index_limit || site.max_items)
  if (Number.isFinite(limit) && limit > 0) {
    hrefs = hrefs.slice(0, limit)
  }

  console.log(
    `[${host}] index ${site.index || site.start} -> ${hrefs.length} link(s)${
      Number.isFinite(limit) && limit > 0 ? ' (limited)' : ''
    }`
  )

  const items = []
  const throttleMs = Number(site.throttle_ms || 0)

  for (const href of hrefs) {
    try {
      const html = await fetchText(href, 'html')
      const $$ = cheerio.load(html)

      // Title
      let title = ''
      if (site.title_selector) {
        title = extractBySelector($$, site.title_selector)
      }
      if (!title) title = $$('#content h1').first().text().trim() || $$('h1').first().text().trim()
      if (!title) title = $$('title').first().text().trim()
      title = cleanText(title || '(untitled)')

      // Published / createdAt
      let createdAt = null
      if (site.published_selector) {
        const pub = extractBySelector($$, site.published_selector)
        const iso = toISO(pub)
        if (iso) createdAt = iso
      }

      // Deadline via regex over visible text (article/main/body)
      let deadline = null
      if (site.deadline_text_regex) {
        const rx = new RegExp(site.deadline_text_regex, 'i')
        const blob = ($$('article').text() || $$('main').text() || $$('body').text() || '').replace(/\s+/g, ' ')
        const m = blob.match(rx)
        if (m) {
          // prefer last non-empty capture; otherwise full match
          let cand = ''
          for (let i = m.length - 1; i >= 1; i--) {
            if (m[i] && m[i].trim()) { cand = m[i].trim(); break }
          }
          if (!cand) cand = m[0]
          const iso = toISO(cand)
          if (iso) deadline = iso
        }
      }

      items.push({
        id: href,
        title,
        link: href,
        source: site.source || host,
        createdAt,
        deadline,
        prize: null,
        tags: site.tags || [],
      })

      if (throttleMs > 0) await sleep(throttleMs)
    } catch (e) {
      console.warn(`[${host}] detail failed: ${href} ${e.message}`)
    }
  }

  return items
}

// ------------------------ main ------------------------

async function loadSources() {
  const srcPath = path.join(ROOT, 'sources.json')
  try {
    const raw = await fs.readFile(srcPath, 'utf8')
    const parsed = JSON.parse(raw)
    const rss = Array.isArray(parsed.rss) ? parsed.rss : []
    const sites = Array.isArray(parsed.sites) ? parsed.sites : []
    console.log(`[sources.json] loaded (${rss.length} RSS, ${sites.length} sites)`)
    return { rss, sites }
  } catch {
    console.log('[sources.json] not found or invalid — using built-in NZMCD example')
    return {
      rss: [],
      sites: [
        {
          site: 'nzmcd.co.nz',
          index: 'https://nzmcd.co.nz/competitions/',
          max_pages: 1,
          item_selector:
            'a[href*="/competitions/"]:not([href$="/competitions/"]):not([href*="/competitions/page/"])',
          title_selector: 'h1',
          source: 'NZMCD',
          throttle_ms: 200,
          index_limit: 12,
        },
      ],
    }
  }
}

async function main() {
  console.log('Pull started…')

  const { rss, sites } = await loadSources()
  const all = []

  // RSS first
  for (const url of rss) {
    const items = await fetchRSS(url)
    console.log(`[RSS] ${url} -> ${items.length} items`)
    all.push(...items)
  }

  // Sites next
  for (const site of sites) {
    try {
      const items = await crawlSiteCard(site)
      const host = new URL(site.index || site.start).hostname
      console.log(`[${host}] done: ${items.length} item(s)`)
      all.push(...items)
    } catch (e) {
      console.warn(`[site] ${site.index || site.start} failed: ${e.message}`)
    }
  }

  // De-duplicate by link (fallback to id)
  const seen = new Set()
  const out = []
  for (const it of all) {
    const key = it.link || it.id
    if (!key) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }

  // Write output
  await fs.mkdir(path.join(ROOT, 'public'), { recursive: true })
  const outPath = path.join(ROOT, 'public', 'feeds.json')
  await fs.writeFile(outPath, JSON.stringify(out, null, 2))
  console.log(`Wrote public/feeds.json with ${out.length} item(s)`)
}

main().catch((e) => {
  console.error('Pull failed:', e)
  process.exitCode = 1
})
