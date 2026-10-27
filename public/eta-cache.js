// Per-location ETA / dark-store cache, so ETA credits are spent once per location.
// Each platform entry expires on its own after 2 h (delivery times drift with demand and weather).

const STORAGE_KEY = 'qcx.eta';
const TTL_MS = 2 * 60 * 60 * 1000;

const isFresh = (entry) => entry && typeof entry.at === 'number' && Date.now() - entry.at <= TTL_MS;

function readAll() {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return all && typeof all === 'object' ? all : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch { /* cache only lasts this page load */ }
}

/** Drop expired platforms, and locations left with none. */
function prune(all) {
  return Object.fromEntries(Object.entries(all)
    .map(([loc, platforms]) => [loc, Object.fromEntries(Object.entries(platforms ?? {}).filter(([, e]) => isFresh(e)))])
    .filter(([, platforms]) => Object.keys(platforms).length > 0));
}

/**
 * @param {string} locKey from dataset.locationKey
 * @returns {Record<string, { eta: unknown, open: boolean | null, store_id: unknown }>}
 */
export function loadEta(locKey) {
  const platforms = prune(readAll())[locKey] ?? {};
  return Object.fromEntries(Object.entries(platforms).map(([p, e]) => [p, { eta: e.eta, open: e.open, store_id: e.store_id }]));
}

/**
 * Add freshly fetched platforms to this location's cache.
 * @returns {Record<string, object>} the merged cache for the location
 */
export function saveEta(locKey, byPlatform) {
  const all = prune(readAll());
  const stamped = Object.fromEntries(Object.entries(byPlatform).map(([p, v]) => [p, { ...v, at: Date.now() }]));
  writeAll({ ...all, [locKey]: { ...(all[locKey] ?? {}), ...stamped } });
  return loadEta(locKey);
}

/** Forget this location's ETA so the next search fetches it again. */
export function clearEta(locKey) {
  const { [locKey]: _removed, ...rest } = readAll();
  writeAll(rest);
}
