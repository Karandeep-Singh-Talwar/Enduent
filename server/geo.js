// Pincode / area → coordinates (and back) via OpenStreetMap Nominatim.
// Usage policy: identifying User-Agent, at most 1 request per second, cache results, no type-ahead.
// https://operations.osmfoundation.org/policies/nominatim/

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const PINCODE = /^\d{6}$/;
const CACHE_LIMIT = 200;
const COMMON = Object.freeze({ format: 'jsonv2', addressdetails: '1', limit: '5' });

const firstText = (...values) => values.find((v) => typeof v === 'string' && v.trim()) ?? null;

/**
 * @typedef {{ label: string, fullName: string, lat: number, lon: number, pincode: string | null, country: string | null }} Place
 */

/**
 * @param {{ lat: string, lon: string, display_name: string, address?: Record<string, string> }} item Nominatim result
 * @returns {Place}
 */
export function parsePlace(item) {
  const a = item.address ?? {};
  const area = firstText(a.suburb, a.neighbourhood, a.quarter, a.residential, a.village, a.town, a.city_district);
  const city = firstText(a.city, a.town, a.county, a.state_district, a.state);
  const postcode = String(a.postcode ?? '').replace(/\s/g, '');
  const parts = [...new Set([area, city].filter(Boolean))];
  return {
    label: parts.length > 0 ? parts.join(', ') : item.display_name,
    fullName: item.display_name,
    lat: Number(item.lat),
    lon: Number(item.lon),
    pincode: PINCODE.test(postcode) ? postcode : null,
    country: a.country_code ?? null,
  };
}

/**
 * @param {{ userAgent: string, fetchImpl?: typeof fetch, minIntervalMs?: number, baseUrl?: string, timeoutMs?: number }} options
 */
export function createGeocoder({ userAgent, fetchImpl = fetch, minIntervalMs = 1100, baseUrl = NOMINATIM, timeoutMs = 10_000 }) {
  const cache = new Map();
  let queue = Promise.resolve();
  let lastCallAt = 0;

  // Serialise calls so we never exceed Nominatim's 1 request/second limit.
  function throttled(task) {
    const run = queue.then(async () => {
      const wait = lastCallAt + minIntervalMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastCallAt = Date.now();
      return task();
    });
    queue = run.catch(() => {});
    return run;
  }

  async function getJson(path, params, cacheKey) {
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const url = new URL(path, baseUrl);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    const body = await throttled(async () => {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': userAgent, 'Accept-Language': 'en' },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`geocoder HTTP ${response.status}`);
      return response.json();
    });
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, body);
    return body;
  }

  /**
   * @param {string} query 6-digit pincode or free-text area name
   * @returns {Promise<Place[]>}
   */
  async function search(query) {
    const q = query.trim().replace(/\s+/g, ' ');
    if (PINCODE.test(q)) {
      const structured = await getJson('/search', { ...COMMON, postalcode: q, countrycodes: 'in' }, `pin|${q}`);
      const list = structured.length > 0 ? structured : await getJson('/search', { ...COMMON, q, countrycodes: 'in' }, `q-in|${q}`);
      // The user typed the pincode, so trust it over whatever postcode OSM attached.
      return list.map(parsePlace).map((place) => ({ ...place, pincode: q }));
    }
    const list = await getJson('/search', { ...COMMON, q, countrycodes: 'in,ae' }, `q|${q.toLowerCase()}`);
    return list.map(parsePlace);
  }

  /**
   * @param {number} lat
   * @param {number} lon
   * @returns {Promise<Place>}
   */
  async function reverse(lat, lon) {
    const params = { format: 'jsonv2', addressdetails: '1', zoom: '16', lat: String(lat), lon: String(lon) };
    const body = await getJson('/reverse', params, `rev|${lat.toFixed(4)},${lon.toFixed(4)}`);
    if (!body || body.error) throw new Error('no address found for these coordinates');
    return parsePlace(body);
  }

  return Object.freeze({ search, reverse });
}
