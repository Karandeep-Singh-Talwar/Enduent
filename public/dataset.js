// Pure functions that combine search results, ETA data and brand views. No DOM; unit-tested in Node.
import { resolvePlatformId } from '../shared/platforms.js';

export const UNBRANDED = 'Unbranded';
const MAX_BRAND_QUERIES = 6;

const squash = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const platformId = (name) => resolvePlatformId(name) ?? String(name ?? '');
const rankOf = (row) => (typeof row.rank === 'number' ? row.rank : Number.POSITIVE_INFINITY);
const hasEta = (eta) => typeof eta === 'string' && eta.trim() !== '' && eta.trim().toUpperCase() !== 'NA';
const numbers = (values) => values.filter((v) => typeof v === 'number' && Number.isFinite(v));

/** @param {{ brand?: unknown }} row */
export const brandOf = (row) => (typeof row.brand === 'string' && row.brand.trim() ? row.brand.trim() : UNBRANDED);

/**
 * Combine product rows from several searches; the same platform + item id is kept once (best rank wins).
 * @param {object[][]} rowLists
 * @returns {object[]}
 */
export function mergeProductRows(rowLists) {
  const best = new Map();
  for (const row of rowLists.flat()) {
    const key = `${platformId(row.platform)}|${row.id}`;
    const existing = best.get(key);
    if (!existing || rankOf(row) < rankOf(existing)) best.set(key, row);
  }
  return [...best.values()];
}

/**
 * @param {object[]} rows
 * @returns {Array<{ brand: string, count: number }>} most products first, ties alphabetical
 */
export function brandCounts(rows) {
  const counts = rows.reduce((acc, row) => acc.set(brandOf(row), (acc.get(brandOf(row)) ?? 0) + 1), new Map());
  return [...counts].map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
}

/**
 * @param {object[]} rows
 * @param {Set<string>} selected brand names; empty = no filter
 */
export const filterByBrands = (rows, selected) => (selected.size === 0 ? rows : rows.filter((r) => selected.has(brandOf(r))));

/**
 * Does this product belong to the brand the user typed? Covers sub-brands ("Amul Lite" for "Amul")
 * and products whose brand field is empty but whose name starts with the brand.
 * @param {{ brand?: unknown, name?: unknown }} row
 * @param {string} brand
 */
export function matchesBrand(row, brand) {
  const wanted = squash(brand);
  if (!wanted) return false;
  return squash(row.brand).includes(wanted) || squash(row.name).startsWith(wanted);
}

const words = (text) => String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
// Size tokens ("500g", "1kg", "750ml") rarely appear in product names, so they never decide relevance.
const queryTokens = (query) => [...new Set(words(query).filter((w) => w.length >= 2 && !/\d/.test(w)))];
const sameWord = (word, token) =>
  word === token || word === `${token}s` || word === `${token}es` || (token.endsWith('s') && word === token.slice(0, -1));

function relevantTo(row, query) {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return true;
  // Brand words are matched against the brand, not the name: "Amul Butter" must not keep "Amul Masti Dahi".
  const brandWords = new Set(words(row.brand));
  const productTokens = tokens.filter((t) => !brandWords.has(t));
  if (productTokens.length === 0) return true;
  const nameWords = words(row.name).filter((w) => !brandWords.has(w));
  return productTokens.some((t) => nameWords.some((w) => sameWord(w, t)));
}

/**
 * Is this product what the user searched for, rather than filler the platform appended
 * ("you may also like" dal/bread after butter)? Whole-word match on the product name, plurals allowed.
 * @param {{ name?: unknown, brand?: unknown }} row
 * @param {string[]} queries every query of the run; matching any one is enough
 */
export const isRelevant = (row, queries) => queries.length === 0 || queries.some((q) => relevantTo(row, q));

/**
 * @param {object[]} rows
 * @param {string[]} queries
 * @returns {{ rows: object[], hidden: number }}
 */
export function filterRelevant(rows, queries) {
  const kept = rows.filter((r) => isRelevant(r, queries));
  return { rows: kept, hidden: rows.length - kept.length };
}

/** Brand names (from brandCounts) that match the typed brand. */
export const brandsMatching = (counts, brand) => counts.filter((c) => matchesBrand({ brand: c.brand }, brand)).map((c) => c.brand);

