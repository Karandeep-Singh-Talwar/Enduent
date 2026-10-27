// Platform identifiers as the API expects them (case-sensitive) plus human labels.
// The live list comes from /v1/supported-platforms; these are the documented fallbacks.

export const PLATFORM_LABELS = Object.freeze({
  BlinkIt: 'Blinkit',
  Zepto: 'Zepto',
  Swiggy: 'Swiggy Instamart',
  BigBasket: 'BigBasket',
  DMart: 'DMart Ready',
  JioMart: 'JioMart',
  Minutes: 'Flipkart Minutes',
  Amazon: 'Amazon',
  Nykaa: 'Nykaa',
  Myntra: 'Myntra',
  Flipkart: 'Flipkart',
  Meesho: 'Meesho',
  NoonMinutes: 'Noon Minutes (UAE)',
  TalabatMart: 'talabat mart (UAE)',
  RelianceDigital: 'Reliance Digital',
  Croma: 'Croma',
  Vivo: 'Vivo',
  OnePlus: 'OnePlus',
});

export const QUICK_COMMERCE_IN = Object.freeze(['BlinkIt', 'Zepto', 'Swiggy', 'BigBasket', 'DMart', 'JioMart', 'Minutes']);
export const UAE_PLATFORMS = Object.freeze(['NoonMinutes', 'TalabatMart']);

export const FALLBACK_LISTS = Object.freeze({
  search: [...QUICK_COMMERCE_IN, 'Amazon', 'Nykaa', 'Myntra', 'Flipkart', 'Meesho', ...UAE_PLATFORMS],
  item: [...QUICK_COMMERCE_IN, 'Amazon', 'Nykaa', 'Myntra', 'Flipkart', 'Meesho', ...UAE_PLATFORMS,
    'RelianceDigital', 'Croma', 'Vivo', 'OnePlus'],
  eta: [...QUICK_COMMERCE_IN, ...UAE_PLATFORMS],
});

/**
 * @param {string} id API platform identifier
 * @returns {string}
 */
export const platformLabel = (id) => PLATFORM_LABELS[id] ?? id;

const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * Map whatever the API echoes back ("Swiggy Instamart", "blinkit", "BlinkIt") to the request identifier.
 * @param {unknown} name
 * @returns {string | null}
 */
export function resolvePlatformId(name) {
  const key = squash(name);
  if (!key) return null;
  const entries = Object.entries(PLATFORM_LABELS);
  const exact = entries.find(([id, label]) => squash(id) === key || squash(label) === key);
  if (exact) return exact[0];
  const partial = entries.find(([id, label]) => key.startsWith(squash(id)) || squash(label).startsWith(key));
  return partial ? partial[0] : null;
}

/**
 * @param {string} name platform id or display name
 * @returns {'AED' | 'INR'}
 */
export const platformCurrency = (name) => (UAE_PLATFORMS.includes(resolvePlatformId(name)) ? 'AED' : 'INR');
