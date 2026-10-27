// Endpoint registry for QuickCommerce API v1 (https://quickcommerceapi.com/docs).
// Pure ESM with no Node imports: the server uses it to validate requests and the
// browser imports the same file to show credit costs before a call is made.

/** Platforms that reject location-only requests and need a 6-digit pincode. */
export const PINCODE_REQUIRED = Object.freeze(['DMart', 'JioMart', 'Minutes']);

const lat = { type: 'lat', required: true };
const lon = { type: 'lon', required: true };
const platform = { type: 'platform', required: true };
const platforms = { type: 'platforms', required: true };
const pincode = { type: 'pincode' };
const query = { type: 'string', required: true, maxLength: 120 };
const itemId = { type: 'string', required: true, maxLength: 200 };

/**
 * @typedef {{ type: string, required?: boolean, maxLength?: number, values?: string[], min?: number, max?: number }} ParamSpec
 * @typedef {{ perCall?: number, perPlatform?: number }} CostSpec
 * @typedef {{ path: string, label: string, needsKey: boolean, saveSample: boolean,
 *             timeoutMs: number, cost: CostSpec, params: Record<string, ParamSpec> }} EndpointDef
 */

/** @type {Readonly<Record<string, EndpointDef>>} */
export const ENDPOINTS = Object.freeze({
  search: {
    path: '/v1/search', label: 'Search (one platform)', needsKey: true, saveSample: true,
    timeoutMs: 45_000, cost: { perCall: 1 },
    params: { q: query, lat, lon, platform, pincode },
  },
  groupsearch: {
    path: '/v1/groupsearch', label: 'Compare search (many platforms)', needsKey: true, saveSample: true,
    timeoutMs: 60_000, cost: { perPlatform: 1 },
    params: { q: query, lat, lon, platforms, pincode, group: { type: 'boolean' } },
  },
  item: {
    path: '/v1/item', label: 'Item details', needsKey: true, saveSample: true,
    timeoutMs: 45_000, cost: { perCall: 1 },
    params: { item_id: itemId, lat, lon, platform, pincode },
  },
  eta: {
    path: '/v1/eta', label: 'Delivery ETA (one platform)', needsKey: true, saveSample: true,
    timeoutMs: 30_000, cost: { perCall: 1 },
    params: { lat, lon, platform, pincode },
  },
  groupeta: {
    path: '/v1/groupeta', label: 'Delivery ETA (many platforms)', needsKey: true, saveSample: true,
    timeoutMs: 45_000, cost: { perPlatform: 1 },
    params: { lat, lon, platforms, pincode },
  },
  // /v1/screenshot (50 credits) is intentionally not exposed: the user does not need it.
  credits: {
    path: '/v1/credits', label: 'Credit balance', needsKey: true, saveSample: false,
    timeoutMs: 15_000, cost: { perCall: 0 },
    params: {},
  },
  platforms: {
    path: '/v1/supported-platforms', label: 'Supported platforms', needsKey: false, saveSample: false,
    timeoutMs: 15_000, cost: { perCall: 0 },
    params: {},
  },
});

/**
 * Split a comma-separated platform list into unique, trimmed names.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function splitPlatforms(raw) {
  if (typeof raw !== 'string') return [];
  const names = raw.split(',').map((p) => p.trim()).filter(Boolean);
  return [...new Set(names)];
}

/**
 * Credits a call will consume according to the documented pricing table.
 * @param {EndpointDef} def
 * @param {Record<string, unknown>} params
 * @returns {number}
 */
export function estimateCost(def, params) {
  if (def.cost.perPlatform) {
    return def.cost.perPlatform * splitPlatforms(params.platforms).length;
  }
  return def.cost.perCall ?? 0;
}