function summarizeCell(cells) {
  const prices = numbers(cells.map((c) => c.price));
  const ranks = numbers(cells.map((c) => c.rank));
  return {
    count: cells.length,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    bestRank: ranks.length ? Math.min(...ranks) : null,
    ads: cells.filter((c) => c.sponsored === true).length,
    inStock: cells.filter((c) => c.available === true).length,
  };
}

/**
 * Side-by-side view: for each brand and platform, how many products, price range, best rank, ads, in stock.
 * @param {object[]} rows
 * @param {string[]} brands
 * @param {string[]} platforms API platform ids
 */
export function brandMatrix(rows, brands, platforms) {
  return Object.fromEntries(brands.map((brand) => [brand, Object.fromEntries(platforms.map((p) => [
    p, summarizeCell(rows.filter((r) => brandOf(r) === brand && platformId(r.platform) === p)),
  ]))]));
}

/**
 * Normalise /v1/eta (single object) and /v1/groupeta (results[]) into { platformId: { eta, open, store_id } }.
 * @param {unknown} body
 */
export function parseEtaResults(body) {
  const data = body?.data ?? body;
  const list = Array.isArray(data?.results) ? data.results : (data && typeof data === 'object' && 'eta' in data ? [data] : []);
  return Object.fromEntries(list.filter((r) => r?.platform).map((r) => [platformId(r.platform), {
    eta: r.eta ?? null,
    open: typeof r.open === 'boolean' ? r.open : null,
    store_id: r.store_id ?? null,
  }]));
}

/**
 * Fill each product's ETA / open / store from the per-location ETA cache. Real values on the row win.
 * @param {object[]} rows
 * @param {Record<string, { eta: unknown, open: boolean|null, store_id: unknown }>} cache
 */
export function attachEta(rows, cache) {
  return rows.map((row) => {
    const cached = cache?.[platformId(row.platform)] ?? null;
    return {
      ...row,
      eta: hasEta(row.eta) ? row.eta : cached?.eta ?? null,
      open: typeof row.open === 'boolean' ? row.open : cached?.open ?? null,
      store_id: row.store_id ?? cached?.store_id ?? null,
    };
  });
}

/** ETA-capable platforms that still need an ETA call at this location. */
export const missingEtaPlatforms = (platforms, cache, etaCapable) =>
  platforms.filter((p) => etaCapable.includes(p) && !(cache && Object.hasOwn(cache, p)));

/**
 * One status line per searched platform: product count, error, ETA, open/closed, dark store.
 * @param {string[]} platforms
 * @param {object[]} rows merged product rows
 * @param {Record<string, string>} errors platformId → error message
 * @param {Record<string, object>} etaCache
 */
export function platformStatus(platforms, rows, errors, etaCache) {
  return platforms.map((p) => {
    const count = rows.filter((r) => platformId(r.platform) === p).length;
    const error = errors?.[p] ?? null;
    return {
      platform: p,
      count,
      error,
      // Seen live: a platform silently missing from groupsearch results while still in credit_cost.
      warning: !error && count === 0 ? 'No results returned. The call may still be billed: check credits.' : null,
      eta: etaCache?.[p]?.eta ?? null,
      open: etaCache?.[p]?.open ?? null,
      store_id: etaCache?.[p]?.store_id ?? null,
    };
  });
}

/**
 * Searches to run for "all products of a brand": the brand alone, then brand + each keyword.
 * @param {string} brand
 * @param {string} keywordsText comma-separated
 * @returns {string[]} at most 6 queries
 */
export function buildBrandQueries(brand, keywordsText) {
  const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
  const base = clean(brand);
  if (!base) return [];
  const keywords = String(keywordsText ?? '').split(',').map(clean).filter(Boolean);
  const queries = [base, ...keywords.map((k) => `${base} ${k}`)];
  const unique = queries.filter((q, i) => queries.findIndex((other) => other.toLowerCase() === q.toLowerCase()) === i);
  return unique.slice(0, MAX_BRAND_QUERIES);
}

/** Cache key for a delivery location; 3 decimals (~100 m) absorbs GPS jitter. */
export const locationKey = ({ lat, lon, pincode }) => `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}|${pincode ?? ''}`;
