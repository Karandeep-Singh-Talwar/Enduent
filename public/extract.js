// Turns any QuickCommerce API response into table rows. Pure functions, no DOM: unit-tested in Node.
// Response shapes vary by endpoint (and groupsearch has no envelope), so products are found by shape,
// not by fixed path.

const PRICE_KEYS = ['offer_price', 'offerPrice', 'price', 'sellingPrice', 'mrp'];
const PLATFORM_KEY = /^[A-Z][A-Za-z]{1,29}$/;
const MAX_FLATTEN_DEPTH = 2;

export const PRODUCT_COLUMNS = Object.freeze([
  'platform', 'rank', 'image', 'name', 'brand', 'quantity', 'currency', 'mrp', 'price', 'discount_pct',
  'available', 'inventory', 'rating', 'rating_count', 'eta', 'open', 'sponsored', 'store_id', 'id', 'deeplink',
]);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isProductLike = (v) => isPlainObject(v) && typeof v.name === 'string' && PRICE_KEYS.some((k) => k in v);
// A lone object (not in an array) must also carry an id, so things like screenshot `api_price` don't count.
const isStandaloneProduct = (v) => isProductLike(v) && ['id', 'item_id', 'product_id'].some((k) => k in v);
const isFilled = (v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
const firstDefined = (...values) => values.find((v) => v !== undefined && v !== null) ?? null;

/**
 * Collect product-like objects anywhere in the tree, remembering the nearest PascalCase key as platform hint
 * and the 1-based position in their list (the platform's own ranking order).
 */
function collectProducts(node, hint) {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => (isProductLike(child) ? [{ raw: child, hint, position: i + 1 }] : collectProducts(child, hint)));
  }
  if (!isPlainObject(node)) return [];
  if (isStandaloneProduct(node)) return [{ raw: node, hint, position: null }];
  return Object.entries(node).flatMap(([key, child]) => collectProducts(child, PLATFORM_KEY.test(key) ? key : hint));
}

function firstImage(raw) {
  const candidates = [raw.images, raw.gallery, raw.image, raw.image_url].flat().filter(Boolean);
  const first = candidates[0];
  if (typeof first === 'string') return first;
  return isPlainObject(first) ? firstDefined(first.url, first.src) : null;
}

/** Platforms send float32 noise (4.599999904632568); keep one decimal, drop anything non-numeric. */
function roundRating(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

const booleanOrNull = (...values) => values.find((v) => typeof v === 'boolean') ?? null;

function discountPct(mrp, price) {
  if (typeof mrp !== 'number' || typeof price !== 'number' || mrp <= 0) return null;
  return price < mrp ? Math.round((1 - price / mrp) * 100) : 0;
}

function normalizeProduct({ raw, hint, position }) {
  const platformObj = isPlainObject(raw.platform) ? raw.platform : {};
  const platformName = isPlainObject(raw.platform) ? raw.platform.name : raw.platform;
  const price = firstDefined(raw.offer_price, raw.offerPrice, raw.price, raw.sellingPrice);
  return {
    platform: firstDefined(platformName, hint) ?? '',
    // /v1/groupsearch drops `rank`, but its per-platform arrays keep the platform's order.
    rank: firstDefined(raw.rank, position),
    image: firstImage(raw),
    name: raw.name,
    brand: firstDefined(raw.brand),
    quantity: firstDefined(raw.quantity, raw.unit),
    currency: firstDefined(raw.currency),
    mrp: firstDefined(raw.mrp),
    price,
    discount_pct: discountPct(raw.mrp, price),
    available: firstDefined(raw.available, raw.in_stock),
    inventory: firstDefined(raw.inventory),
    rating: roundRating(raw.rating),
    rating_count: firstDefined(raw.rating_count, raw.ratingCount),
    eta: firstDefined(platformObj.sla),
    open: typeof platformObj.open === 'boolean' ? platformObj.open : null,
    // Live responses carry undocumented is_ad / store_id; group=true nests the store under platform.storeId.
    sponsored: booleanOrNull(raw.is_ad, raw.isAd),
    store_id: firstDefined(raw.store_id, raw.storeId, platformObj.storeId, platformObj.store_id),
    id: String(firstDefined(raw.id, raw.item_id, raw.product_id) ?? ''),
    deeplink: firstDefined(raw.deeplink, raw.url),
  };
}

/** Breadth-first search for the shallowest non-empty array of objects. */
function firstObjectArray(root) {
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    if (Array.isArray(node) && node.length > 0 && node.every(isPlainObject)) return node;
    if (isPlainObject(node) || Array.isArray(node)) queue.push(...Object.values(node));
  }
  return null;
}

function flattenRow(obj, prefix = '', depth = 0) {
  return Object.entries(obj).reduce((row, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      return depth + 1 < MAX_FLATTEN_DEPTH
        ? { ...row, ...flattenRow(value, path, depth + 1) }
        : { ...row, [path]: JSON.stringify(value) };
    }
    if (Array.isArray(value)) {
      const scalars = value.every((v) => !isPlainObject(v) && !Array.isArray(v));
      return { ...row, [path]: scalars ? value.join(', ') : `[${value.length} items]` };
    }
    return { ...row, [path]: value };
  }, {});
}

const unionColumns = (rows) => [...new Set(rows.flatMap((r) => Object.keys(r)))];

/**
 * @param {unknown} body raw API response body
 * @returns {{ kind: 'products' | 'generic' | 'empty', rows: object[], columns: string[], raws: object[] }}
 */
export function extractRows(body) {
  const found = collectProducts(body, undefined);
  if (found.length > 0) {
    return { kind: 'products', rows: found.map(normalizeProduct), columns: [...PRODUCT_COLUMNS], raws: found.map((f) => f.raw) };
  }
  const list = firstObjectArray(body);
  const raws = list ?? [isPlainObject(body?.data) ? body.data : body].filter(isPlainObject);
  if (raws.length === 0) return { kind: 'empty', rows: [], columns: [], raws: [] };
  const rows = raws.map((r) => flattenRow(r));
  return { kind: 'generic', rows, columns: unionColumns(rows), raws };
}

/** Leaf [path, value] pairs; arrays become "path[]" and are descended element by element. */
function leafPaths(node, prefix) {
  if (Array.isArray(node)) {
    if (node.length === 0) return [[`${prefix}[]`, null]];
    return node.flatMap((child) => leafPaths(child, `${prefix}[]`));
  }
  if (isPlainObject(node)) {
    return Object.entries(node).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return [[prefix, node]];
}

/**
 * Flatten one record into [path, value] pairs ("platform.sla", "images[]", ...).
 * @param {object} record
 * @returns {Array<[string, unknown]>}
 */
export const flattenRecord = (record) => leafPaths(record, '');

/**
 * Every field seen across raw records: how often it is filled, its type and an example value.
 * Answers "what data does this endpoint actually give me?".
 * @param {object[]} raws
 * @returns {Array<{ path: string, type: string, filled: number, total: number, sample: unknown }>}
 */
export function fieldInventory(raws) {
  const stats = new Map();
  for (const raw of raws) {
    const perRecord = new Map();
    for (const [path, value] of leafPaths(raw, '')) {
      if (!perRecord.has(path) || (!isFilled(perRecord.get(path)) && isFilled(value))) perRecord.set(path, value);
    }
    for (const [path, value] of perRecord) {
      const prev = stats.get(path) ?? { path, type: 'null', filled: 0, total: raws.length, sample: null };
      const filled = isFilled(value);
      stats.set(path, {
        ...prev,
        filled: prev.filled + (filled ? 1 : 0),
        type: prev.type === 'null' && filled ? typeof value : prev.type,
        sample: prev.sample === null && filled ? value : prev.sample,
      });
    }
  }
  return [...stats.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Prefix text that a spreadsheet would execute as a formula.
  const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * @param {object[]} rows
 * @param {string[]} columns
 * @returns {string}
 */
export function toCsv(rows, columns) {
  return [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))].join('\r\n');
}

function resultError(value) {
  if (!isPlainObject(value)) return null;
  const error = firstDefined(value.error, value.detail, value.status === 'error' ? value.message : null);
  if (error === null) return null;
  return typeof error === 'string' ? error : firstDefined(error.message, JSON.stringify(error));
}

/**
 * Per-platform product counts and errors for multi-platform responses.
 * @param {unknown} body
 * @returns {Array<{ platform: string, count: number, error: string | null }>}
 */
export function platformSummary(body) {
  const results = firstDefined(body?.data?.results, body?.results);
  if (!isPlainObject(results)) return [];
  return Object.entries(results).map(([platform, value]) => ({
    platform,
    count: collectProducts(value, platform).length,
    error: resultError(value),
  }));
}
